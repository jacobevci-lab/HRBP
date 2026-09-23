import { DataClassification, WorkflowInstanceStatus, WorkflowTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { runtimeNumber } from "@/lib/runtime-env";

export async function queueWorkflowReminders() {
  const now = new Date();
  const warningMinutes = Math.min(10_080, Math.max(15, Math.floor(runtimeNumber("HRBP_WORKFLOW_DUE_SOON_MINUTES", 1440))));
  const dueSoonAt = new Date(now.getTime() + warningMinutes * 60_000);
  const maxBatch = Math.min(1000, Math.max(50, Math.floor(runtimeNumber("HRBP_WORKFLOW_REMINDER_BATCH_SIZE", 500))));

  const tasks = await db.workflowTask.findMany({
    where: {
      status: { in: [WorkflowTaskStatus.READY, WorkflowTaskStatus.IN_PROGRESS] },
      dueAt: { not: null, lte: dueSoonAt },
      instance: { status: { in: [WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.WAITING] } },
      OR: [{ assigneeId: { not: null } }, { assigneeRole: { not: null } }]
    },
    orderBy: { dueAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      name: true,
      assigneeId: true,
      assigneeRole: true,
      dueAt: true,
      instance: {
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          definition: { select: { name: true } }
        }
      }
    }
  });

  let dueSoon = 0;
  let overdue = 0;

  for (const task of tasks) {
    if (!task.dueAt) continue;
    const isOverdue = task.dueAt < now;
    const eventType = isOverdue ? "WORKFLOW_TASK_OVERDUE" : "WORKFLOW_TASK_DUE_SOON";
    const reminderKey = isOverdue ? "overdue" : "due-soon";
    await db.$transaction(async (tx) => {
      await enqueueNotificationOutbox(tx, {
        tenantId: task.tenantId,
        eventType,
        recipientUserId: task.assigneeId,
        recipientRole: task.assigneeRole,
        templateKey: isOverdue ? "workflow.task-overdue" : "workflow.task-due-soon",
        resourceType: "WorkflowTask",
        resourceId: task.id,
        dedupeKey: `workflow-task:${task.id}:${reminderKey}`,
        classification: DataClassification.INTERNAL,
        payload: {
          workflowName: task.instance.definition.name,
          taskName: task.name,
          instanceId: task.instance.id,
          subjectType: task.instance.subjectType,
          subjectId: task.instance.subjectId,
          dueAt: task.dueAt.toISOString(),
          warningMinutes
        }
      });
    });
    if (isOverdue) overdue += 1;
    else dueSoon += 1;
  }

  return {
    scanned: tasks.length,
    queuedDueSoon: dueSoon,
    queuedOverdue: overdue,
    dueSoonWindowMinutes: warningMinutes
  };
}
