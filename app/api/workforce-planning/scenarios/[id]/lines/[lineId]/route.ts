import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma, WorkforceScenarioStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function boundedText(value: unknown, max: number) {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : text ? null : undefined;
}

function boundedNumber(value: unknown, min: number, max: number) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function normalizeSkills(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) return null;
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (normalized.length !== value.length || normalized.some((item) => item.length > 100)) return null;
  return [...new Set(normalized)];
}

async function ensureScope(tx: Prisma.TransactionClient, ctx: NonNullable<ReturnType<typeof getRequestContext>>, orgUnitId: string, positionId?: string | null) {
  const orgUnit = await tx.organizationUnit.findFirst({ where: { id: orgUnitId, tenantId: ctx.tenantId, validTo: null }, select: { id: true } });
  if (!orgUnit) throw new Error("ORG");

  if (positionId) {
    const position = await tx.position.findFirst({ where: { id: positionId, tenantId: ctx.tenantId, validTo: null }, select: { id: true, orgUnitId: true } });
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

async function loadOwnedDraftLine(tx: Prisma.TransactionClient, ctx: NonNullable<ReturnType<typeof getRequestContext>>, scenarioId: string, lineId: string) {
  const line = await tx.workforcePlanLine.findFirst({
    where: { id: lineId, tenantId: ctx.tenantId, scenarioId },
    select: {
      id: true,
      orgUnitId: true,
      positionId: true,
      scenario: { select: { id: true, ownerId: true, status: true } }
    }
  });
  if (!line) throw new Error("NOT_FOUND");
  if (line.scenario.ownerId !== ctx.actorId) throw new Error("OWNER");
  if (line.scenario.status !== WorkforceScenarioStatus.DRAFT) throw new Error("STATE");
  return line;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workforce-plan:write")) return forbidden();

  const { id, lineId } = await params;
  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const roleLabel = boundedText(body.roleLabel, 160);
  const location = boundedText(body.location, 160);
  const demandDriver = boundedText(body.demandDriver, 1000);
  const orgUnitIdInput = boundedText(body.orgUnitId, 128);
  const positionIdInput = body.positionId === null ? null : boundedText(body.positionId, 128);
  const currentFte = boundedNumber(body.currentFte, 0, 1_000_000);
  const plannedFte = boundedNumber(body.plannedFte, 0, 1_000_000);
  let avgAnnualCost: number | null | undefined;
  if (body.avgAnnualCost === undefined) avgAnnualCost = undefined;
  else if (body.avgAnnualCost === null || body.avgAnnualCost === "") avgAnnualCost = null;
  else {
    const parsedCost = boundedNumber(body.avgAnnualCost, 0, 1_000_000_000);
    avgAnnualCost = parsedCost == null ? Number.NaN : parsedCost;
  }
  const skillsRequired = normalizeSkills(body.skillsRequired);

  const invalid =
    (body.roleLabel !== undefined && !roleLabel)
    || (body.orgUnitId !== undefined && !orgUnitIdInput)
    || (body.positionId !== undefined && body.positionId !== null && !positionIdInput)
    || (body.currentFte !== undefined && currentFte == null)
    || (body.plannedFte !== undefined && plannedFte == null)
    || Number.isNaN(avgAnnualCost)
    || skillsRequired === null
    || location === null
    || demandDriver === null;

  if (invalid) return Response.json({ error: "Invalid workforce plan line values." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const line = await loadOwnedDraftLine(tx, ctx, id, lineId);
    const orgUnitId = orgUnitIdInput ?? line.orgUnitId;
    const positionId = body.positionId === null ? null : (positionIdInput ?? line.positionId);
    await ensureScope(tx, ctx, orgUnitId, positionId);

    const updateData: Prisma.WorkforcePlanLineUncheckedUpdateInput = {};
    if (orgUnitIdInput !== undefined) updateData.orgUnitId = orgUnitId;
    if (body.positionId !== undefined) updateData.positionId = positionId;
    if (typeof roleLabel === "string") updateData.roleLabel = roleLabel;
    if (body.location !== undefined) updateData.location = location ?? null;
    if (typeof currentFte === "number") updateData.currentFte = new Prisma.Decimal(currentFte);
    if (typeof plannedFte === "number") updateData.plannedFte = new Prisma.Decimal(plannedFte);
    if (body.avgAnnualCost !== undefined) updateData.avgAnnualCost = avgAnnualCost === null ? null : new Prisma.Decimal(avgAnnualCost as number);
    if (body.demandDriver !== undefined) updateData.demandDriver = demandDriver ?? null;
    if (skillsRequired !== undefined) updateData.skillsRequired = skillsRequired as Prisma.InputJsonValue;

    const updated = await tx.workforcePlanLine.update({
      where: { id: line.id },
      data: updateData
    });
    await appendAudit(tx, ctx, {
      action: "workforce-plan-line.updated",
      resourceType: "WorkforcePlanLine",
      resourceId: line.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Draft workforce scenario planning"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE", "ORG", "POSITION", "SCOPE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Plan line not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the scenario owner may edit draft plan lines.");
  if (result === "STATE") return Response.json({ error: "Plan lines are immutable after the scenario leaves DRAFT." }, { status: 409 });
  if (result === "ORG") return Response.json({ error: "Organization unit is not available in this tenant." }, { status: 404 });
  if (result === "POSITION") return Response.json({ error: "Position is not available in the selected organization unit." }, { status: 400 });
  if (result === "SCOPE") return forbidden("The selected organization or position is outside your workforce planning scope.");
  if (result === "CONFLICT") return Response.json({ error: "Plan line changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workforce-plan:write")) return forbidden();
  const { id, lineId } = await params;

  const result = await db.$transaction(async (tx) => {
    const line = await loadOwnedDraftLine(tx, ctx, id, lineId);
    await ensureScope(tx, ctx, line.orgUnitId, line.positionId);
    await tx.workforcePlanLine.delete({ where: { id: line.id } });
    await appendAudit(tx, ctx, {
      action: "workforce-plan-line.deleted",
      resourceType: "WorkforcePlanLine",
      resourceId: line.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Draft workforce scenario planning"
    });
    return { id: line.id };
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE", "SCOPE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Plan line not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the scenario owner may delete draft plan lines.");
  if (result === "STATE") return Response.json({ error: "Plan lines are immutable after the scenario leaves DRAFT." }, { status: 409 });
  if (result === "SCOPE") return forbidden("The plan line is outside your workforce planning scope.");
  if (result === "CONFLICT") return Response.json({ error: "Plan line changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
