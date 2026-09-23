import { DataClassification, PlatformRole, ServiceQueueRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffRoles = [PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN];

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  if (isHRServiceSelfServiceRole(ctx.role)) return Response.json({ data: [], candidates: [], permissions: { manage: false } });
  const manage = canManageHRServiceQueues(ctx);
  const queueIds = manage ? null : (await db.hRServiceQueueMembership.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.actorId }, select: { queueId: true } })).map((membership) => membership.queueId);
  const queues = await db.hRServiceQueue.findMany({ where: { tenantId: ctx.tenantId, ...(queueIds === null ? {} : { id: { in: queueIds } }) }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { memberships: true } });
  const userIds = [...new Set(queues.flatMap((queue) => queue.memberships.map((membership) => membership.userId)))];
  const users = userIds.length ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, id: { in: userIds } }, select: { id: true, displayName: true, role: true } }) : [];
  const userMap = new Map(users.map((user) => [user.id, user]));
  const candidates = manage ? await db.userAccount.findMany({ where: { tenantId: ctx.tenantId, active: true, role: { in: staffRoles } }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, role: true } }) : [];
  return Response.json({ data: queues.map((queue) => ({ id: queue.id, key: queue.key, name: queue.name, defaultSlaMinutes: queue.defaultSlaMinutes, active: queue.active, memberships: queue.memberships.map((membership) => ({ id: membership.id, userId: membership.userId, role: membership.role, displayName: userMap.get(membership.userId)?.displayName ?? membership.userId, platformRole: userMap.get(membership.userId)?.role ?? null })) })), candidates, permissions: { manage } });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !canManageHRServiceQueues(ctx)) return forbidden();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const key = typeof body.key === "string" ? body.key.trim().toUpperCase().replace(/\s+/g, "_") : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ownerUserId = asIdentifier(body.ownerUserId);
  if (!key || !/^[A-Z0-9_-]{2,40}$/.test(key) || !name || !ownerUserId) return Response.json({ error: "key, name and ownerUserId are required; key must use A-Z, 0-9, _ or -." }, { status: 400 });
  const defaultSlaMinutes = body.defaultSlaMinutes === undefined || body.defaultSlaMinutes === null ? null : Number(body.defaultSlaMinutes);
  if (defaultSlaMinutes !== null && (!Number.isInteger(defaultSlaMinutes) || defaultSlaMinutes < 15 || defaultSlaMinutes > 10080)) return Response.json({ error: "defaultSlaMinutes must be an integer between 15 and 10080." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const owner = await tx.userAccount.findFirst({ where: { id: ownerUserId, tenantId: ctx.tenantId, active: true, role: { in: staffRoles } }, select: { id: true } });
    if (!owner) throw new Error("OWNER");
    const exists = await tx.hRServiceQueue.findFirst({ where: { tenantId: ctx.tenantId, key }, select: { id: true } });
    if (exists) throw new Error("EXISTS");
    const queue = await tx.hRServiceQueue.create({ data: { tenantId: ctx.tenantId, key, name, defaultSlaMinutes, createdById: ctx.actorId, memberships: { create: { tenantId: ctx.tenantId, userId: owner.id, role: ServiceQueueRole.OWNER } } }, include: { memberships: true } });
    await appendAudit(tx, ctx, { action: "hr-service.queue-created", resourceType: "HRServiceQueue", resourceId: queue.id, classification: DataClassification.INTERNAL, purpose: "Governed HR service queue ownership" });
    return queue;
  }).catch((error) => error instanceof Error && ["OWNER", "EXISTS"].includes(error.message) ? error.message : Promise.reject(error));
  if (result === "OWNER") return Response.json({ error: "Queue owner must be an active HR service staff user in this tenant." }, { status: 400 });
  if (result === "EXISTS") return Response.json({ error: "A queue with this key already exists in the tenant." }, { status: 409 });
  return Response.json({ data: result }, { status: 201 });
}
