import { asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid employee skill assessment id is required." }, { status: 400 });

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const hasProficiency = Object.prototype.hasOwnProperty.call(body, "proficiency");
  const hasSource = Object.prototype.hasOwnProperty.call(body, "source");
  const hasReason = Object.prototype.hasOwnProperty.call(body, "assessmentReason");
  if (!hasProficiency && !hasSource) return Response.json({ error: "proficiency or source is required." }, { status: 400 });

  const expectedAssessedAt = typeof body.expectedAssessedAt === "string" ? new Date(body.expectedAssessedAt) : null;
  if (!expectedAssessedAt || Number.isNaN(expectedAssessedAt.getTime())) {
    return Response.json({ error: "expectedAssessedAt is required for concurrency-safe proficiency reassessment." }, { status: 400 });
  }

  const proficiency = hasProficiency ? String(body.proficiency ?? "") as SkillProficiency : undefined;
  if (hasProficiency && !Object.values(SkillProficiency).includes(proficiency!)) {
    return Response.json({ error: "A valid proficiency is required." }, { status: 400 });
  }

  const source = hasSource ? asOptionalText(body.source, 500) : undefined;
  if (hasSource && source === null) return Response.json({ error: "source must not exceed 500 characters." }, { status: 400 });
  const assessmentReason = hasReason ? asOptionalText(body.assessmentReason, 2000) : undefined;
  if (hasReason && assessmentReason === null) return Response.json({ error: "assessmentReason must not exceed 2000 characters." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const record = await tx.employmentSkill.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          proficiency: true,
          source: true,
          assessedAt: true
        }
      });
      if (!record) throw new Error("NOT_FOUND");
      if (record.assessedAt.getTime() !== expectedAssessedAt.getTime()) throw new Error("STALE_STATE");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, record.employmentId)) throw new Error("OUT_OF_SCOPE");

      const nextProficiency = proficiency ?? record.proficiency;
      const proficiencyChanged = nextProficiency !== record.proficiency;
      if (proficiencyChanged && (!assessmentReason || assessmentReason.length < 12)) {
        throw new Error("ASSESSMENT_REASON_REQUIRED");
      }

      const reassessedAt = new Date();
      const result = await tx.employmentSkill.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          assessedAt: record.assessedAt
        },
        data: {
          ...(hasProficiency ? { proficiency: nextProficiency } : {}),
          ...(hasSource ? { source: source ?? null } : {}),
          ...(proficiencyChanged ? { assessmentReason } : {}),
          assessedById: ctx.actorId,
          assessedAt: reassessedAt
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");

      const updated = await tx.employmentSkill.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: "employee-skill.reassessed",
        resourceType: "EmploymentSkill",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Human proficiency reassessment: previous=${record.proficiency}; next=${nextProficiency}; changed=${proficiencyChanged}; reasonRecorded=${Boolean(proficiencyChanged && assessmentReason)}; sourceRecorded=${Boolean(hasSource ? source : record.source)}`
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Employee skill assessment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "ASSESSMENT_REASON_REQUIRED") {
      return Response.json({ error: "Changing proficiency requires a human assessment reason of at least 12 characters." }, { status: 400 });
    }
    if (code === "STALE_STATE") {
      return Response.json({ error: "Employee skill assessment changed concurrently. Refresh before submitting another reassessment." }, { status: 409 });
    }
    throw error;
  }
}
