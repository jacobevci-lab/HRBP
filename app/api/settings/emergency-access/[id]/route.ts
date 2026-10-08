import { DataClassification, EmergencyAccessStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type RevokeResult = {
  id: string;
  revokedAt: Date;
};

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write") || ctx.role !== PlatformRole.TENANT_ADMIN) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid emergency access id is required." }, { status: 400 });

  let result: RevokeResult;
  try {
    result = await db.$transaction(async (tx) => {
      const grant = await tx.emergencyAccessGrant.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, requesterId: true, status: true }
      });
      if (!grant) throw new Error("NOT_FOUND");
      if (
        grant.status !== EmergencyAccessStatus.REQUESTED &&
        grant.status !== EmergencyAccessStatus.ACTIVE
      ) {
        throw new Error("INVALID_STATE");
      }

      const now = new Date();
      const changed = await tx.emergencyAccessGrant.updateMany({
        where: {
          id: grant.id,
          tenantId: ctx.tenantId,
          status: { in: [EmergencyAccessStatus.REQUESTED, EmergencyAccessStatus.ACTIVE] }
        },
        data: {
          status: EmergencyAccessStatus.REVOKED,
          revokedById: ctx.actorId,
          revokedAt: now
        }
      });
      if (changed.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "security.emergency-access-revoked",
        resourceType: "EmergencyAccessGrant",
        resourceId: grant.id,
        classification: DataClassification.RESTRICTED,
        purpose: grant.requesterId === ctx.actorId
          ? "Emergency access self-revoked"
          : "Emergency access revoked by another tenant administrator"
      });

      await enqueueNotificationOutbox(tx, {
        tenantId: ctx.tenantId,
        eventType: "EMERGENCY_ACCESS_REVOKED",
        recipientUserId: grant.requesterId,
        templateKey: "security.emergency-access-revoked",
        resourceType: "EmergencyAccessGrant",
        resourceId: grant.id,
        dedupeKey: `emergency-access:${grant.id}:revoked`,
        classification: DataClassification.RESTRICTED,
        payload: {
          revokedAt: now.toISOString(),
          revokedBySelf: grant.requesterId === ctx.actorId
        }
      });

      return { id: grant.id, revokedAt: now };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : null;
    if (code === "NOT_FOUND") {
      return Response.json({ error: "Emergency access request was not found." }, { status: 404 });
    }
    if (code === "INVALID_STATE" || code === "STATE_CONFLICT") {
      return Response.json({ error: "Only requested or active emergency access can be revoked." }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ data: { ...result, status: EmergencyAccessStatus.REVOKED } });
}
