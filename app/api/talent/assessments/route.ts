import { DataClassification, PerformanceBand, PotentialBand } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "talent:read")) return forbidden();
  const data = await db.talentAssessment.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { assessedAt: "desc" }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "talent:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "");
  const cycleLabel = String(body.cycleLabel ?? "").trim();
  const performance = String(body.performance ?? "") as PerformanceBand;
  const potential = String(body.potential ?? "") as PotentialBand;
  if (!employmentId || !cycleLabel || !Object.values(PerformanceBand).includes(performance) || !Object.values(PotentialBand).includes(potential)) return Response.json({ error: "employmentId, cycleLabel, performance and potential are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const employment = await tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!employment) throw new Error("NOT_FOUND");
    const assessment = await tx.talentAssessment.upsert({
      where: { tenantId_employmentId_cycleLabel: { tenantId: ctx.tenantId, employmentId, cycleLabel } },
      update: { performance, potential, criticalTalent: Boolean(body.criticalTalent), notes: body.notes ? String(body.notes) : undefined, assessedById: ctx.actorId, assessedAt: new Date() },
      create: { tenantId: ctx.tenantId, employmentId, cycleLabel, performance, potential, criticalTalent: Boolean(body.criticalTalent), notes: body.notes ? String(body.notes) : undefined, assessedById: ctx.actorId }
    });
    await appendAudit(tx, ctx, { action: "talent-assessment.recorded", resourceType: "TalentAssessment", resourceId: assessment.id, classification: DataClassification.CONFIDENTIAL });
    return assessment;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
