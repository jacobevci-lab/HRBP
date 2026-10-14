import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { assertAuditIntegrityRun } from "@/lib/audit-integrity-outcome.mjs";
import { selectAuditIntegrityBatch } from "@/lib/audit-integrity-batching.mjs";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

// Only confirmed head sequences can advance a tenant's durable coverage record.
// Invalid/tampered/incomplete attempts must retain the last known good watermark.
function verifiedLedgerWatermark(value: string | null): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    throw new Error("Audit verification did not return a bounded confirmed sequence.");
  }
  const sequence = BigInt(value);
  if (sequence > BigInt("9223372036854775807")) {
    throw new Error("Audit verification sequence exceeds PostgreSQL bigint range.");
  }
  return sequence;
}

async function recordSuccessfulAuditVerification(
  tenantId: string,
  now: Date,
  result: { verifiedThroughSequence: string | null; scope: "GENESIS" | "TAIL" | "EMPTY"; checked: number }
) {
  const confirmedSequence = verifiedLedgerWatermark(result.verifiedThroughSequence);
  await db.auditVerificationProgress.upsert({
    where: { tenantId },
    create: {
      tenantId,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastVerifiedSequence: confirmedSequence,
      lastVerifiedScope: result.scope,
      lastResult: "VALID",
      checkedEvents: result.checked,
      consecutiveFailures: 0
    },
    update: {
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastVerifiedSequence: confirmedSequence,
      lastVerifiedScope: result.scope,
      lastResult: "VALID",
      checkedEvents: result.checked,
      consecutiveFailures: 0
    }
  });
}

export async function monitorAuditIntegrity(now = new Date()) {
  const limit = Math.min(5000, Math.max(100, Math.floor(runtimeNumber("HRBP_AUDIT_INTEGRITY_CHECK_LIMIT", 1500))));
  // Count the entire tenant population; never silently stop at 10,000 IDs.
  // Rotate a small 15-minute window instead of hashing up to 150,000 audit
  // events per invocation or repeating one selected window all day.
  const tenantUniverse = await db.tenant.count();
  const batch = selectAuditIntegrityBatch({
    now,
    tenantCount: tenantUniverse,
    requestedTenantBatchSize: runtimeNumber("HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE", 4),
    verificationLimit: limit
  });
  const tenants = await db.tenant.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: batch.skip,
    take: batch.take,
    select: { id: true }
  });

  let verified = 0;
  let empty = 0;
  let failed = 0;
  let notificationsQueued = 0;

  for (const tenant of tenants) {
    const result = await verifyAuditIntegrity(tenant.id, limit);
    // The integrity verifier can report scope EMPTY with valid=false when
    // ledger state claims events but no matching audit rows exist. Never
    // classify that corruption as a normal empty tenant.
    if (result.valid && result.scope === "EMPTY") {
      await recordSuccessfulAuditVerification(tenant.id, now, result);
      empty += 1;
      continue;
    }
    if (result.valid) {
      await recordSuccessfulAuditVerification(tenant.id, now, result);
      verified += 1;
      continue;
    }

    failed += 1;
    const brokenEventId = result.brokenEventId ?? "unknown";
    const queued = await db.$transaction(async (tx) => {
      // Alert and failure receipt must commit together. If the scheduler then
      // returns HTTP 500, existing receipts survive and success is never forged.
      await tx.auditVerificationProgress.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          lastAttemptAt: now,
          lastFailureAt: now,
          lastResult: "INVALID",
          checkedEvents: result.checked,
          consecutiveFailures: 1
        },
        update: {
          lastAttemptAt: now,
          lastFailureAt: now,
          lastResult: "INVALID",
          checkedEvents: result.checked,
          consecutiveFailures: { increment: 1 }
        }
      });
      const notification = await enqueueNotificationOutbox(tx, {
        tenantId: tenant.id,
        eventType: "AUDIT_INTEGRITY_FAILURE",
        recipientRole: PlatformRole.TENANT_ADMIN,
        templateKey: "audit.integrity-failure",
        resourceType: "AuditEvent",
        resourceId: brokenEventId,
        dedupeKey: `audit-integrity:${brokenEventId}`,
        classification: DataClassification.RESTRICTED,
        payload: {
          brokenEventId,
          reason: result.reason,
          checked: result.checked,
          scope: result.scope,
          generatedAt: result.generatedAt
        }
      });
      return notification.status === "PENDING";
    });
    if (queued) notificationsQueued += 1;
  }

  // Count *all* tenant receipts, not merely the selected rotation window:
  // missing/stale coverage stays visible after skipped scheduler runs.
  const verifiedWithin24h = await db.auditVerificationProgress.count({
    where: { lastResult: "VALID", lastSuccessAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
  });

  return assertAuditIntegrityRun({
    tenantUniverse,
    verifiedWithin24h,
    staleOrUnverified24h: Math.max(0, tenantUniverse - verifiedWithin24h),
    tenantBatchSize: batch.tenantBatchSize,
    batchIndex: batch.batchIndex,
    batchCount: batch.batchCount,
    quarterHourSlot: batch.quarterHourSlot,
    maxVerificationEvents: batch.maxVerificationEvents,
    tenantsChecked: tenants.length,
    verified,
    empty,
    failed,
    notificationsQueued,
    verificationLimit: limit
  });
}
