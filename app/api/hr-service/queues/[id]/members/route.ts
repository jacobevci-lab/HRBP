import { DataClassification, PlatformRole, ServiceQueueRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffRoles = [PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !canManageHRServiceQueues(ctx)) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid queue id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const userId = asIdentifier(body.userId);
  const role = body.role === undefined ? ServiceQueueRole.AGENT : asEnumValue(body.role, Object.values(ServiceQueueRole));
  if (!userId || !role) return Response.json({ error: "userId and role OWNER|AGENT are required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    // Shared with membership deletion: serialize changes to the owner set.
    // A count alone races when two owners are removed/demoted concurrently.
    const queues = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "HRServiceQueue"
      WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} AND "active" = true FOR UPDATE
    `;
    if (!queues.length) throw new Error("QUEUE");
    const user = await tx.userAccount.findFirst({ where: { id: userId, tenantId: ctx.tenantId, active: true, role: { in: staffRoles } }, select: { id: true } });
    if (!user) throw new Error("USER");
    const existing = await tx.hRServiceQueueMembership.findFirst({ where: { tenantId: ctx.tenantId, queueId: id, userId } });
    if (existing?.role === ServiceQueueRole.OWNER && role !== ServiceQueueRole.OWNER) {
      const owners = await tx.hRServiceQueueMembership.count({ where: { tenantId: ctx.tenantId, queueId: id, role: ServiceQueueRole.OWNER } });
      if (owners <= 1) throw new Error("LAST_OWNER");
    }
    const membership = existing ? await tx.hRServiceQueueMembership.update({ where: { id: existing.id }, data: { role } }) : await tx.hRServiceQueueMembership.create({ data: { tenantId: ctx.tenantId, queueId: id, userId, role } });
    await appendAudit(tx, ctx, { action: existing ? "hr-service.queue-member-updated" : "hr-service.queue-member-added", resourceType: "HRServiceQueueMembership", resourceId: membership.id, classification: DataClassification.INTERNAL, purpose: `HR service queue membership ${role.toLowerCase()}` });
    return membership;
  }).catch((error) => error instanceof Error && ["QUEUE", "USER", "LAST_OWNER"].includes(error.message) ? error.message : Promise.reject(error));
  if (result === "QUEUE") return Response.json({ error: "Active HR service queue not found." }, { status: 404 });
  if (result === "USER") return Response.json({ error: "Queue member must be an active HR service staff user in this tenant." }, { status: 400 });
  if (result === "LAST_OWNER") return Response.json({ error: "The last queue owner cannot be demoted. Assign another owner first." }, { status: 409 });
  return Response.json({ data: result }, { status: 201 });
}
