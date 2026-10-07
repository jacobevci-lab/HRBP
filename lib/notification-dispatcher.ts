import {
  DataClassification,
  NotificationOutboxStatus,
  PlatformRole,
  Prisma
} from "@prisma/client";
import { db } from "@/lib/db";
import { notificationEmailBatchSize, notificationEmailPolicyAllows } from "@/lib/notification-email-config";
import { sendSmtpNotification } from "@/lib/smtp-notification-provider";
import { runtimeNumber } from "@/lib/runtime-env";

function retryDelayMs(attempt: number) {
  const baseSeconds = Math.min(3600, Math.max(10, Math.floor(runtimeNumber("HRBP_NOTIFICATION_RETRY_BASE_SECONDS", 60))));
  const maxSeconds = Math.min(86_400, Math.max(baseSeconds, Math.floor(runtimeNumber("HRBP_NOTIFICATION_RETRY_MAX_SECONDS", 3600))));
  const exponential = baseSeconds * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxSeconds, exponential) * 1000;
}

function errorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/s+/g, " ").trim().slice(0, 1200) || "Unknown notification delivery error";
}

function platformRole(value: string): PlatformRole | null {
  return (Object.values(PlatformRole) as string[]).includes(value) ? value as PlatformRole : null;
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

type NotificationCandidate = {
  id: string;
  tenantId: string;
  eventType: string;
  channel: string;
  recipientUserId: string | null;
  recipientRole: string | null;
  templateKey: string | null;
  resourceType: string;
  resourceId: string;
  dedupeKey: string;
  payload: Prisma.JsonValue | null;
  classification: DataClassification;
  status: NotificationOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
};

const candidateSelect = {
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
} as const;

async function deliverInApp(candidate: NotificationCandidate) {
  if (candidate.recipientUserId) return;
  if (!candidate.recipientRole) throw new Error("IN_APP_RECIPIENT_REQUIRED");

  const role = platformRole(candidate.recipientRole);
  if (!role) throw new Error("IN_APP_ROLE_UNSUPPORTED");

  const recipients = await db.userAccount.findMany({
    where: { tenantId: candidate.tenantId, role, active: true },
    select: { id: true },
    take: 1000
  });
  if (recipients.length === 0) throw new Error("IN_APP_ROLE_RECIPIENTS_UNAVAILABLE");

  const deliveredAt = new Date();
  await db.$transaction(async (tx) => {
    for (const recipient of recipients) {
      const dedupeKey = `${candidate.dedupeKey}:user:${recipient.id}`;
      await tx.notificationOutbox.upsert({
        where: { tenantId_dedupeKey: { tenantId: candidate.tenantId, dedupeKey } },
        update: {},
        create: {
          tenantId: candidate.tenantId,
          eventType: candidate.eventType,
          channel: "IN_APP",
          recipientUserId: recipient.id,
          templateKey: candidate.templateKey,
          resourceType: candidate.resourceType,
          resourceId: candidate.resourceId,
          dedupeKey,
          ...(candidate.payload === null ? {} : { payload: candidate.payload as Prisma.InputJsonValue }),
          classification: candidate.classification,
          status: NotificationOutboxStatus.DELIVERED,
          attempts: 1,
          deliveredAt
        }
      });
    }
  });
}

async function fanOutEmailRole(candidate: NotificationCandidate) {
  if (!candidate.recipientRole) throw new Error("EMAIL_RECIPIENT_REQUIRED");
  const role = platformRole(candidate.recipientRole);
  if (!role) throw new Error("EMAIL_ROLE_UNSUPPORTED");

  const recipients = await db.userAccount.findMany({
    where: {
      tenantId: candidate.tenantId,
      role,
      active: true,
      email: { not: null }
    },
    select: { id: true },
    take: 1000
  });
  if (recipients.length === 0) throw new Error("EMAIL_ROLE_RECIPIENTS_UNAVAILABLE");

  await db.$transaction(async (tx) => {
    for (const recipient of recipients) {
      const dedupeKey = `${candidate.dedupeKey}:user:${recipient.id}`;
      await tx.notificationOutbox.upsert({
        where: { tenantId_dedupeKey: { tenantId: candidate.tenantId, dedupeKey } },
        update: {},
        create: {
          tenantId: candidate.tenantId,
          eventType: candidate.eventType,
          channel: "EMAIL",
          recipientUserId: recipient.id,
          templateKey: candidate.templateKey,
          resourceType: candidate.resourceType,
          resourceId: candidate.resourceId,
          dedupeKey,
          ...(candidate.payload === null ? {} : { payload: candidate.payload as Prisma.InputJsonValue }),
          classification: candidate.classification
        }
      });
    }
  });
}

async function deliverEmail(candidate: NotificationCandidate) {
  if (!notificationEmailPolicyAllows(candidate.eventType, candidate.classification)) {
    throw new Error("EMAIL_NOTIFICATION_POLICY_BLOCKED");
  }

  if (!candidate.recipientUserId) {
    await fanOutEmailRole(candidate);
    return;
  }

  const recipient = await db.userAccount.findFirst({
    where: {
      id: candidate.recipientUserId,
      tenantId: candidate.tenantId,
      active: true
    },
    select: { email: true }
  });
  if (!recipient?.email) throw new Error("EMAIL_RECIPIENT_UNAVAILABLE");

  await sendSmtpNotification({
    outboxId: candidate.id,
    tenantId: candidate.tenantId,
    eventType: candidate.eventType,
    recipient: recipient.email,
    resourceType: candidate.resourceType,
    resourceId: candidate.resourceId,
    classification: candidate.classification,
    payload: candidate.payload
  });
}

export async function runNotificationDispatcher() {
  const startedAt = new Date();
  const maxBatch = Math.min(500, Math.max(10, Math.floor(runtimeNumber("HRBP_NOTIFICATION_BATCH_SIZE", 100))));
  const emailBatch = notificationEmailBatchSize();
  const maxAttempts = Math.min(20, Math.max(2, Math.floor(runtimeNumber("HRBP_NOTIFICATION_MAX_ATTEMPTS", 5))));
  const recovered = await recoverStaleLocks(startedAt);

  const baseWhere = {
    status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED] },
    nextAttemptAt: { lte: startedAt },
    attempts: { lt: maxAttempts }
  } as const;

  const [inAppCandidates, emailCandidates, unsupportedCandidates] = await Promise.all([
    db.notificationOutbox.findMany({
      where: { ...baseWhere, channel: "IN_APP" },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: maxBatch,
      select: candidateSelect
    }),
    db.notificationOutbox.findMany({
      where: { ...baseWhere, channel: "EMAIL" },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: emailBatch,
      select: candidateSelect
    }),
    db.notificationOutbox.findMany({
      where: { ...baseWhere, channel: { notIn: ["IN_APP", "EMAIL"] } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: candidateSelect
    })
  ]);
  const candidates: NotificationCandidate[] = [
    ...inAppCandidates,
    ...emailCandidates,
    ...unsupportedCandidates
  ];

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
        await deliverInApp(candidate);
      } else if (candidate.channel === "EMAIL") {
        await deliverEmail(candidate);
      } else {
        throw new Error("NOTIFICATION_CHANNEL_UNSUPPORTED");
      }

      const completion = await db.notificationOutbox.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: NotificationOutboxStatus.PROCESSING,
          attempts: attempt
        },
        data: {
          status: NotificationOutboxStatus.DELIVERED,
          deliveredAt: new Date(),
          lockedAt: null,
          lastError: null
        }
      });
      if (completion.count === 1) delivered += 1;
    } catch (error) {
      const boundedError = errorMessage(error);
      const nonRetryable = ["EMAIL_NOTIFICATION_POLICY_BLOCKED", "SMTP_RECIPIENT_INVALID", "NOTIFICATION_CHANNEL_UNSUPPORTED"].includes(boundedError);
      const deadLetter = nonRetryable || attempt >= maxAttempts;
      const now = new Date();
      const completion = await db.notificationOutbox.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: NotificationOutboxStatus.PROCESSING,
          attempts: attempt
        },
        data: {
          status: deadLetter ? NotificationOutboxStatus.DEAD_LETTER : NotificationOutboxStatus.FAILED,
          lockedAt: null,
          nextAttemptAt: deadLetter ? now : new Date(now.getTime() + retryDelayMs(attempt)),
          lastError: boundedError
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
    inAppCandidates: inAppCandidates.length,
    emailCandidates: emailCandidates.length,
    unsupportedCandidates: unsupportedCandidates.length,
    claimed,
    delivered,
    failed,
    deadLettered
  };
}
