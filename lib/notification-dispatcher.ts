import { NotificationOutboxStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { runtimeNumber } from "@/lib/runtime-env";

function retryDelayMs(attempt: number) {
  const baseSeconds = Math.min(3600, Math.max(10, Math.floor(runtimeNumber("HRBP_NOTIFICATION_RETRY_BASE_SECONDS", 60))));
  const maxSeconds = Math.min(86_400, Math.max(baseSeconds, Math.floor(runtimeNumber("HRBP_NOTIFICATION_RETRY_MAX_SECONDS", 3600))));
  const exponential = baseSeconds * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxSeconds, exponential) * 1000;
}

function errorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/\s+/g, " ").trim().slice(0, 1200) || "Unknown notification delivery error";
}

async function recoverStaleLocks(now: Date) {
  const lockMinutes = Math.min(120, Math.max(2, Math.floor(runtimeNumber("HRBP_NOTIFICATION_LOCK_MINUTES", 10))));
  const staleBefore = new Date(now.getTime() - lockMinutes * 60_000);
  const result = await db.notificationOutbox.updateMany({
    where: { status: NotificationOutboxStatus.PROCESSING, lockedAt: { lte: staleBefore } },
    data: {
      status: NotificationOutboxStatus.FAILED,
      lockedAt: null,
      nextAttemptAt: now,
      lastError: "Recovered stale notification dispatcher lock"
    }
  });
  return result.count;
}

type InAppCandidate = {
  id: string;
  tenantId: string;
  eventType: string;
  recipientUserId: string | null;
  recipientRole: string | null;
  templateKey: string | null;
  resourceType: string;
  resourceId: string;
  dedupeKey: string;
  payload: unknown;
  classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "HIGHLY_RESTRICTED";
};

async function deliverInApp(candidate: InAppCandidate) {
  if (candidate.recipientUserId) return;
  if (!candidate.recipientRole) throw new Error("IN_APP notification has no user or role recipient");

  const recipients = await db.userAccount.findMany({
    where: { tenantId: candidate.tenantId, role: candidate.recipientRole as never, active: true },
    select: { id: true },
    take: 1000
  });
  if (recipients.length === 0) throw new Error(`No active users found for notification role ${candidate.recipientRole}`);

  const deliveredAt = new Date();
  await db.$transaction(async (tx) => {
    for (const recipient of recipients) {
      await tx.notificationOutbox.upsert({
        where: {
          tenantId_dedupeKey: {
            tenantId: candidate.tenantId,
            dedupeKey: `${candidate.dedupeKey}:user:${recipient.id}`
          }
        },
        update: {},
        create: {
          tenantId: candidate.tenantId,
          eventType: candidate.eventType,
          channel: "IN_APP",
          recipientUserId: recipient.id,
          templateKey: candidate.templateKey,
          resourceType: candidate.resourceType,
          resourceId: candidate.resourceId,
          dedupeKey: `${candidate.dedupeKey}:user:${recipient.id}`,
          payload: candidate.payload as never,
          classification: candidate.classification,
          status: NotificationOutboxStatus.DELIVERED,
          attempts: 1,
          deliveredAt
        }
      });
    }
  });
}

export async function runNotificationDispatcher() {
  const startedAt = new Date();
  const maxBatch = Math.min(500, Math.max(10, Math.floor(runtimeNumber("HRBP_NOTIFICATION_BATCH_SIZE", 100))));
  const maxAttempts = Math.min(20, Math.max(2, Math.floor(runtimeNumber("HRBP_NOTIFICATION_MAX_ATTEMPTS", 5))));
  const recovered = await recoverStaleLocks(startedAt);

  const candidates = await db.notificationOutbox.findMany({
    where: {
      status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED] },
      nextAttemptAt: { lte: startedAt },
      attempts: { lt: maxAttempts }
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      eventType: true,
      channel: true,
      recipientUserId: true,
      recipientRole: true,
      templateKey: true,
      resourceType: true,
      resourceId: true,
      dedupeKey: true,
      payload: true,
      classification: true,
      status: true,
      attempts: true,
      nextAttemptAt: true
    }
  });

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const candidate of candidates) {
    const claimedAt = new Date();
    const claim = await db.notificationOutbox.updateMany({
      where: {
        id: candidate.id,
        tenantId: candidate.tenantId,
        status: candidate.status,
        attempts: candidate.attempts,
        nextAttemptAt: { lte: claimedAt }
      },
      data: {
        status: NotificationOutboxStatus.PROCESSING,
        attempts: { increment: 1 },
        lockedAt: claimedAt,
        lastError: null
      }
    });
    if (claim.count !== 1) continue;
    claimed += 1;

    const attempt = candidate.attempts + 1;
    try {
      if (candidate.channel === "IN_APP") {
        await deliverInApp(candidate as InAppCandidate);
      } else {
        throw new Error(`Unsupported notification channel: ${candidate.channel}`);
      }

      const completion = await db.notificationOutbox.updateMany({
        where: { id: candidate.id, tenantId: candidate.tenantId, status: NotificationOutboxStatus.PROCESSING, attempts: attempt },
        data: { status: NotificationOutboxStatus.DELIVERED, deliveredAt: new Date(), lockedAt: null, lastError: null }
      });
      if (completion.count === 1) delivered += 1;
    } catch (error) {
      const deadLetter = attempt >= maxAttempts;
      const now = new Date();
      const completion = await db.notificationOutbox.updateMany({
        where: { id: candidate.id, tenantId: candidate.tenantId, status: NotificationOutboxStatus.PROCESSING, attempts: attempt },
        data: {
          status: deadLetter ? NotificationOutboxStatus.DEAD_LETTER : NotificationOutboxStatus.FAILED,
          lockedAt: null,
          nextAttemptAt: deadLetter ? now : new Date(now.getTime() + retryDelayMs(attempt)),
          lastError: errorMessage(error)
        }
      });
      if (completion.count === 1) {
        if (deadLetter) deadLettered += 1;
        else failed += 1;
      }
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    recovered,
    candidates: candidates.length,
    claimed,
    delivered,
    failed,
    deadLettered
  };
}
