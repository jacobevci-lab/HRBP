import { NotificationOutboxStatus, Prisma } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { operationalStates, safeOperationalError } from "@/lib/notification-retry-contract";
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
    const data = await db.$transaction(async tx => {
      const groups = await tx.notificationOutbox.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } });
      const items = await tx.notificationOutbox.findMany({
        where: { tenantId: ctx.tenantId, status: filter === "ALL" ? { in: [...operationalStates] } : filter as NotificationOutboxStatus },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], take: limit,
        select: { id: true, eventType: true, channel: true, resourceType: true, resourceId: true, status: true, attempts: true,
          nextAttemptAt: true, lockedAt: true, lastError: true, createdAt: true, updatedAt: true }
      });
      const counts = Object.fromEntries(groups.map(row => [row.status, row._count._all]));
      return { viewer: { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role }, filter, limit,
        counts: { pending: counts.PENDING ?? 0, processing: counts.PROCESSING ?? 0, failed: counts.FAILED ?? 0, deadLetter: counts.DEAD_LETTER ?? 0, delivered: counts.DELIVERED ?? 0 },
        items: items.map(item => ({ ...item, lastError: safeOperationalError(item.lastError) })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return json({ data });
  } catch {
    console.error("[HRBP] Notification operations could not be loaded.");
    return json({ error: "Notification operations could not be loaded." }, 503);
  }
}
