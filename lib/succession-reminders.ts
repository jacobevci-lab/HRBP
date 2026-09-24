import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function queueSuccessionReviewReminders() {
  const now = new Date();
  const warningDays = Math.min(90, Math.max(1, Math.floor(runtimeNumber("HRBP_SUCCESSION_REVIEW_WARNING_DAYS", 30))));
  const dueSoonAt = new Date(now.getTime() + warningDays * 86_400_000);
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_SUCCESSION_REMINDER_BATCH_SIZE", 250))));

  const plans = await db.successionPlan.findMany({
    where: {
      active: true,
      ownerId: { not: null },
      reviewDueAt: { not: null, lte: dueSoonAt }
    },
    orderBy: { reviewDueAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      ownerId: true,
      reviewDueAt: true,
      positionId: true
    }
  });

  let dueSoon = 0;
  let overdue = 0;
  let skippedInactiveOwner = 0;

  for (const plan of plans) {
    if (!plan.ownerId || !plan.reviewDueAt) continue;
    const owner = await db.userAccount.findFirst({
      where: { id: plan.ownerId, tenantId: plan.tenantId, active: true },
      select: { id: true }
    });
    if (!owner) {
      skippedInactiveOwner += 1;
      continue;
    }

    const position = await db.position.findFirst({
      where: { id: plan.positionId, tenantId: plan.tenantId },
      select: { positionCode: true, title: true }
    });
    const isOverdue = plan.reviewDueAt < now;
    const eventType = isOverdue ? "SUCCESSION_PLAN_REVIEW_OVERDUE" : "SUCCESSION_PLAN_REVIEW_DUE_SOON";
    const reminderKey = isOverdue ? "overdue" : "due-soon";

    await db.$transaction(async (tx) => {
      await enqueueNotificationOutbox(tx, {
        tenantId: plan.tenantId,
        eventType,
        recipientUserId: owner.id,
        templateKey: isOverdue ? "succession.review-overdue" : "succession.review-due-soon",
        resourceType: "SuccessionPlan",
        resourceId: plan.id,
        dedupeKey: `succession-plan:${plan.id}:review:${reminderKey}:${plan.reviewDueAt!.toISOString().slice(0, 10)}`,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          positionCode: position?.positionCode ?? null,
          positionTitle: position?.title ?? null,
          reviewDueAt: plan.reviewDueAt!.toISOString(),
          warningDays
        }
      });
    });

    if (isOverdue) overdue += 1;
    else dueSoon += 1;
  }

  return {
    scanned: plans.length,
    queuedDueSoon: dueSoon,
    queuedOverdue: overdue,
    skippedInactiveOwner,
    dueSoonWindowDays: warningDays
  };
}
