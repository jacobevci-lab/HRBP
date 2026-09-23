import { DataClassification, Prisma } from "@prisma/client";

export type NotificationOutboxEvent = {
  tenantId: string;
  eventType: string;
  recipientUserId?: string | null;
  recipientRole?: string | null;
  templateKey?: string | null;
  resourceType: string;
  resourceId: string;
  dedupeKey: string;
  channel?: string;
  classification?: DataClassification;
  payload?: Prisma.InputJsonValue;
};

/**
 * Writes notification intent inside the caller's domain transaction.
 *
 * The tenant-scoped dedupe key makes repeated maintenance runs safe while
 * preserving the transactional-outbox guarantee: a state transition cannot
 * commit without its notification intent, and vice versa.
 */
export async function enqueueNotificationOutbox(tx: Prisma.TransactionClient, event: NotificationOutboxEvent) {
  return tx.notificationOutbox.upsert({
    where: {
      tenantId_dedupeKey: {
        tenantId: event.tenantId,
        dedupeKey: event.dedupeKey
      }
    },
    update: {},
    create: {
      tenantId: event.tenantId,
      eventType: event.eventType,
      channel: event.channel ?? "IN_APP",
      recipientUserId: event.recipientUserId ?? null,
      recipientRole: event.recipientRole ?? null,
      templateKey: event.templateKey ?? null,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      dedupeKey: event.dedupeKey,
      classification: event.classification ?? DataClassification.CONFIDENTIAL,
      ...(event.payload === undefined ? {} : { payload: event.payload })
    },
    select: {
      id: true,
      status: true,
      dedupeKey: true
    }
  });
}
