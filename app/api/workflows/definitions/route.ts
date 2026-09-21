import { DataClassification, WorkflowDefinitionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:read")) return forbidden();
  const data = await db.workflowDefinition.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ key: "asc" }, { version: "desc" }], include: { steps: { orderBy: { orderIndex: "asc" } } }, take: 200 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:write")) return forbidden();
  const body = await request.json() as { key?: string; name?: string; version?: number; description?: string; triggerType?: string; steps?: Array<{ stepKey?: string; name?: string; actionType?: string; assigneeRole?: string; approvalMode?: string; slaMinutes?: number }> };
  if (!body.key?.trim() || !body.name?.trim() || !body.triggerType?.trim() || !body.steps?.length) return Response.json({ error: "key, name, triggerType and at least one step are required." }, { status: 400 });
  if (body.steps.some((step) => !step.stepKey?.trim() || !step.name?.trim() || !step.actionType?.trim())) return Response.json({ error: "Every step requires stepKey, name and actionType." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const definition = await tx.workflowDefinition.create({
      data: {
        tenantId: ctx.tenantId,
        key: body.key!.trim(),
        name: body.name!.trim(),
        version: body.version ?? 1,
        description: body.description,
        triggerType: body.triggerType!.trim(),
        status: WorkflowDefinitionStatus.DRAFT,
        createdById: ctx.actorId,
        steps: { create: body.steps!.map((step, index) => ({ tenantId: ctx.tenantId, stepKey: step.stepKey!.trim(), name: step.name!.trim(), orderIndex: index + 1, actionType: step.actionType!.trim(), assigneeRole: step.assigneeRole, approvalMode: step.approvalMode, slaMinutes: step.slaMinutes })) }
      },
      include: { steps: { orderBy: { orderIndex: "asc" } } }
    });
    await appendAudit(tx, ctx, { action: "workflow-definition.created", resourceType: "WorkflowDefinition", resourceId: definition.id, classification: DataClassification.INTERNAL });
    return definition;
  });
  return Response.json({ data }, { status: 201 });
}
