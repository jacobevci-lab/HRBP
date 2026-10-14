import { DataClassification, PlatformRole, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertAuditIntegrityRun } from "@/lib/audit-integrity-outcome.mjs";
import { selectAuditIntegrityBatch } from "@/lib/audit-integrity-batching.mjs";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { createAuditVerificationScheduler } from "@/lib/audit-verification-schedule";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

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
  tx: Prisma.TransactionClient, tenantId: string, now: Date,
  result: { verifiedThroughSequence: string | null; scope: "GENESIS" | "TAIL" | "EMPTY"; checked: number }
) {
  const confirmedSequence = verifiedLedgerWatermark(result.verifiedThroughSequence);
  // Atomic receipt ordering is retained in addition to the scheduler's lease.
  // All writes now share the transaction that advances the durable cursor.
  const recorded = await tx.$executeRaw`
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
    throw Object.assign(new Error("Audit verification progress rejected a stale or regressing success."), {
      code: "AUDIT_VERIFICATION_PROGRESS_CONFLICT"
    });
  }
}

export async function monitorAuditIntegrity(now = new Date()) {
  const limit = Math.min(5000, Math.max(100, Math.floor(runtimeNumber("HRBP_AUDIT_INTEGRITY_CHECK_LIMIT", 1500))));
  const tenantUniverse = await db.tenant.count();
  // Reuse the reviewed hash/tenant budget, NOT its former time-slot selection.
  const budget = selectAuditIntegrityBatch({ now, tenantCount: tenantUniverse,
    requestedTenantBatchSize: runtimeNumber("HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE", 4), verificationLimit: limit });
  const scheduler = createAuditVerificationScheduler(db);
  const lease = await scheduler.start(budget.tenantBatchSize);
  let verified = 0, empty = 0, failed = 0, notificationsQueued = 0;

  try {
    for (const tenant of lease.tenants) {
      // Hashing uses its own repeatable-read snapshot OUTSIDE the short cursor
      // write transaction. An incomplete verifier never advances the cursor.
      const result = await verifyAuditIntegrity(tenant.id, limit);
      if (result.valid && result.scope === "EMPTY") {
        await scheduler.checkpoint(lease, tenant, tx => recordSuccessfulAuditVerification(tx, tenant.id, now, result));
        empty += 1;
        continue;
      }
      if (result.valid) {
        await scheduler.checkpoint(lease, tenant, tx => recordSuccessfulAuditVerification(tx, tenant.id, now, result));
        verified += 1;
        continue;
      }

      failed += 1;
      const brokenEventId = result.brokenEventId ?? "unknown";
      const queued = await scheduler.checkpoint(lease, tenant, async tx => {
        // Invalid outcomes advance only AFTER failure receipt and alert commit.
        // This keeps an invalid tenant visible without starving all later ones.
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
          resourceType: "AuditEvent", resourceId: brokenEventId,
          dedupeKey: `audit-integrity:${brokenEventId}`,
          classification: DataClassification.RESTRICTED,
          payload: { brokenEventId, reason: result.reason, checked: result.checked,
            scope: result.scope, generatedAt: result.generatedAt }
        });
        return notification.status === "PENDING";
      });
      if (queued) notificationsQueued += 1;
    }

    const verifiedWithin24h = await db.auditVerificationProgress.count({
      where: { lastResult: "VALID", lastSuccessAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }
    });
    const schedule = await scheduler.finish(lease);
    // Aggregate only: never return cursor IDs, lease tokens or tenant payloads.
    // A completed traversal includes recorded INVALID results; it is not a
    // healthy/full-history attestation. The result guard still makes them RED.
    return assertAuditIntegrityRun({
      ...schedule, tenantUniverse, verifiedWithin24h,
      staleOrUnverified24h: Math.max(0, tenantUniverse - verifiedWithin24h),
      tenantBatchSize: budget.tenantBatchSize, maxVerificationEvents: budget.maxVerificationEvents,
      tenantsChecked: lease.tenants.length, verified, empty, failed, notificationsQueued, verificationLimit: limit
    });
  } finally {
    // On interruption expiry permits a future scheduled run, not blind POST
    // replay. A cleanup failure must never replace the original diagnostic.
    await scheduler.release(lease).catch(() => undefined);
  }
}
