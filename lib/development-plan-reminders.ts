import { DataClassification, DevelopmentPlanStatus, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function queueDevelopmentPlanReminders() {
  const now = new Date();
  const warningDays = Math.min(90, Math.max(1, Math.floor(runtimeNumber("HRBP_DEVELOPMENT_PLAN_WARNING_DAYS", 30))));
  const dueSoonAt = new Date(now.getTime() + warningDays * 86_400_000);
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_DEVELOPMENT_PLAN_REMINDER_BATCH_SIZE", 250))));

  const plans = await db.developmentPlan.findMany({
    where: {
      status: DevelopmentPlanStatus.ACTIVE,
      targetAt: { lte: dueSoonAt }
    },
    orderBy: { targetAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      employmentId: true,
      ownerId: true,
      title: true,
      targetAt: true,
      targetProficiency: true,
      focusSkill: { select: { code: true, name: true } }
    }
  });

  let ownerDueSoon = 0;
  let ownerOverdue = 0;
  let ownerRoleFallback = 0;
  let employeeDueSoon = 0;
  let employeeOverdue = 0;
  let skippedUnprovisionedEmployee = 0;

  for (const plan of plans) {
    const [owner, employment] = await Promise.all([
      db.userAccount.findFirst({
        where: { id: plan.ownerId, tenantId: plan.tenantId, active: true },
        select: { id: true }
      }),
      db.employment.findFirst({
        where: { id: plan.employmentId, tenantId: plan.tenantId },
        select: { person: { select: { workEmail: true } } }
      })
    ]);

    const employeeEmail = employment?.person.workEmail?.trim();
    const employeeUser = employeeEmail ? await db.userAccount.findFirst({
      where: { tenantId: plan.tenantId, active: true, email: { equals: employeeEmail, mode: "insensitive" } },
      select: { id: true }
    }) : null;

    const isOverdue = plan.targetAt < now;
    const eventType = isOverdue ? "DEVELOPMENT_PLAN_OVERDUE" : "DEVELOPMENT_PLAN_DUE_SOON";
    const reminderKey = isOverdue ? "overdue" : "due-soon";
    const payload = {
      planTitle: plan.title,
      targetAt: plan.targetAt.toISOString(),
      skillCode: plan.focusSkill?.code ?? null,
      skillName: plan.focusSkill?.name ?? null,
      targetProficiency: plan.targetProficiency,
      warningDays,
      reminderState: reminderKey
    };

    await db.$transaction(async (tx) => {
      await enqueueNotificationOutbox(tx, {
        tenantId: plan.tenantId,
        eventType,
        recipientUserId: owner?.id ?? null,
        recipientRole: owner ? null : PlatformRole.TALENT_ADMIN,
        templateKey: isOverdue ? "talent.development-plan-overdue" : "talent.development-plan-due-soon",
        resourceType: "DevelopmentPlan",
        resourceId: plan.id,
        dedupeKey: `development-plan:${plan.id}:owner:${reminderKey}:${plan.targetAt.toISOString().slice(0, 10)}`,
        classification: DataClassification.CONFIDENTIAL,
        payload
      });

      if (employeeUser && employeeUser.id !== owner?.id) {
        await enqueueNotificationOutbox(tx, {
          tenantId: plan.tenantId,
          eventType,
          recipientUserId: employeeUser.id,
          templateKey: isOverdue ? "talent.development-plan-overdue" : "talent.development-plan-due-soon",
          resourceType: "DevelopmentPlanParticipant",
          resourceId: plan.id,
          dedupeKey: `development-plan:${plan.id}:employee:${reminderKey}:${plan.targetAt.toISOString().slice(0, 10)}`,
          classification: DataClassification.CONFIDENTIAL,
          payload
        });
      }
    });

    if (!owner) ownerRoleFallback += 1;
    else if (isOverdue) ownerOverdue += 1;
    else ownerDueSoon += 1;

    if (!employeeUser) skippedUnprovisionedEmployee += 1;
    else if (employeeUser.id !== owner?.id) {
      if (isOverdue) employeeOverdue += 1;
      else employeeDueSoon += 1;
    }
  }

  return {
    scanned: plans.length,
    queuedOwnerDueSoon: ownerDueSoon,
    queuedOwnerOverdue: ownerOverdue,
    queuedOwnerRoleFallback: ownerRoleFallback,
    queuedEmployeeDueSoon: employeeDueSoon,
    queuedEmployeeOverdue: employeeOverdue,
    skippedUnprovisionedEmployee,
    dueSoonWindowDays: warningDays
  };
}
