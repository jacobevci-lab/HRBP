import { DataClassification, PlatformRole, Prisma, WorkflowDefinitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_STEPS = 50;
const MAX_SLA_MINUTES = 43_200;

type WorkflowStepInput = {
  stepKey?: string;
  name?: string;
  actionType?: string;
  assigneeRole?: string;
  approvalMode?: string;
  slaMinutes?: number;
};

function bounded(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function normalizeSteps(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_STEPS) return null;
  const steps = value.map((raw) => {
    const step = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as WorkflowStepInput : {};
    return {
      stepKey: bounded(step.stepKey, 80),
      name: bounded(step.name, 160),
      actionType: bounded(step.actionType, 80),
      assigneeRole: typeof step.assigneeRole === "string" && step.assigneeRole.trim() ? step.assigneeRole.trim() : undefined,
      approvalMode: typeof step.approvalMode === "string" && step.approvalMode.trim() ? step.approvalMode.trim() : undefined,
      slaMinutes: step.slaMinutes
    };
  });
  if (steps.some((step) => !step.stepKey || !step.name || !step.actionType)) return null;
  if (new Set(steps.map((step) => step.stepKey)).size !== steps.length) return null;
  if (steps.some((step) => step.assigneeRole && !Object.values(PlatformRole).includes(step.assigneeRole as PlatformRole))) return null;
  if (steps.some((step) => step.approvalMode && step.approvalMode.length > 80)) return null;
  if (steps.some((step) => step.slaMinutes !== undefined && (!Number.isInteger(step.slaMinutes) || step.slaMinutes < 1 || step.slaMinutes > MAX_SLA_MINUTES))) return null;
  return steps;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workflows:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid workflow definition id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const name = bounded(body.name, 160);
  const triggerType = bounded(body.triggerType, 80);
  const description = body.description === undefined || body.description === null || body.description === ""
    ? undefined
    : bounded(body.description, 2_000);
  const steps = normalizeSteps(body.steps);

  if (!name || !triggerType || !steps) {
    return Response.json({ error: "Valid name, triggerType and 1-50 governed steps are required." }, { status: 400 });
  }
  if (body.description && description === null) return Response.json({ error: "description is too long." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const current = await tx.workflowDefinition.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, key: true, version: true, status: true, createdById: true, updatedAt: true }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.status !== WorkflowDefinitionStatus.DRAFT) throw new Error("NOT_DRAFT");

      const updatedCount = await tx.workflowDefinition.updateMany({
        where: { id: current.id, tenantId: ctx.tenantId, status: WorkflowDefinitionStatus.DRAFT, updatedAt: current.updatedAt },
        data: { name, triggerType, description }
      });
      if (updatedCount.count !== 1) throw new Error("STATE_CONFLICT");

      await tx.workflowStepDefinition.deleteMany({ where: { tenantId: ctx.tenantId, definitionId: current.id } });
      await tx.workflowStepDefinition.createMany({
        data: steps.map((step, index) => ({
          tenantId: ctx.tenantId,
          definitionId: current.id,
          stepKey: step.stepKey!,
          name: step.name!,
          orderIndex: index + 1,
          actionType: step.actionType!,
          assigneeRole: step.assigneeRole,
          approvalMode: step.approvalMode,
          slaMinutes: step.slaMinutes
        }))
      });

      await appendAudit(tx, ctx, {
        action: "workflow-definition.draft-updated",
        resourceType: "WorkflowDefinition",
        resourceId: current.id,
        classification: DataClassification.INTERNAL,
        purpose: `Updated governed workflow draft ${current.key} v${current.version} with ${steps.length} steps`
      });

      return tx.workflowDefinition.findUnique({
        where: { id: current.id },
        include: { steps: { orderBy: { orderIndex: "asc" } } }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Workflow definition not found in tenant." }, { status: 404 });
    if (code === "NOT_DRAFT") return Response.json({ error: "Only DRAFT workflow definitions can be edited. Create a new version for governed changes." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Workflow draft changed concurrently. Refresh and retry." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Workflow draft changed concurrently. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
