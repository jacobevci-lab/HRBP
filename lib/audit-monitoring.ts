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
  // A read-then-upsert guard races under overlapping invocations. PostgreSQL
  // evaluates this conditional update while holding the conflicting row lock.
  // Values are bound parameters; no employee data or SQL identifiers are interpolated.
  const recorded = await db.$executeRaw`
    INSERT INTO "AuditVerificationProgress" AS progress
      ("tenantId", "lastAttemptAt", "lastSuccessAt", "lastVerifiedSequence",
       "lastVerifiedScope", "lastResult", "checkedEvents", "consecutiveFailures")
    VALUES (${tenantId}, ${now}, ${now}, ${confirmedSequence},
            ${result.scope}, 'VALID', ${result.checked}, 0)
    ON CONFLICT ("tenantId") DO UPDATE SET
      "lastAttemptAt" = EXCLUDED."lastAttemptAt",
      "lastSuccessAt" = EXCLUDED."lastSuccessAt",
      "lastVerifiedSequence" = EXCLUDED."lastVerifiedSequence",
      "lastVerifiedScope" = EXCLUDED."lastVerifiedScope",
      "lastResult" = 'VALID',
      "checkedEvents" = EXCLUDED."checkedEvents",
      "consecutiveFailures" = 0
    WHERE (progress."lastAttemptAt" < EXCLUDED."lastAttemptAt"
      OR (progress."lastAttemptAt" = EXCLUDED."lastAttemptAt"
          AND progress."lastResult" = 'VALID'))
      AND (progress."lastVerifiedSequence" IS NULL
           OR progress."lastVerifiedSequence" <= EXCLUDED."lastVerifiedSequence")
  `;
  if (recorded !== 1) {
    // Never mark an invocation green when its receipt was rejected. A delayed
    // snapshot is not proof of tampering; report a bounded operational conflict,
    // preserve the newer receipt and require a fresh, normally scheduled check.
    throw Object.assign(new Error("Audit verification progress rejected a stale or regressing success."), {
      code: "AUDIT_VERIFICATION_PROGRESS_CONFLICT"
    });
  }
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
      // Keep failure receipt and restricted alert in the same transaction.
      // An old failure cannot undo a newer recovery, but still alerts and fails
      // this invocation. At equal timestamps INVALID wins over VALID; repeated
      // delivery of that same failure does not inflate consecutiveFailures.
      await tx.$executeRaw`
        INSERT INTO "AuditVerificationProgress" AS progress
          ("tenantId", "lastAttemptAt", "lastFailureAt", "lastResult",
           "checkedEvents", "consecutiveFailures")
        VALUES (${tenant.id}, ${now}, ${now}, 'INVALID', ${result.checked}, 1)
        ON CONFLICT ("tenantId") DO UPDATE SET
          "lastAttemptAt" = EXCLUDED."lastAttemptAt",
          "lastFailureAt" = EXCLUDED."lastFailureAt",
          "lastResult" = 'INVALID',
          "checkedEvents" = EXCLUDED."checkedEvents",
          "consecutiveFailures" = CASE
            WHEN progress."lastAttemptAt" = EXCLUDED."lastAttemptAt"
              AND progress."lastResult" = 'INVALID'
            THEN progress."consecutiveFailures"
            ELSE LEAST(progress."consecutiveFailures"::bigint + 1, 2147483647)::integer
          END
        WHERE progress."lastAttemptAt" <= EXCLUDED."lastAttemptAt"
      `;
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
