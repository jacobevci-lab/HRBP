import { DataClassification, Prisma, WorkflowDefinitionStatus, WorkflowInstanceStatus, WorkflowTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:read")) return forbidden();
  const data = await db.workflowInstance.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, include: { definition: { select: { key: true, name: true, version: true } }, tasks: { orderBy: { dueAt: "asc" } } }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:run")) return forbidden();
  const body = await request.json() as { definitionId?: string; subjectType?: string; subjectId?: string; context?: unknown };
  if (!body.definitionId || !body.subjectType?.trim() || !body.subjectId?.trim()) return Response.json({ error: "definitionId, subjectType and subjectId are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const definition = await tx.workflowDefinition.findFirst({ where: { id: body.definitionId, tenantId: ctx.tenantId, status: WorkflowDefinitionStatus.ACTIVE }, include: { steps: { orderBy: { orderIndex: "asc" } } } });
    if (!definition) throw new Error("NOT_FOUND");
    const startedAt = new Date();
    const instance = await tx.workflowInstance.create({
      data: {
        tenantId: ctx.tenantId,
        definitionId: definition.id,
        subjectType: body.subjectType!.trim(),
        subjectId: body.subjectId!.trim(),
        status: WorkflowInstanceStatus.RUNNING,
        startedById: ctx.actorId,
        context: body.context === undefined ? undefined : body.context as Prisma.InputJsonValue,
        tasks: { create: definition.steps.map((step, index) => ({ tenantId: ctx.tenantId, stepKey: step.stepKey, name: step.name, assigneeRole: step.assigneeRole, status: index === 0 ? WorkflowTaskStatus.READY : WorkflowTaskStatus.PENDING, dueAt: step.slaMinutes ? new Date(startedAt.getTime() + step.slaMinutes * 60_000) : undefined })) },
        events: { create: { tenantId: ctx.tenantId, eventType: "workflow.started", actorId: ctx.actorId, payload: { definitionKey: definition.key, definitionVersion: definition.version } } }
      },
      include: { tasks: true }
    });
    await appendAudit(tx, ctx, { action: "workflow-instance.started", resourceType: "WorkflowInstance", resourceId: instance.id, classification: DataClassification.INTERNAL });
    return instance;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Active workflow definition not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
