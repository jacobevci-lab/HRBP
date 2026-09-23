import { DataClassification, Prisma, WorkflowInstanceStatus, WorkflowTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:run")) return forbidden();
  if (!mutationOriginAllowed(request)) return Response.json({ error: "Mutation origin is not allowed." }, { status: 403 });
  const { id, taskId } = await params;
  const body = await request.json() as { result?: unknown };
  const data = await db.$transaction(async (tx) => {
    const instance = await tx.workflowInstance.findFirst({
      where: { id, tenantId: ctx.tenantId, status: { in: [WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.WAITING] } },
      include: {
        definition: {
          select: {
            name: true,
            steps: { orderBy: { orderIndex: "asc" }, select: { stepKey: true, orderIndex: true } }
          }
        },
        tasks: true
      }
    });
    if (!instance) throw new Error("NOT_FOUND");
    const task = instance.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("TASK");
    if (task.status !== WorkflowTaskStatus.READY && task.status !== WorkflowTaskStatus.IN_PROGRESS) throw new Error("STATE");
    if (task.assigneeId && task.assigneeId !== ctx.actorId) throw new Error("ASSIGNMENT");
    if (!task.assigneeId && task.assigneeRole && task.assigneeRole !== ctx.role) throw new Error("ASSIGNMENT");

    const now = new Date();
    await tx.workflowTask.update({
      where: { id: taskId },
      data: { status: WorkflowTaskStatus.COMPLETED, completedAt: now, result: body.result as Prisma.InputJsonValue | undefined }
    });
    const remaining = await tx.workflowTask.findMany({
      where: { tenantId: ctx.tenantId, instanceId: id, status: { in: [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.READY, WorkflowTaskStatus.IN_PROGRESS] } }
    });
    const orderByStep = new Map(instance.definition.steps.map((step) => [step.stepKey, step.orderIndex]));
    remaining.sort((left, right) => (orderByStep.get(left.stepKey) ?? Number.MAX_SAFE_INTEGER) - (orderByStep.get(right.stepKey) ?? Number.MAX_SAFE_INTEGER));
    const next = remaining[0];
    if (next) {
      const activated = await tx.workflowTask.update({
        where: { id: next.id },
        data: { status: WorkflowTaskStatus.READY, startedAt: next.startedAt ?? now }
      });
      if (activated.assigneeId || activated.assigneeRole) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "WORKFLOW_TASK_READY",
          recipientUserId: activated.assigneeId,
          recipientRole: activated.assigneeRole,
          templateKey: "workflow.task-ready",
          resourceType: "WorkflowTask",
          resourceId: activated.id,
          dedupeKey: `workflow-task:${activated.id}:ready`,
          classification: DataClassification.INTERNAL,
          payload: {
            workflowName: instance.definition.name,
            taskName: activated.name,
            instanceId: instance.id,
            subjectType: instance.subjectType,
            subjectId: instance.subjectId,
            dueAt: activated.dueAt?.toISOString() ?? null
          }
        });
      }
    } else {
      await tx.workflowInstance.update({ where: { id }, data: { status: WorkflowInstanceStatus.COMPLETED, completedAt: now } });
    }
    await tx.workflowEvent.create({ data: { tenantId: ctx.tenantId, instanceId: id, eventType: next ? "workflow.task-completed" : "workflow.completed", actorId: ctx.actorId, payload: { taskId, nextTaskId: next?.id ?? null } } });
    await appendAudit(tx, ctx, { action: "workflow.task-completed", resourceType: "WorkflowTask", resourceId: taskId, classification: DataClassification.INTERNAL });
    return { completedTaskId: taskId, nextTaskId: next?.id ?? null, instanceCompleted: !next };
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "TASK", "STATE", "ASSIGNMENT"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Running workflow instance not found." }, { status: 404 });
  if (data === "TASK") return Response.json({ error: "Task not found in workflow instance." }, { status: 404 });
  if (data === "STATE") return Response.json({ error: "Task is not in a completable state." }, { status: 409 });
  if (data === "ASSIGNMENT") return forbidden("This workflow task is assigned to another user or role.");
  return Response.json({ data });
}
