import { DataClassification, Prisma, WorkflowDefinitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type DefinitionAction = "ACTIVATE" | "PAUSE" | "RETIRE";
const actions: DefinitionAction[] = ["ACTIVATE", "PAUSE", "RETIRE"];
const activatableStatuses = new Set<WorkflowDefinitionStatus>([WorkflowDefinitionStatus.DRAFT, WorkflowDefinitionStatus.PAUSED]);
const retirableStatuses = new Set<WorkflowDefinitionStatus>([WorkflowDefinitionStatus.DRAFT, WorkflowDefinitionStatus.PAUSED]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workflows:approve")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid workflow definition id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const action = asEnumValue(body.action, actions);
  if (!action) return Response.json({ error: "action must be ACTIVATE, PAUSE or RETIRE." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.workflowDefinition.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, key: true, status: true, createdById: true }
    });
    if (!current) throw new Error("NOT_FOUND");

    let status: WorkflowDefinitionStatus;
    if (action === "ACTIVATE") {
      if (!activatableStatuses.has(current.status)) throw new Error("STATE");
      if (current.createdById === ctx.actorId) throw new Error("FOUR_EYES");
      const activeSibling = await tx.workflowDefinition.findFirst({
        where: {
          tenantId: ctx.tenantId,
          key: current.key,
          id: { not: current.id },
          status: WorkflowDefinitionStatus.ACTIVE
        },
        select: { id: true }
      });
      if (activeSibling) throw new Error("ACTIVE_VERSION");
      status = WorkflowDefinitionStatus.ACTIVE;
    } else if (action === "PAUSE") {
      if (current.status !== WorkflowDefinitionStatus.ACTIVE) throw new Error("STATE");
      status = WorkflowDefinitionStatus.PAUSED;
    } else {
      if (!retirableStatuses.has(current.status)) throw new Error("STATE");
      status = WorkflowDefinitionStatus.RETIRED;
    }

    const updated = await tx.workflowDefinition.update({
      where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
      data: { status }
    });
    await appendAudit(tx, ctx, {
      action: `workflow-definition.${action.toLowerCase()}`,
      resourceType: "WorkflowDefinition",
      resourceId: current.id,
      classification: DataClassification.INTERNAL,
      purpose: action === "ACTIVATE" ? "Independent workflow definition activation" : "Governed workflow definition lifecycle"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES", "ACTIVE_VERSION"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Workflow definition not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested workflow definition transition is not allowed from the current state." }, { status: 409 });
  if (result === "FOUR_EYES") return forbidden("Workflow definition creators cannot activate their own definition.");
  if (result === "ACTIVE_VERSION") return Response.json({ error: "Another version of this workflow key is already active. Pause it before activating this version." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Workflow definition state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
