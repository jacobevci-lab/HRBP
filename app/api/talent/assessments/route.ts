import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, PerformanceBand, PotentialBand } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "talent:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.talentAssessment.findMany({ where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) }, orderBy: { assessedAt: "desc" }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const employmentId = asIdentifier(body.employmentId);
  const cycleLabel = asText(body.cycleLabel, 160);
  const performance = String(body.performance ?? "") as PerformanceBand;
  const potential = String(body.potential ?? "") as PotentialBand;
  const criticalTalent = body.criticalTalent === undefined ? false : body.criticalTalent;
  const notes = asOptionalText(body.notes, 4000);

  if (!employmentId || !cycleLabel || !Object.values(PerformanceBand).includes(performance) || !Object.values(PotentialBand).includes(potential)) {
    return Response.json({ error: "employmentId, a cycleLabel up to 160 characters, performance and potential are required." }, { status: 400 });
  }
  if (typeof criticalTalent !== "boolean") {
    return Response.json({ error: "criticalTalent must be a boolean when provided." }, { status: 400 });
  }
  if (notes === null) {
    return Response.json({ error: "notes must not exceed 4000 characters." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

      const employment = await tx.employment.findFirst({
        where: { id: employmentId, tenantId: ctx.tenantId },
        select: { id: true }
      });
      if (!employment) throw new Error("NOT_FOUND");

      const existing = await tx.talentAssessment.findUnique({
        where: { tenantId_employmentId_cycleLabel: { tenantId: ctx.tenantId, employmentId, cycleLabel } },
        select: { id: true }
      });
      if (existing) throw new Error("ASSESSMENT_EXISTS");

      const assessment = await tx.talentAssessment.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          cycleLabel,
          performance,
          potential,
          criticalTalent,
          notes: notes ?? null,
          assessedById: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "talent-assessment.recorded",
        resourceType: "TalentAssessment",
        resourceId: assessment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Initial human talent assessment; cycle=${cycleLabel}; performance=${performance}; potential=${potential}; criticalTalent=${criticalTalent}`
      });
      return assessment;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const prismaCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
    if (code === "ASSESSMENT_EXISTS" || prismaCode === "P2002") {
      return Response.json({ error: "A talent assessment already exists for this employee and cycle. Use the governed correction workflow instead of overwriting the original decision." }, { status: 409 });
    }
    throw error;
  }
}
