import { NotificationOutboxStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { internalBearerAuthorized } from "@/lib/internal-auth";

function authorized(request: Request) {
  return internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN");
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }

  const now = new Date();
  const [pending, processing, failed, deadLetter, delivered, dueNow, oldestDue, oldestDeadLetter] = await Promise.all([
    db.notificationOutbox.count({ where: { status: NotificationOutboxStatus.PENDING } }),
    db.notificationOutbox.count({ where: { status: NotificationOutboxStatus.PROCESSING } }),
    db.notificationOutbox.count({ where: { status: NotificationOutboxStatus.FAILED } }),
    db.notificationOutbox.count({ where: { status: NotificationOutboxStatus.DEAD_LETTER } }),
    db.notificationOutbox.count({ where: { status: NotificationOutboxStatus.DELIVERED } }),
    db.notificationOutbox.count({
      where: {
        status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED] },
        nextAttemptAt: { lte: now }
      }
    }),
    db.notificationOutbox.findFirst({
      where: { status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED] } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true, createdAt: true }
    }),
    db.notificationOutbox.findFirst({
      where: { status: NotificationOutboxStatus.DEAD_LETTER },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true }
    })
  ]);

  return Response.json({
    data: {
      generatedAt: now.toISOString(),
      counts: { pending, processing, failed, deadLetter, delivered, dueNow },
      oldestDueAt: oldestDue?.nextAttemptAt.toISOString() ?? null,
      oldestQueuedAt: oldestDue?.createdAt.toISOString() ?? null,
      oldestDeadLetterAt: oldestDeadLetter?.updatedAt.toISOString() ?? null
    }
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }

  let body: { action?: unknown; id?: unknown; limit?: unknown };
  try {
    body = await request.json() as { action?: unknown; id?: unknown; limit?: unknown };
  } catch {
    return Response.json({ error: "Valid JSON body is required." }, { status: 400 });
  }

  if (body.action !== "retry-dead-letter") {
    return Response.json({ error: "Unsupported notification operation." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const requestedLimit = Number(body.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 100;

  const ids = id
    ? [id]
    : (await db.notificationOutbox.findMany({
        where: { status: NotificationOutboxStatus.DEAD_LETTER },
        orderBy: { updatedAt: "asc" },
        take: limit,
        select: { id: true }
      })).map((row) => row.id);

  if (ids.length === 0) return Response.json({ data: { requeued: 0 } });

  const result = await db.notificationOutbox.updateMany({
    where: {
      id: { in: ids },
      status: NotificationOutboxStatus.DEAD_LETTER
    },
    data: {
      status: NotificationOutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      deliveredAt: null,
      lastError: null
    }
  });

  return Response.json({ data: { requeued: result.count } });
}
