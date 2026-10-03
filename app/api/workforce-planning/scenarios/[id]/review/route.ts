import { DataClassification, Prisma, WorkforceScenarioStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type ScenarioAction = "SUBMIT" | "APPROVE" | "REQUEST_CHANGES" | "LOCK";
const actions: ScenarioAction[] = ["SUBMIT", "APPROVE", "REQUEST_CHANGES", "LOCK"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid scenario id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const action = asEnumValue(body.action, actions);
  if (!action) return Response.json({ error: "action must be SUBMIT, APPROVE, REQUEST_CHANGES or LOCK." }, { status: 400 });

  if ((action === "SUBMIT" || action === "LOCK") && !can(ctx, "workforce-plan:write")) return forbidden();
  if ((action === "APPROVE" || action === "REQUEST_CHANGES") && !can(ctx, "workforce-plan:approve")) return forbidden();

  const result = await db.$transaction(async (tx) => {
    const current = await tx.workforceScenario.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, ownerId: true, approvedById: true, approvedAt: true }
    });
    if (!current) throw new Error("NOT_FOUND");

    if (action === "SUBMIT") {
      if (current.status !== WorkforceScenarioStatus.DRAFT) throw new Error("STATE");
      if (current.ownerId !== ctx.actorId) throw new Error("OWNER");
      const lineCount = await tx.workforcePlanLine.count({ where: { tenantId: ctx.tenantId, scenarioId: current.id } });
      if (!lineCount) throw new Error("EMPTY");
      const updated = await tx.workforceScenario.update({
        where: { id: current.id, tenantId: ctx.tenantId, status: WorkforceScenarioStatus.DRAFT },
        data: { status: WorkforceScenarioStatus.REVIEW, approvedById: null, approvedAt: null }
      });
      await appendAudit(tx, ctx, { action: "workforce-scenario.review-submitted", resourceType: "WorkforceScenario", resourceId: id, classification: DataClassification.CONFIDENTIAL, purpose: "Workforce scenario four-eyes review" });
      return updated;
    }

    if (action === "APPROVE") {
      if (current.status !== WorkforceScenarioStatus.REVIEW) throw new Error("STATE");
      if (current.ownerId === ctx.actorId) throw new Error("FOUR_EYES");
      const updated = await tx.workforceScenario.update({
        where: { id: current.id, tenantId: ctx.tenantId, status: WorkforceScenarioStatus.REVIEW },
        data: { status: WorkforceScenarioStatus.APPROVED, approvedById: ctx.actorId, approvedAt: new Date() }
      });
      await appendAudit(tx, ctx, { action: "workforce-scenario.approved", resourceType: "WorkforceScenario", resourceId: id, classification: DataClassification.CONFIDENTIAL, purpose: "Independent workforce scenario approval" });
      return updated;
    }

    if (action === "REQUEST_CHANGES") {
      if (current.status !== WorkforceScenarioStatus.REVIEW && current.status !== WorkforceScenarioStatus.APPROVED) throw new Error("STATE");
      const updated = await tx.workforceScenario.update({
        where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
        data: { status: WorkforceScenarioStatus.DRAFT, approvedById: null, approvedAt: null }
      });
      await appendAudit(tx, ctx, { action: "workforce-scenario.changes-requested", resourceType: "WorkforceScenario", resourceId: id, classification: DataClassification.CONFIDENTIAL, purpose: "Workforce scenario returned for controlled revision" });
      return updated;
    }

    if (current.ownerId !== ctx.actorId) throw new Error("OWNER");
    if (current.status !== WorkforceScenarioStatus.APPROVED || !current.approvedById || !current.approvedAt || current.approvedById === current.ownerId) throw new Error("STATE");
    const updated = await tx.workforceScenario.update({
      where: { id: current.id, tenantId: ctx.tenantId, status: WorkforceScenarioStatus.APPROVED },
      data: { status: WorkforceScenarioStatus.LOCKED }
    });
    await appendAudit(tx, ctx, { action: "workforce-scenario.locked", resourceType: "WorkforceScenario", resourceId: id, classification: DataClassification.CONFIDENTIAL, purpose: "Locked after independent approval; no implicit workforce mutation" });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES", "OWNER", "EMPTY"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Workforce scenario not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested workforce scenario transition is not allowed from the current state." }, { status: 409 });
  if (result === "OWNER") return forbidden("Only the scenario owner may submit or lock this workforce plan.");
  if (result === "EMPTY") return Response.json({ error: "Add at least one workforce plan line before submitting the scenario for review." }, { status: 409 });
  if (result === "FOUR_EYES") return forbidden("Scenario owners cannot approve their own workforce plan.");
  if (result === "CONFLICT") return Response.json({ error: "Scenario state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
