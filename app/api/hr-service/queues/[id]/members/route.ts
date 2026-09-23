import { DataClassification, PlatformRole, ServiceQueueRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues } from "@/lib/hr-service-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffRoles = [PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !canManageHRServiceQueues(ctx)) return forbidden();

  const { id } = await params;
  const body = await request.json() as { userId?: string; role?: ServiceQueueRole };
  const userId = body.userId?.trim();
  const role = body.role && Object.values(ServiceQueueRole).includes(body.role) ? body.role : ServiceQueueRole.AGENT;
  if (!userId) return Response.json({ error: "userId is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const [queue, user] = await Promise.all([
      tx.hRServiceQueue.findFirst({ where: { id, tenantId: ctx.tenantId, active: true }, select: { id: true } }),
      tx.userAccount.findFirst({ where: { id: userId, tenantId: ctx.tenantId, active: true, role: { in: staffRoles } }, select: { id: true } })
    ]);
    if (!queue) throw new Error("QUEUE");
    if (!user) throw new Error("USER");

    const existing = await tx.hRServiceQueueMembership.findFirst({ where: { tenantId: ctx.tenantId, queueId: id, userId } });
    const membership = existing
      ? await tx.hRServiceQueueMembership.update({ where: { id: existing.id }, data: { role } })
      : await tx.hRServiceQueueMembership.create({ data: { tenantId: ctx.tenantId, queueId: id, userId, role } });

    await appendAudit(tx, ctx, {
      action: existing ? "hr-service.queue-member-updated" : "hr-service.queue-member-added",
      resourceType: "HRServiceQueueMembership",
      resourceId: membership.id,
      classification: DataClassification.INTERNAL,
      purpose: `HR service queue membership ${role.toLowerCase()}`
    });
    return membership;
  }).catch((error) => error instanceof Error && ["QUEUE", "USER"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "QUEUE") return Response.json({ error: "Active HR service queue not found." }, { status: 404 });
  if (result === "USER") return Response.json({ error: "Queue member must be an active HR service staff user in this tenant." }, { status: 400 });
  return Response.json({ data: result }, { status: 201 });
}
