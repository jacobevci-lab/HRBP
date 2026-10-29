import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { DataClassification, NotificationOutboxStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:write")) return forbidden();
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Mutation origin is not allowed." }, { status: 403 });

  let body: { limit?: unknown; id?: unknown; batch?: unknown } | null = null;
  try {
    body = await readJsonObject(request) as { limit?: unknown; id?: unknown; batch?: unknown } | null;
  } catch {
    body = null;
  }
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const allowedBodyFields = new Set(["id", "batch", "limit"]);
  if (Object.keys(body).some((key) => !allowedBodyFields.has(key))) {
    return Response.json({ error: "Only id or an explicit dead-letter batch request is supported." }, { status: 400 });
  }

  const hasRequestedId = Object.hasOwn(body, "id");
  const hasBatch = Object.hasOwn(body, "batch");
  if (hasRequestedId === hasBatch) {
    return Response.json({ error: "Choose exactly one retry scope: id or batch." }, { status: 400 });
  }

  let requestedId: string | null = null;
  let limit = 100;
  if (hasRequestedId) {
    requestedId = asIdentifier(body.id, 128);
    if (!requestedId || Object.hasOwn(body, "limit")) {
      return Response.json({ error: "A valid notification id without batch options is required." }, { status: 400 });
    }
  } else {
    if (body.batch !== true) {
      return Response.json({ error: "Batch retry requires batch=true." }, { status: 400 });
    }
    if (Object.hasOwn(body, "limit")) {
      if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 500) {
        return Response.json({ error: "Batch limit must be an integer from 1 to 500." }, { status: 400 });
      }
      limit = body.limit;
    }
  }
  const retryableStatuses = [NotificationOutboxStatus.DEAD_LETTER, NotificationOutboxStatus.FAILED];
  const ids = requestedId
    ? (await db.notificationOutbox.findMany({
        where: { tenantId: ctx.tenantId, id: requestedId, status: { in: retryableStatuses } },
        take: 1,
        select: { id: true }
      })).map((row) => row.id)
    : (await db.notificationOutbox.findMany({
        where: { tenantId: ctx.tenantId, status: NotificationOutboxStatus.DEAD_LETTER },
        orderBy: { updatedAt: "asc" },
        take: limit,
        select: { id: true }
      })).map((row) => row.id);

  if (ids.length === 0) return Response.json({ data: { requeued: 0 }, error: requestedId ? "Retryable notification was not found." : undefined }, { status: requestedId ? 404 : 200 });

  const requeued = await db.$transaction(async (tx) => {
    const result = await tx.notificationOutbox.updateMany({
      where: { tenantId: ctx.tenantId, id: { in: ids }, status: { in: retryableStatuses } },
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
      action: requestedId ? "settings.notification-requeued" : "settings.notifications-dead-letter-requeued",
      resourceType: "NotificationOutbox",
      resourceId: requestedId || "dead-letter-batch",
      classification: DataClassification.INTERNAL,
      purpose: requestedId ? `Requeued notification ${requestedId} for retry` : `Requeued ${result.count} dead-letter notification(s) for retry`
    });
    return result.count;
  });

  return Response.json({ data: { requeued } });
}
