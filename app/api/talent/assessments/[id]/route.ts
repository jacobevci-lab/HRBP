import { DataClassification, PerformanceBand, PotentialBand } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasPerformance = Object.prototype.hasOwnProperty.call(body, "performance");
  const hasPotential = Object.prototype.hasOwnProperty.call(body, "potential");
  const hasCriticalTalent = Object.prototype.hasOwnProperty.call(body, "criticalTalent");
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
  if (!hasPerformance && !hasPotential && !hasCriticalTalent && !hasNotes) {
    return Response.json({ error: "performance, potential, criticalTalent or notes is required." }, { status: 400 });
  }

  const performance = hasPerformance ? String(body.performance ?? "") as PerformanceBand : undefined;
  const potential = hasPotential ? String(body.potential ?? "") as PotentialBand : undefined;
  if (hasPerformance && !Object.values(PerformanceBand).includes(performance!)) return Response.json({ error: "A valid performance band is required." }, { status: 400 });
  if (hasPotential && !Object.values(PotentialBand).includes(potential!)) return Response.json({ error: "A valid potential band is required." }, { status: 400 });
  const notes = hasNotes ? String(body.notes ?? "").trim().slice(0, 4000) || null : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const assessment = await tx.talentAssessment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, cycleLabel: true, performance: true, potential: true, criticalTalent: true }
      });
      if (!assessment) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, assessment.employmentId)) throw new Error("OUT_OF_SCOPE");

      const updated = await tx.talentAssessment.update({
        where: { id },
        data: {
          ...(hasPerformance ? { performance } : {}),
          ...(hasPotential ? { potential } : {}),
          ...(hasCriticalTalent ? { criticalTalent: Boolean(body.criticalTalent) } : {}),
          ...(hasNotes ? { notes } : {}),
          assessedById: ctx.actorId,
          assessedAt: new Date()
        }
      });
      await appendAudit(tx, ctx, {
        action: "talent-assessment.corrected",
        resourceType: "TalentAssessment",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Human assessment correction for ${assessment.cycleLabel}; previous ${assessment.performance}/${assessment.potential}${assessment.criticalTalent ? "/critical" : ""}`
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Talent assessment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    throw error;
  }
}
