import { DataClassification, EmergencyAccessStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write") || ctx.role !== PlatformRole.TENANT_ADMIN) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid emergency access id is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const grant = await tx.emergencyAccessGrant.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, requesterId: true, status: true, validTo: true }
    });
    if (!grant) throw new Error("NOT_FOUND");
    if (![EmergencyAccessStatus.REQUESTED, EmergencyAccessStatus.ACTIVE].includes(grant.status)) {
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

    return { id: grant.id, revokedAt: now };
  }).catch((error) => error instanceof Error &&
    ["NOT_FOUND", "INVALID_STATE", "STATE_CONFLICT"].includes(error.message)
      ? error.message
      : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Emergency access request was not found." }, { status: 404 });
  if (result === "INVALID_STATE" || result === "STATE_CONFLICT") {
    return Response.json({ error: "Only requested or active emergency access can be revoked." }, { status: 409 });
  }
  return Response.json({ data: { ...result, status: EmergencyAccessStatus.REVOKED } });
}
