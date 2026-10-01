import { DataClassification, PlatformRole, Prisma, WorkflowDefinitionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
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

function bounded(value: string | undefined, max: number) {
  const normalized = value?.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workflows:read")) return forbidden();
  const data = await db.workflowDefinition.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ key: "asc" }, { version: "desc" }],
    include: { steps: { orderBy: { orderIndex: "asc" } } },
    take: 200
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workflows:write")) return forbidden();

  const body = await request.json() as {
    key?: string;
    name?: string;
    version?: number;
    description?: string;
    triggerType?: string;
    steps?: WorkflowStepInput[];
  };

  const key = bounded(body.key, 80);
  const name = bounded(body.name, 160);
  const triggerType = bounded(body.triggerType, 80);
  const description = body.description?.trim() || undefined;
  const version = body.version ?? 1;
  const steps = body.steps ?? [];

  if (!key || !name || !triggerType || !steps.length) {
    return Response.json({ error: "Valid key, name, triggerType and at least one step are required." }, { status: 400 });
  }
  if (description && description.length > 2_000) return Response.json({ error: "description is too long." }, { status: 400 });
  if (!Number.isInteger(version) || version < 1 || version > 1_000) return Response.json({ error: "version must be an integer between 1 and 1000." }, { status: 400 });
  if (steps.length > MAX_STEPS) return Response.json({ error: `A workflow definition may contain at most ${MAX_STEPS} steps.` }, { status: 400 });

  const normalizedSteps = steps.map((step) => ({
    stepKey: bounded(step.stepKey, 80),
    name: bounded(step.name, 160),
    actionType: bounded(step.actionType, 80),
    assigneeRole: step.assigneeRole?.trim() || undefined,
    approvalMode: step.approvalMode?.trim() || undefined,
    slaMinutes: step.slaMinutes
  }));

  if (normalizedSteps.some((step) => !step.stepKey || !step.name || !step.actionType)) {
    return Response.json({ error: "Every step requires bounded stepKey, name and actionType values." }, { status: 400 });
  }
  if (new Set(normalizedSteps.map((step) => step.stepKey)).size !== normalizedSteps.length) {
    return Response.json({ error: "stepKey values must be unique within a workflow definition." }, { status: 400 });
  }
  if (normalizedSteps.some((step) => step.assigneeRole && !Object.values(PlatformRole).includes(step.assigneeRole as PlatformRole))) {
    return Response.json({ error: "assigneeRole must be a valid platform role." }, { status: 400 });
  }
  if (normalizedSteps.some((step) => step.approvalMode && step.approvalMode.length > 80)) {
    return Response.json({ error: "approvalMode is too long." }, { status: 400 });
  }
  if (normalizedSteps.some((step) => step.slaMinutes !== undefined && (!Number.isInteger(step.slaMinutes) || step.slaMinutes < 1 || step.slaMinutes > MAX_SLA_MINUTES))) {
    return Response.json({ error: `slaMinutes must be an integer between 1 and ${MAX_SLA_MINUTES}.` }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.create({
      data: {
        tenantId: ctx.tenantId,
        key,
        name,
        version,
        description,
        triggerType,
        status: WorkflowDefinitionStatus.DRAFT,
        createdById: ctx.actorId,
        steps: {
          create: normalizedSteps.map((step, index) => ({
            tenantId: ctx.tenantId,
            stepKey: step.stepKey!,
            name: step.name!,
            orderIndex: index + 1,
            actionType: step.actionType!,
            assigneeRole: step.assigneeRole,
            approvalMode: step.approvalMode,
            slaMinutes: step.slaMinutes
          }))
        }
      },
      include: { steps: { orderBy: { orderIndex: "asc" } } }
    });
      await appendAudit(tx, ctx, {
        action: "workflow-definition.created",
        resourceType: "WorkflowDefinition",
        resourceId: definition.id,
        classification: DataClassification.INTERNAL,
        purpose: `Created governed workflow draft ${key} v${version} with ${normalizedSteps.length} steps`
      });
      return definition;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "This workflow key and version already exist in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
