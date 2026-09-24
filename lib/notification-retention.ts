import { NotificationOutboxStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { runtimeNumber } from "@/lib/runtime-env";

function retentionDays(name: string, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(runtimeNumber(name, fallback))));
}

function cutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function pruneNotificationOutbox(now = new Date()) {
  const readDays = retentionDays("HRBP_NOTIFICATION_READ_RETENTION_DAYS", 180, 30, 3650);
  const unreadDays = retentionDays("HRBP_NOTIFICATION_UNREAD_RETENTION_DAYS", 365, readDays, 3650);
  const sourceDays = retentionDays("HRBP_NOTIFICATION_SOURCE_RETENTION_DAYS", 90, 14, 3650);
  const deadLetterDays = retentionDays("HRBP_NOTIFICATION_DEAD_LETTER_RETENTION_DAYS", 180, 30, 3650);

  const [readDelivered, staleUnread, roleSources, deadLetters] = await db.$transaction([
    db.notificationOutbox.deleteMany({
      where: {
        status: NotificationOutboxStatus.DELIVERED,
        recipientUserId: { not: null },
        readAt: { not: null, lt: cutoff(now, readDays) }
      }
    }),
    db.notificationOutbox.deleteMany({
      where: {
        status: NotificationOutboxStatus.DELIVERED,
        recipientUserId: { not: null },
        readAt: null,
        deliveredAt: { lt: cutoff(now, unreadDays) }
      }
    }),
    db.notificationOutbox.deleteMany({
      where: {
        status: NotificationOutboxStatus.DELIVERED,
        recipientUserId: null,
        recipientRole: { not: null },
        deliveredAt: { lt: cutoff(now, sourceDays) }
      }
    }),
    db.notificationOutbox.deleteMany({
      where: {
        status: NotificationOutboxStatus.DEAD_LETTER,
        updatedAt: { lt: cutoff(now, deadLetterDays) }
      }
    })
  ]);

  return {
    deleted: {
      readDelivered: readDelivered.count,
      staleUnread: staleUnread.count,
      roleSources: roleSources.count,
      deadLetters: deadLetters.count,
      total: readDelivered.count + staleUnread.count + roleSources.count + deadLetters.count
    },
    retentionDays: { read: readDays, unread: unreadDays, roleSource: sourceDays, deadLetter: deadLetterDays }
  };
}
