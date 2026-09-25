import { AccessRevocationStatus, AssetReturnStatus, DataClassification, ExitTaskStatus, PlatformRole, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

const OPEN_TASK_STATUSES = [ExitTaskStatus.NOT_STARTED, ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.BLOCKED];
const TERMINAL_TASK_STATUSES = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
const TERMINAL_PROCESS_STATUSES = [SeparationStatus.CLOSED, SeparationStatus.CANCELLED];

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:offboarding-readiness",
    role: PlatformRole.HR_OPERATIONS,
    purpose: "Scheduled offboarding readiness monitoring"
  };
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function recipientRoleForDomain(domain: string) {
  const normalized = domain.trim().toUpperCase();
  if (normalized === "PAYROLL") return PlatformRole.PAYROLL_ADMIN;
  if (normalized === "LEGAL") return PlatformRole.LEGAL;
  return PlatformRole.HR_OPERATIONS;
}

export async function queueOffboardingReadinessReminders(now = new Date()) {
  const dueSoonHours = Math.max(1, Math.floor(runtimeNumber("HRBP_OFFBOARDING_DUE_SOON_HOURS", 48)));
  const exitRiskHours = Math.max(1, Math.floor(runtimeNumber("HRBP_OFFBOARDING_EXIT_RISK_HOURS", 72)));
  const batchSize = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_OFFBOARDING_REMINDER_BATCH_SIZE", 250))));
  const dueSoonEnd = new Date(now.getTime() + dueSoonHours * 60 * 60 * 1000);
  const exitRiskEnd = new Date(now.getTime() + exitRiskHours * 60 * 60 * 1000);
  const today = dayKey(now);

  const taskRows = await db.separationTask.findMany({
    where: {
      status: { in: OPEN_TASK_STATUSES },
      process: { status: { notIn: TERMINAL_PROCESS_STATUSES } },
      OR: [
        { status: ExitTaskStatus.BLOCKED },
        { dueAt: { lte: dueSoonEnd } }
      ]
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: batchSize,
    select: {
      id: true,
      tenantId: true,
      title: true,
      domain: true,
      ownerId: true,
      status: true,
      dueAt: true,
      blocking: true,
      process: { select: { id: true, lastWorkingDate: true, initiatedById: true } }
    }
  });

  let taskNotificationsQueued = 0;
  let blockedTasks = 0;
  let overdueTasks = 0;
  let dueSoonTasks = 0;

  for (const task of taskRows) {
    const reminderState = task.status === ExitTaskStatus.BLOCKED
      ? "blocked"
      : task.dueAt && task.dueAt < now
        ? "overdue"
        : "due-soon";
    const eventType = reminderState === "blocked"
      ? "OFFBOARDING_TASK_BLOCKED"
      : reminderState === "overdue"
        ? "OFFBOARDING_TASK_OVERDUE"
        : "OFFBOARDING_TASK_DUE_SOON";
    const dedupeKey = `offboarding-task:${task.id}:${reminderState}:${today}`;

    const queued = await db.$transaction(async (tx) => {
      const existing = await tx.notificationOutbox.findUnique({
        where: { tenantId_dedupeKey: { tenantId: task.tenantId, dedupeKey } },
        select: { id: true }
      });
      if (existing) return false;

      await enqueueNotificationOutbox(tx, {
        tenantId: task.tenantId,
        eventType,
        recipientUserId: task.ownerId,
        recipientRole: task.ownerId ? null : recipientRoleForDomain(task.domain),
        templateKey: "offboarding.task-readiness",
        resourceType: "SeparationTask",
        resourceId: task.id,
        dedupeKey,
        classification: DataClassification.RESTRICTED,
        payload: {
          separationProcessId: task.process.id,
          taskName: task.title,
          domain: task.domain,
          reminderState,
          blocking: task.blocking,
          dueAt: task.dueAt?.toISOString() ?? null,
          lastWorkingDate: task.process.lastWorkingDate.toISOString()
        }
      });
      await appendAudit(tx, systemContext(task.tenantId), {
        action: `offboarding-task.${reminderState}`,
        resourceType: "SeparationTask",
        resourceId: task.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Scheduled exit readiness reminder: ${reminderState}`
      });
      return true;
    });

    if (!queued) continue;
    taskNotificationsQueued += 1;
    if (reminderState === "blocked") blockedTasks += 1;
    else if (reminderState === "overdue") overdueTasks += 1;
    else dueSoonTasks += 1;
  }

  const processRows = await db.separationProcess.findMany({
    where: {
      status: { notIn: [...TERMINAL_PROCESS_STATUSES, SeparationStatus.READY_TO_CLOSE] },
      lastWorkingDate: { lte: exitRiskEnd }
    },
    orderBy: { lastWorkingDate: "asc" },
    take: batchSize,
    select: {
      id: true,
      tenantId: true,
      initiatedById: true,
      type: true,
      status: true,
      lastWorkingDate: true,
      tasks: { select: { status: true, blocking: true } },
      assets: { select: { status: true } },
      accessRevocations: { select: { status: true } }
    }
  });

  let exitRiskNotificationsQueued = 0;
  for (const process of processRows) {
    const openBlockingTasks = process.tasks.filter((task) => task.blocking && !TERMINAL_TASK_STATUSES.includes(task.status)).length;
    const openAssets = process.assets.filter((asset) => asset.status !== AssetReturnStatus.RETURNED && asset.status !== AssetReturnStatus.WRITTEN_OFF).length;
    const openAccess = process.accessRevocations.filter((access) => access.status !== AccessRevocationStatus.REVOKED && access.status !== AccessRevocationStatus.EXCEPTION).length;
    if (openBlockingTasks === 0 && openAssets === 0 && openAccess === 0) continue;

    const dedupeKey = `offboarding-process:${process.id}:exit-risk:${today}`;
    const queued = await db.$transaction(async (tx) => {
      const existing = await tx.notificationOutbox.findUnique({
        where: { tenantId_dedupeKey: { tenantId: process.tenantId, dedupeKey } },
        select: { id: true }
      });
      if (existing) return false;

      await enqueueNotificationOutbox(tx, {
        tenantId: process.tenantId,
        eventType: "OFFBOARDING_EXIT_READINESS_RISK",
        recipientUserId: process.initiatedById,
        templateKey: "offboarding.exit-readiness-risk",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        dedupeKey,
        classification: DataClassification.RESTRICTED,
        payload: {
          separationProcessId: process.id,
          separationType: process.type,
          processStatus: process.status,
          reminderState: "exit-risk",
          lastWorkingDate: process.lastWorkingDate.toISOString(),
          openBlockingTasks,
          openAssets,
          openAccess
        }
      });
      await appendAudit(tx, systemContext(process.tenantId), {
        action: "offboarding-process.exit-readiness-risk",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Last working date is approaching while governed exit controls remain open"
      });
      return true;
    });
    if (queued) exitRiskNotificationsQueued += 1;
  }

  return {
    taskNotificationsQueued,
    blockedTasks,
    overdueTasks,
    dueSoonTasks,
    exitRiskNotificationsQueued,
    dueSoonHours,
    exitRiskHours,
    batchSize
  };
}
