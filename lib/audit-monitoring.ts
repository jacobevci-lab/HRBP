import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function monitorAuditIntegrity() {
  const limit = Math.min(5000, Math.max(100, Math.floor(runtimeNumber("HRBP_AUDIT_INTEGRITY_CHECK_LIMIT", 1500))));
  const tenants = await db.tenant.findMany({ orderBy: { createdAt: "asc" }, select: { id: true }, take: 5000 });
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
    tenants: tenants.length,
    verified,
    empty,
    failed,
    notificationsQueued,
    verificationLimit: limit
  };
}
