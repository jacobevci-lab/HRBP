import { asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, PerformanceBand, PotentialBand } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid talent assessment id is required." }, { status: 400 });
  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const hasPerformance = Object.prototype.hasOwnProperty.call(body, "performance");
  const hasPotential = Object.prototype.hasOwnProperty.call(body, "potential");
  const hasCriticalTalent = Object.prototype.hasOwnProperty.call(body, "criticalTalent");
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
  const hasCorrectionReason = Object.prototype.hasOwnProperty.call(body, "correctionReason");
  if (!hasPerformance && !hasPotential && !hasCriticalTalent && !hasNotes) {
    return Response.json({ error: "performance, potential, criticalTalent or notes is required." }, { status: 400 });
  }

  const expectedAssessedAt = typeof body.expectedAssessedAt === "string" ? new Date(body.expectedAssessedAt) : null;
  if (!expectedAssessedAt || Number.isNaN(expectedAssessedAt.getTime())) {
    return Response.json({ error: "expectedAssessedAt is required for concurrency-safe talent corrections." }, { status: 400 });
  }

  const performance = hasPerformance ? String(body.performance ?? "") as PerformanceBand : undefined;
  const potential = hasPotential ? String(body.potential ?? "") as PotentialBand : undefined;
  if (hasPerformance && !Object.values(PerformanceBand).includes(performance!)) return Response.json({ error: "A valid performance band is required." }, { status: 400 });
  if (hasPotential && !Object.values(PotentialBand).includes(potential!)) return Response.json({ error: "A valid potential band is required." }, { status: 400 });
  if (hasCriticalTalent && typeof body.criticalTalent !== "boolean") return Response.json({ error: "criticalTalent must be a boolean." }, { status: 400 });

  const parsedNotes = hasNotes ? asOptionalText(body.notes, 4000) : undefined;
  if (hasNotes && parsedNotes === null) return Response.json({ error: "notes must not exceed 4000 characters." }, { status: 400 });
  const notes = hasNotes ? parsedNotes ?? null : undefined;
  const correctionReason = hasCorrectionReason ? asOptionalText(body.correctionReason, 2000) : undefined;
  if (hasCorrectionReason && correctionReason === null) return Response.json({ error: "correctionReason must not exceed 2000 characters." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const assessment = await tx.talentAssessment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, cycleLabel: true, performance: true, potential: true, criticalTalent: true, assessedAt: true }
      });
      if (!assessment) throw new Error("NOT_FOUND");
      if (assessment.assessedAt.getTime() !== expectedAssessedAt.getTime()) throw new Error("STALE_STATE");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, assessment.employmentId)) throw new Error("OUT_OF_SCOPE");

      const nextPerformance = performance ?? assessment.performance;
      const nextPotential = potential ?? assessment.potential;
      const nextCriticalTalent = hasCriticalTalent ? body.criticalTalent as boolean : assessment.criticalTalent;
      const decisionChanged = nextPerformance !== assessment.performance ||
        nextPotential !== assessment.potential ||
        nextCriticalTalent !== assessment.criticalTalent;
      if (decisionChanged && (!correctionReason || correctionReason.length < 12)) throw new Error("CORRECTION_REASON_REQUIRED");

      const correctedAt = new Date();
      const result = await tx.talentAssessment.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          assessedAt: assessment.assessedAt
        },
        data: {
          ...(hasPerformance ? { performance } : {}),
          ...(hasPotential ? { potential } : {}),
          ...(hasCriticalTalent ? { criticalTalent: nextCriticalTalent } : {}),
          ...(hasNotes ? { notes } : {}),
          ...(decisionChanged ? { correctionReason } : {}),
          assessedById: ctx.actorId,
          assessedAt: correctedAt
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.talentAssessment.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: "talent-assessment.corrected",
        resourceType: "TalentAssessment",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Human assessment correction for ${assessment.cycleLabel}; previous=${assessment.performance}/${assessment.potential}/critical:${assessment.criticalTalent}; next=${nextPerformance}/${nextPotential}/critical:${nextCriticalTalent}; decisionChanged=${decisionChanged}; reasonRecorded=${Boolean(decisionChanged && correctionReason)}`
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Talent assessment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "CORRECTION_REASON_REQUIRED") return Response.json({ error: "Changing performance, potential or critical-talent status requires a correction reason of at least 12 characters." }, { status: 400 });
    if (code === "STALE_STATE") return Response.json({ error: "Talent assessment changed concurrently. Refresh before submitting another correction." }, { status: 409 });
    throw error;
  }
}
