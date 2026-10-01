import { DataClassification, Prisma, WorkforceScenarioStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_SKILLS = 50;

function boundedText(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

function boundedNumber(value: unknown, min: number, max: number, required = false) {
  if (value === undefined || value === null || value === "") return required ? null : undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function skills(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SKILLS) return null;
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (normalized.length !== value.length || normalized.some((item) => item.length > 100)) return null;
  return [...new Set(normalized)];
}

async function validatePlanningScope(tx: Prisma.TransactionClient, ctx: NonNullable<ReturnType<typeof getRequestContext>>, orgUnitId: string, positionId?: string) {
  const orgUnit = await tx.organizationUnit.findFirst({
    where: { id: orgUnitId, tenantId: ctx.tenantId, validTo: null },
    select: { id: true }
  });
  if (!orgUnit) throw new Error("ORG");

  let position: { id: string; orgUnitId: string } | null = null;
  if (positionId) {
    position = await tx.position.findFirst({
      where: { id: positionId, tenantId: ctx.tenantId, validTo: null },
      select: { id: true, orgUnitId: true }
    });
    if (!position || position.orgUnitId !== orgUnitId) throw new Error("POSITION");
  }

  const scope = await resolveEmploymentScope(tx, ctx);
  if (scope === null) return;

  const employments = scope.length ? await tx.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: scope } },
    select: { positionId: true, position: { select: { orgUnitId: true } } }
  }) : [];
  const allowedOrgUnits = new Set(employments.flatMap((row) => row.position?.orgUnitId ? [row.position.orgUnitId] : []));
  const allowedPositions = new Set(employments.flatMap((row) => row.positionId ? [row.positionId] : []));
  if (!allowedOrgUnits.has(orgUnitId)) throw new Error("SCOPE");
  if (positionId && !allowedPositions.has(positionId)) throw new Error("SCOPE");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workforce-plan:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const orgUnitId = boundedText(body.orgUnitId, 128, true);
  const positionId = boundedText(body.positionId, 128);
  const roleLabel = boundedText(body.roleLabel, 160, true);
  const location = boundedText(body.location, 160);
  const demandDriver = boundedText(body.demandDriver, 1000);
  const currentFte = boundedNumber(body.currentFte, 0, 1_000_000, true);
  const plannedFte = boundedNumber(body.plannedFte, 0, 1_000_000, true);
  const avgAnnualCost = body.avgAnnualCost === null || body.avgAnnualCost === "" ? undefined : boundedNumber(body.avgAnnualCost, 0, 1_000_000_000);
  const skillsRequired = skills(body.skillsRequired);

  if (!orgUnitId || !roleLabel || currentFte === null || plannedFte === null || avgAnnualCost === null || skillsRequired === null) {
    return Response.json({ error: "Invalid workforce plan line values." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const scenario = await tx.workforceScenario.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, ownerId: true }
    });
    if (!scenario) throw new Error("NOT_FOUND");
    if (scenario.ownerId !== ctx.actorId) throw new Error("OWNER");
    if (scenario.status !== WorkforceScenarioStatus.DRAFT) throw new Error("STATE");

    await validatePlanningScope(tx, ctx, orgUnitId, positionId);

    const line = await tx.workforcePlanLine.create({
      data: {
        tenantId: ctx.tenantId,
        scenarioId: scenario.id,
        orgUnitId,
        positionId,
        roleLabel,
        location,
        currentFte: new Prisma.Decimal(currentFte),
        plannedFte: new Prisma.Decimal(plannedFte),
        avgAnnualCost: avgAnnualCost === undefined ? undefined : new Prisma.Decimal(avgAnnualCost),
        demandDriver,
        skillsRequired: skillsRequired as Prisma.InputJsonValue | undefined
      }
    });
    await appendAudit(tx, ctx, {
      action: "workforce-plan-line.created",
      resourceType: "WorkforcePlanLine",
      resourceId: line.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Draft workforce scenario planning"
    });
    return line;
  }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE", "ORG", "POSITION", "SCOPE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Scenario not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the scenario owner may edit draft plan lines.");
  if (result === "STATE") return Response.json({ error: "Plan lines are immutable after the scenario leaves DRAFT." }, { status: 409 });
  if (result === "ORG") return Response.json({ error: "Organization unit is not available in this tenant." }, { status: 404 });
  if (result === "POSITION") return Response.json({ error: "Position is not available in the selected organization unit." }, { status: 400 });
  if (result === "SCOPE") return forbidden("The selected organization or position is outside your workforce planning scope.");
  return Response.json({ data: result }, { status: 201 });
}
