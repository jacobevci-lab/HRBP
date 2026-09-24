import { DataClassification, DevelopmentPlanStatus, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const proficiencyOrder: SkillProficiency[] = [
  SkillProficiency.AWARENESS,
  SkillProficiency.FOUNDATION,
  SkillProficiency.PRACTITIONER,
  SkillProficiency.ADVANCED,
  SkillProficiency.EXPERT
];

function parsedDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "talent:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.developmentPlan.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: [{ status: "asc" }, { targetAt: "asc" }],
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "").trim();
  const title = String(body.title ?? "").trim().slice(0, 240);
  const objective = body.objective ? String(body.objective).trim().slice(0, 4000) : undefined;
  const sourceAssessmentId = body.sourceAssessmentId ? String(body.sourceAssessmentId).trim() : undefined;
  const focusSkillId = body.focusSkillId ? String(body.focusSkillId).trim() : undefined;
  const targetProficiency = body.targetProficiency ? String(body.targetProficiency) as SkillProficiency : undefined;
  const startsAt = parsedDate(body.startsAt);
  const targetAt = parsedDate(body.targetAt);

  if (!employmentId || !title || !startsAt || !targetAt) {
    return Response.json({ error: "employmentId, title, startsAt and targetAt are required." }, { status: 400 });
  }
  if (targetAt <= startsAt) return Response.json({ error: "targetAt must be after startsAt." }, { status: 400 });
  if ((focusSkillId && !targetProficiency) || (!focusSkillId && targetProficiency)) {
    return Response.json({ error: "focusSkillId and targetProficiency must be provided together." }, { status: 400 });
  }
  if (targetProficiency && !Object.values(SkillProficiency).includes(targetProficiency)) {
    return Response.json({ error: "A valid targetProficiency is required." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

      const [employment, sourceAssessment, focusSkill, currentSkill, duplicate] = await Promise.all([
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        sourceAssessmentId ? tx.talentAssessment.findFirst({
          where: { id: sourceAssessmentId, tenantId: ctx.tenantId, employmentId },
          select: { id: true, cycleLabel: true }
        }) : Promise.resolve(null),
        focusSkillId ? tx.skill.findFirst({
          where: { id: focusSkillId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, name: true }
        }) : Promise.resolve(null),
        focusSkillId ? tx.employmentSkill.findFirst({
          where: { tenantId: ctx.tenantId, employmentId, skillId: focusSkillId },
          select: { proficiency: true }
        }) : Promise.resolve(null),
        focusSkillId ? tx.developmentPlan.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId,
            focusSkillId,
            status: { in: [DevelopmentPlanStatus.DRAFT, DevelopmentPlanStatus.ACTIVE] }
          },
          select: { id: true }
        }) : Promise.resolve(null)
      ]);

      if (!employment) throw new Error("NOT_FOUND");
      if (sourceAssessmentId && !sourceAssessment) throw new Error("ASSESSMENT_NOT_FOUND");
      if (focusSkillId && !focusSkill) throw new Error("SKILL_NOT_FOUND");
      if (duplicate) throw new Error("DUPLICATE_OPEN_PLAN");
      if (targetProficiency && currentSkill && proficiencyOrder.indexOf(targetProficiency) <= proficiencyOrder.indexOf(currentSkill.proficiency)) {
        throw new Error("TARGET_NOT_ABOVE_CURRENT");
      }

      const plan = await tx.developmentPlan.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          title,
          objective,
          status: DevelopmentPlanStatus.DRAFT,
          ownerId: ctx.actorId,
          sourceAssessmentId: sourceAssessment?.id,
          focusSkillId: focusSkill?.id,
          targetProficiency,
          startsAt,
          targetAt
        }
      });

      await appendAudit(tx, ctx, {
        action: "development-plan.created",
        resourceType: "DevelopmentPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: sourceAssessment ? `Talent cycle ${sourceAssessment.cycleLabel}` : focusSkill ? `Skill development ${focusSkill.code}` : "Human-owned development plan"
      });
      return plan;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
    if (code === "ASSESSMENT_NOT_FOUND") return Response.json({ error: "Source talent assessment was not found for this employee." }, { status: 404 });
    if (code === "SKILL_NOT_FOUND") return Response.json({ error: "Active focus skill was not found in tenant." }, { status: 404 });
    if (code === "DUPLICATE_OPEN_PLAN") return Response.json({ error: "An open development plan already targets this skill for the employee." }, { status: 409 });
    if (code === "TARGET_NOT_ABOVE_CURRENT") return Response.json({ error: "Target proficiency must be above the employee's current assessed proficiency." }, { status: 409 });
    throw error;
  }
}
