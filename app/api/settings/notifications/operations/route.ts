import { NotificationOutboxStatus, Prisma } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { operationalStates, safeOperationalError, operationsCursor, parseOperationsCursor } from "@/lib/notification-retry-contract";
import { getRequestContext } from "@/lib/request-context";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    if (!ctx) return json({ error: "Authentication required." }, 401);
    if (!can(ctx, "settings:read")) return json({ error: "Access denied." }, 403);
    const query = new URL(request.url).searchParams;
    const filter = query.get("status") ?? "ALL", limit = Number(query.get("limit") ?? 100);
    if (query.getAll("status").length > 1 || query.getAll("limit").length > 1 ||
        !["ALL", ...operationalStates].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      return json({ error: "Invalid status or limit (1–100)." }, 400);
    const paged = query.has("after"), after = query.get("after") || null;
    const viewer = { id: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role };
    const position = after === null ? null : parseOperationsCursor(after, viewer, filter, limit);
    if (query.getAll("after").length > 1 || after !== null && !position)
      return json({ error: "Invalid page position. Start from the first page." }, 400);
    const data = await db.$transaction(async tx => {
      const groups = await tx.notificationOutbox.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } });
      const items = await tx.notificationOutbox.findMany({
        where: { tenantId: ctx.tenantId, status: filter === "ALL" ? { in: [...operationalStates] } : filter as NotificationOutboxStatus,
          ...(position ? { OR: [
            { updatedAt: { lt: new Date(position.updatedAt) } },
            { updatedAt: new Date(position.updatedAt), createdAt: { lt: new Date(position.createdAt) } },
            { updatedAt: new Date(position.updatedAt), createdAt: new Date(position.createdAt), id: { gt: position.id } }
          ] } : {}) },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], take: paged ? limit + 1 : limit,
        select: { id: true, eventType: true, channel: true, resourceType: true, resourceId: true, status: true, attempts: true,
          nextAttemptAt: true, lockedAt: true, lastError: true, createdAt: true, updatedAt: true }
      });
      const visible = items.slice(0, limit), last = visible.at(-1);
      const counts = Object.fromEntries(groups.map(row => [row.status, row._count._all]));
      return { viewer: { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role }, filter, limit,
        counts: { pending: counts.PENDING ?? 0, processing: counts.PROCESSING ?? 0, failed: counts.FAILED ?? 0, deadLetter: counts.DEAD_LETTER ?? 0, delivered: counts.DELIVERED ?? 0 },
        items: visible.map(item => ({ ...item, lastError: safeOperationalError(item.lastError) })),
        ...(paged ? { page: { after, next: items.length > limit && last ? operationsCursor({
          id: last.id, updatedAt: last.updatedAt.toISOString(), createdAt: last.createdAt.toISOString()
        }, viewer, filter, limit) : null } } : {}) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return json({ data });
  } catch {
    console.error("[HRBP] Notification operations could not be loaded.");
    return json({ error: "Notification operations could not be loaded." }, 503);
  }
}
