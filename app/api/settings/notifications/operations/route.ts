import { NotificationOutboxStatus } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

const operationalStatuses = [
  NotificationOutboxStatus.PENDING,
  NotificationOutboxStatus.PROCESSING,
  NotificationOutboxStatus.FAILED,
  NotificationOutboxStatus.DEAD_LETTER
];

function limitFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value))) : 100;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();

  const [groups, items] = await Promise.all([
    db.notificationOutbox.groupBy({
      by: ["status"],
      where: { tenantId: ctx.tenantId },
      _count: { _all: true }
    }),
    db.notificationOutbox.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: operationalStatuses }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limitFrom(request),
      select: {
        id: true,
        eventType: true,
        channel: true,
        resourceType: true,
        resourceId: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        lockedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  const counts = Object.fromEntries(groups.map((row) => [row.status, row._count._all]));
  return Response.json({
    data: {
      counts: {
        pending: counts.PENDING ?? 0,
        processing: counts.PROCESSING ?? 0,
        failed: counts.FAILED ?? 0,
        deadLetter: counts.DEAD_LETTER ?? 0,
        delivered: counts.DELIVERED ?? 0
      },
      items
    }
  }, { headers: { "cache-control": "no-store" } });
}
