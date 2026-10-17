import { PlatformRole, Prisma } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues, canUseHRServiceQueue, hrServiceRequestWhere, isHRServiceStaffRole } from "@/lib/hr-service-access";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext } from "@/lib/request-context";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const staffRoles = [PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN];

/** Read-only routing choices. They are not authorization tokens: the existing
 * status writer rechecks request, queue, assignee and displayed revision. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext(request);
    if (!ctx) return json({ error: "Authentication required." }, 401);
    if (!can(ctx, "hr-service:read") || !can(ctx, "hr-service:write") || !isHRServiceStaffRole(ctx.role)) return json({ error: "Access denied." }, 403);
    const id = asIdentifier((await params).id), query = new URL(request.url).searchParams;
    const initial = !query.has("queue"), selected = query.get("queue");
    if (!id || query.getAll("queue").length > 1 || (!initial && selected !== "" && !/^[A-Z0-9_-]{2,40}$/.test(selected ?? ""))) return json({ error: "Invalid routing selection." }, 400);
    const data = await db.$transaction(async tx => {
      const scope = await hrServiceRequestWhere(tx, ctx);
      const ticket = await tx.hRServiceRequest.findFirst({ where: { AND: [scope, { id }] }, select: {
        id: true, tenantId: true, requestNumber: true, title: true, status: true, updatedAt: true, queue: true, assigneeId: true
      } });
      if (!ticket) throw new Error("NOT_FOUND");
      if (ticket.status === "CLOSED" || ticket.status === "CANCELLED") throw new Error("TERMINAL");
      const manage = canManageHRServiceQueues(ctx);
      const queueKey = initial ? ticket.queue : selected || null;
      const selectedQueue = queueKey ? await canUseHRServiceQueue(tx, ctx, queueKey) : null;
      if (!initial && queueKey && !selectedQueue) throw new Error("NOT_FOUND");
      // No directory lookup before request authorization. HRBP only sees
      // delegated queues and their staff; unqueued suggestions are self-only.
      const queues = await tx.hRServiceQueue.findMany({ where: { tenantId: ctx.tenantId, active: true,
        ...(!manage ? { memberships: { some: { tenantId: ctx.tenantId, userId: ctx.actorId } } } : {})
      }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 101, select: { key: true, name: true } });
      const assignees = selectedQueue ? await tx.$queryRaw<Array<{ id: string; displayName: string }>>`
        SELECT u."id", u."displayName" FROM "UserAccount" u
        WHERE u."tenantId" = ${ctx.tenantId} AND u."active" = true
          AND u."role" IN ('HRBP', 'HR_OPERATIONS', 'TENANT_ADMIN')
          AND EXISTS (SELECT 1 FROM "HRServiceQueueMembership" m
            WHERE m."tenantId" = ${ctx.tenantId} AND m."queueId" = ${selectedQueue.id} AND m."userId" = u."id")
        ORDER BY u."displayName", u."id" LIMIT 201
      ` : queueKey ? [] : await tx.userAccount.findMany({ where: {
        tenantId: ctx.tenantId, active: true, role: { in: staffRoles }, ...(!manage ? { id: ctx.actorId } : {})
      }, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: 201, select: { id: true, displayName: true } });
      return { request: ticket, viewer: { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role }, initial,
        queue: queueKey, queueAvailable: queueKey === null || Boolean(selectedQueue),
        queues: queues.slice(0, 100), assignees: assignees.slice(0, 200),
        queuesTruncated: queues.length > 100, assigneesTruncated: assignees.length > 200 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return json({ error: "Routing is unavailable in this scope." }, 404);
    if (error instanceof Error && error.message === "TERMINAL") return json({ error: "Closed or cancelled requests are read-only." }, 409);
    console.error("[HRBP] Routing choices could not be loaded.");
    return json({ error: "Routing choices could not be loaded." }, 503);
  }
}
