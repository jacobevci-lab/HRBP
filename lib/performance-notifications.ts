import type { Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

type PerformanceNotificationInput = {
  tenantId: string;
  eventType: "PERFORMANCE_SELF_REVIEW_READY" | "PERFORMANCE_MANAGER_REVIEW_READY";
  recipientEmploymentId: string;
  reviewId: string;
  cycleName: string;
  participantName?: string | null;
  dedupeKey: string;
};

async function activeUserForEmployment(
  tx: Prisma.TransactionClient,
  tenantId: string,
  employmentId: string
) {
  const employment = await tx.employment.findFirst({
    where: { id: employmentId, tenantId },
    select: { person: { select: { workEmail: true } } }
  });
  const email = employment?.person.workEmail?.trim();
  if (!email) return null;

  return tx.userAccount.findFirst({
    where: {
      tenantId,
      active: true,
      email: { equals: email, mode: "insensitive" }
    },
    select: { id: true }
  });
}

/**
 * Resolves a performance participant through the same work-email identity
 * bridge used by OIDC session binding. Missing/unprovisioned identities do not
 * block the governed domain transaction; they simply do not receive an in-app
 * notification until an active UserAccount exists.
 */
export async function enqueuePerformanceParticipantNotification(
  tx: Prisma.TransactionClient,
  input: PerformanceNotificationInput
) {
  const user = await activeUserForEmployment(tx, input.tenantId, input.recipientEmploymentId);
  if (!user) return null;

  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.eventType,
    recipientUserId: user.id,
    resourceType: "PerformanceReview",
    resourceId: input.reviewId,
    dedupeKey: input.dedupeKey,
    payload: {
      cycleName: input.cycleName,
      ...(input.participantName ? { participantName: input.participantName } : {})
    }
  });
}
