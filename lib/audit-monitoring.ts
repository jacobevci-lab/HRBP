import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function monitorAuditIntegrity(now = new Date()) {
  const limit = Math.min(5000, Math.max(100, Math.floor(runtimeNumber("HRBP_AUDIT_INTEGRITY_CHECK_LIMIT", 1500))));
  const tenantBatchSize = Math.min(1000, Math.max(10, Math.floor(runtimeNumber("HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE", 100))));
  const tenantUniverse = await db.tenant.findMany({ orderBy: { createdAt: "asc" }, select: { id: true }, take: 10_000 });
  const batchCount = Math.max(1, Math.ceil(tenantUniverse.length / tenantBatchSize));
  const utcDay = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  const batchIndex = utcDay % batchCount;
  const batchStart = batchIndex * tenantBatchSize;
  const tenants = tenantUniverse.slice(batchStart, batchStart + tenantBatchSize);

  let verified = 0;
  let empty = 0;
  let failed = 0;
  let notificationsQueued = 0;

  for (const tenant of tenants) {
    const result = await verifyAuditIntegrity(tenant.id, limit);
    if (result.scope === "EMPTY") {
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
    tenantUniverse: tenantUniverse.length,
    tenantBatchSize,
    batchIndex,
    batchCount,
    tenantsChecked: tenants.length,
    verified,
    empty,
    failed,
    notificationsQueued,
    verificationLimit: limit
  };
}
