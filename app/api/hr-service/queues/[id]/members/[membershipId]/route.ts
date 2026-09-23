import { DataClassification, PlatformRole, ServiceQueueRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues } from "@/lib/hr-service-access";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !canManageHRServiceQueues(ctx)) return forbidden();
  const resolved = await params;
  const id = asIdentifier(resolved.id);
  const membershipId = asIdentifier(resolved.membershipId);
  if (!id || !membershipId) return Response.json({ error: "Valid queue and membership ids are required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const membership = await tx.hRServiceQueueMembership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId, queueId: id } });
    if (!membership) throw new Error("NOT_FOUND");
    if (membership.role === ServiceQueueRole.OWNER) {
      const owners = await tx.hRServiceQueueMembership.count({ where: { tenantId: ctx.tenantId, queueId: id, role: ServiceQueueRole.OWNER } });
      if (owners <= 1) throw new Error("LAST_OWNER");
    }
    await tx.hRServiceQueueMembership.delete({ where: { id: membership.id } });
    await appendAudit(tx, ctx, { action: "hr-service.queue-member-removed", resourceType: "HRServiceQueueMembership", resourceId: membership.id, classification: DataClassification.INTERNAL, purpose: "HR service queue membership removal" });
    return { id: membership.id };
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "LAST_OWNER"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Queue membership not found." }, { status: 404 });
  if (result === "LAST_OWNER") return Response.json({ error: "The last queue owner cannot be removed. Assign another owner first." }, { status: 409 });
  return Response.json({ data: result });
}
