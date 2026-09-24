import { DataClassification, NotificationOutboxStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:write")) return forbidden();
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Mutation origin is not allowed." }, { status: 403 });

  let body: { limit?: unknown } = {};
  try {
    body = await request.json() as { limit?: unknown };
  } catch {
    // An empty body uses the safe default batch size.
  }

  const requestedLimit = Number(body.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 100;
  const ids = (await db.notificationOutbox.findMany({
    where: { tenantId: ctx.tenantId, status: NotificationOutboxStatus.DEAD_LETTER },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true }
  })).map((row) => row.id);

  if (ids.length === 0) return Response.json({ data: { requeued: 0 } });

  const requeued = await db.$transaction(async (tx) => {
    const result = await tx.notificationOutbox.updateMany({
      where: { tenantId: ctx.tenantId, id: { in: ids }, status: NotificationOutboxStatus.DEAD_LETTER },
      data: {
        status: NotificationOutboxStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        deliveredAt: null,
        lastError: null
      }
    });
    await appendAudit(tx, ctx, {
      action: "settings.notifications-dead-letter-requeued",
      resourceType: "NotificationOutbox",
      resourceId: "dead-letter-batch",
      classification: DataClassification.INTERNAL,
      purpose: `Requeued ${result.count} dead-letter notification(s) for retry`
    });
    return result.count;
  });

  return Response.json({ data: { requeued } });
}
