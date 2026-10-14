import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { selectAuditIntegrityBatch } from "@/lib/audit-integrity-batching.mjs";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

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
      empty += 1;
      continue;
    }
    if (result.valid) {
      verified += 1;
      continue;
    }

    failed += 1;
    const brokenEventId = result.brokenEventId ?? "unknown";
    const queued = await db.$transaction(async (tx) => {
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

  return {
    tenantUniverse,
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
  };
}
