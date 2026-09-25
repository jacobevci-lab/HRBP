import { DataClassification, OnboardingStatus, OnboardingTaskStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

const OPEN_TASK_STATUSES: OnboardingTaskStatus[] = [
  OnboardingTaskStatus.NOT_STARTED,
  OnboardingTaskStatus.IN_PROGRESS,
  OnboardingTaskStatus.BLOCKED
];

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:onboarding-readiness",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled onboarding readiness monitoring"
  };
}

async function managerRecipientUserId(tenantId: string, workEmail: string | null | undefined) {
  if (!workEmail) return null;
  const user = await db.userAccount.findFirst({
    where: {
      tenantId,
      active: true,
      email: { equals: workEmail, mode: "insensitive" }
    },
    select: { id: true }
  });
  return user?.id ?? null;
}

export async function queueOnboardingReadinessReminders() {
  const now = new Date();
  const dueSoonHours = Math.min(336, Math.max(1, Math.floor(runtimeNumber("HRBP_ONBOARDING_DUE_SOON_HOURS", 48))));
  const startRiskHours = Math.min(336, Math.max(1, Math.floor(runtimeNumber("HRBP_ONBOARDING_START_RISK_HOURS", 72))));
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_ONBOARDING_REMINDER_BATCH_SIZE", 300))));
  const dueSoonAt = new Date(now.getTime() + dueSoonHours * 60 * 60 * 1000);
  const startRiskAt = new Date(now.getTime() + startRiskHours * 60 * 60 * 1000);

  const tasks = await db.onboardingTask.findMany({
    where: {
      status: { in: OPEN_TASK_STATUSES },
      plan: { status: { not: OnboardingStatus.COMPLETED } },
      OR: [
        { status: OnboardingTaskStatus.BLOCKED },
        { dueDate: { not: null, lte: dueSoonAt } }
      ]
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      title: true,
      ownerType: true,
      status: true,
      dueDate: true,
      sensitive: true,
      plan: {
        select: {
          id: true,
          ownerId: true,
          targetStartDate: true,
          person: { select: { givenName: true, familyName: true } },
          employment: {
            select: {
              manager: { select: { person: { select: { workEmail: true } } } }
            }
          }
        }
      }
    }
  });

  let queuedBlocked = 0;
  let queuedDueSoon = 0;
  let queuedOverdue = 0;

  for (const task of tasks) {
    const dueAt = task.dueDate;
    const blocked = task.status === OnboardingTaskStatus.BLOCKED;
    const overdue = Boolean(!blocked && dueAt && dueAt < now);
    const eventType = blocked ? "ONBOARDING_TASK_BLOCKED" : overdue ? "ONBOARDING_TASK_OVERDUE" : "ONBOARDING_TASK_DUE_SOON";
    const reminderState = blocked ? "blocked" : overdue ? "overdue" : "due-soon";
    const dedupeKey = `onboarding-task:${task.id}:${reminderState}`;

    let recipientUserId = task.plan.ownerId;
    if (task.ownerType.trim().toUpperCase() === "MANAGER") {
      const managerId = await managerRecipientUserId(task.tenantId, task.plan.employment?.manager?.person.workEmail);
      if (managerId) recipientUserId = managerId;
    }

    const queued = await db.$transaction(async (tx) => {
      const existing = await tx.notificationOutbox.findUnique({
        where: { tenantId_dedupeKey: { tenantId: task.tenantId, dedupeKey } },
        select: { id: true }
      });
      if (existing) return false;

      await enqueueNotificationOutbox(tx, {
        tenantId: task.tenantId,
        eventType,
        recipientUserId,
        recipientRole: recipientUserId ? null : PlatformRole.HR_OPERATIONS,
        templateKey: `onboarding.task-${reminderState}`,
        resourceType: "OnboardingTask",
        resourceId: task.id,
        dedupeKey,
        classification: task.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
        payload: {
          onboardingPlanId: task.plan.id,
          employeeName: `${task.plan.person.givenName} ${task.plan.person.familyName}`,
          taskName: task.title,
          ownerType: task.ownerType,
          taskStatus: task.status,
          reminderState,
          targetStartDate: task.plan.targetStartDate.toISOString(),
          ...(dueAt ? { dueAt: dueAt.toISOString() } : {})
        }
      });

      await appendAudit(tx, systemContext(task.tenantId), {
        action: `onboarding-task.${reminderState}`,
        resourceType: "OnboardingTask",
        resourceId: task.id,
        classification: task.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
        purpose: blocked
          ? "Open onboarding blocker escalated to the accountable participant"
          : overdue
            ? `Onboarding task due date elapsed${dueAt ? ` at ${dueAt.toISOString()}` : ""}`
            : `Onboarding task is due within ${dueSoonHours} hours`
      });
      return true;
    });

    if (!queued) continue;
    if (blocked) queuedBlocked += 1;
    else if (overdue) queuedOverdue += 1;
    else queuedDueSoon += 1;
  }

  const plans = await db.onboardingPlan.findMany({
    where: {
      status: { not: OnboardingStatus.COMPLETED },
      targetStartDate: { lte: startRiskAt }
    },
    orderBy: { targetStartDate: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      ownerId: true,
      status: true,
      targetStartDate: true,
      person: { select: { givenName: true, familyName: true } },
      tasks: {
        where: { status: { in: OPEN_TASK_STATUSES } },
        select: { id: true, title: true, status: true }
      }
    }
  });

  let queuedStartRisk = 0;
  for (const plan of plans) {
    if (!plan.tasks.length) continue;
    const dedupeKey = `onboarding-plan:${plan.id}:start-readiness-risk`;
    const blockedTasks = plan.tasks.filter((task) => task.status === OnboardingTaskStatus.BLOCKED);
    const queued = await db.$transaction(async (tx) => {
      const existing = await tx.notificationOutbox.findUnique({
        where: { tenantId_dedupeKey: { tenantId: plan.tenantId, dedupeKey } },
        select: { id: true }
      });
      if (existing) return false;

      await enqueueNotificationOutbox(tx, {
        tenantId: plan.tenantId,
        eventType: "ONBOARDING_START_READINESS_RISK",
        recipientUserId: plan.ownerId,
        recipientRole: plan.ownerId ? null : PlatformRole.HR_OPERATIONS,
        templateKey: "onboarding.start-readiness-risk",
        resourceType: "OnboardingPlan",
        resourceId: plan.id,
        dedupeKey,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          onboardingPlanId: plan.id,
          employeeName: `${plan.person.givenName} ${plan.person.familyName}`,
          targetStartDate: plan.targetStartDate.toISOString(),
          outstandingTaskCount: plan.tasks.length,
          blockedTaskCount: blockedTasks.length,
          reminderState: "start-risk"
        }
      });

      await appendAudit(tx, systemContext(plan.tenantId), {
        action: "onboarding-plan.start-readiness-risk",
        resourceType: "OnboardingPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `${plan.tasks.length} onboarding tasks remain open within ${startRiskHours} hours of the target start; ${blockedTasks.length} are blocked`
      });
      return true;
    });
    if (queued) queuedStartRisk += 1;
  }

  return {
    scannedTasks: tasks.length,
    queuedBlocked,
    queuedDueSoon,
    queuedOverdue,
    scannedStartRiskPlans: plans.length,
    queuedStartRisk,
    dueSoonWindowHours: dueSoonHours,
    startRiskWindowHours: startRiskHours
  };
}
