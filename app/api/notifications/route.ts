import { NotificationOutboxStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function limitFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return Number.isFinite(value) ? Math.min(50, Math.max(1, Math.floor(value))) : 20;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const where = {
    tenantId: ctx.tenantId,
    recipientUserId: ctx.actorId,
    channel: "IN_APP",
    status: NotificationOutboxStatus.DELIVERED,
    ...(unreadOnly ? { readAt: null } : {})
  };

  const [items, unreadCount] = await Promise.all([
    db.notificationOutbox.findMany({
      where,
      orderBy: { deliveredAt: "desc" },
      take: limitFrom(request),
      select: {
        id: true,
        eventType: true,
        templateKey: true,
        resourceType: true,
        resourceId: true,
        payload: true,
        classification: true,
        readAt: true,
        deliveredAt: true,
        createdAt: true
      }
    }),
    db.notificationOutbox.count({
      where: {
        tenantId: ctx.tenantId,
        recipientUserId: ctx.actorId,
        channel: "IN_APP",
        status: NotificationOutboxStatus.DELIVERED,
        readAt: null
      }
    })
  ]);

  return Response.json({ data: { items, unreadCount } }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Mutation origin is not allowed." }, { status: 403 });

  let body: { id?: unknown; all?: unknown; read?: unknown };
  try {
    body = await request.json() as { id?: unknown; all?: unknown; read?: unknown };
  } catch {
    return Response.json({ error: "Valid JSON body is required." }, { status: 400 });
  }

  const markRead = body.read !== false;
  const readAt = markRead ? new Date() : null;
  const baseWhere = {
    tenantId: ctx.tenantId,
    recipientUserId: ctx.actorId,
    channel: "IN_APP",
    status: NotificationOutboxStatus.DELIVERED
  };

  let updated = 0;
  if (body.all === true) {
    const result = await db.notificationOutbox.updateMany({
      where: baseWhere,
      data: { readAt }
    });
    updated = result.count;
  } else {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || id.length > 128) return Response.json({ error: "A valid notification id is required." }, { status: 400 });
    const result = await db.notificationOutbox.updateMany({
      where: { ...baseWhere, id },
      data: { readAt }
    });
    updated = result.count;
    if (updated !== 1) return Response.json({ error: "Notification was not found." }, { status: 404 });
  }

  const unreadCount = await db.notificationOutbox.count({ where: { ...baseWhere, readAt: null } });
  return Response.json({ data: { updated, unreadCount } });
}
