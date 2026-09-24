import { DataClassification, DevelopmentPlanStatus, LearningAssignmentStatus, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { enqueueDevelopmentPlanActivated } from "@/lib/development-plan-notifications";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<DevelopmentPlanStatus, DevelopmentPlanStatus[]> = {
  DRAFT: [DevelopmentPlanStatus.ACTIVE, DevelopmentPlanStatus.CANCELLED],
  ACTIVE: [DevelopmentPlanStatus.COMPLETED, DevelopmentPlanStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: []
};

const proficiencyOrder: SkillProficiency[] = [
  SkillProficiency.AWARENESS,
  SkillProficiency.FOUNDATION,
  SkillProficiency.PRACTITIONER,
  SkillProficiency.ADVANCED,
  SkillProficiency.EXPERT
];

function parsedDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const requestedStatus = body.status ? String(body.status) as DevelopmentPlanStatus : undefined;
  if (requestedStatus && !Object.values(DevelopmentPlanStatus).includes(requestedStatus)) {
    return Response.json({ error: "A valid development plan status is required." }, { status: 400 });
  }
  const targetAt = parsedDate(body.targetAt);
  if (targetAt === null) return Response.json({ error: "targetAt must be a valid date." }, { status: 400 });
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 240) : undefined;
  if (body.title !== undefined && !title) return Response.json({ error: "title cannot be empty." }, { status: 400 });
  const objective = body.objective !== undefined ? (String(body.objective ?? "").trim().slice(0, 4000) || null) : undefined;
  const outcomeNotes = body.outcomeNotes !== undefined ? (String(body.outcomeNotes ?? "").trim().slice(0, 4000) || null) : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const plan = await tx.developmentPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          title: true,
          status: true,
          startsAt: true,
          targetAt: true,
          focusSkillId: true,
          targetProficiency: true,
          focusSkill: { select: { code: true, name: true } }
        }
      });
      if (!plan) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, plan.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (plan.status === DevelopmentPlanStatus.COMPLETED || plan.status === DevelopmentPlanStatus.CANCELLED) throw new Error("PLAN_LOCKED");
      if (requestedStatus && requestedStatus !== plan.status && !(transitions[plan.status] ?? []).includes(requestedStatus)) throw new Error("INVALID_TRANSITION");

      const nextTargetAt = targetAt ?? plan.targetAt;
      if (nextTargetAt <= plan.startsAt) throw new Error("INVALID_TARGET_DATE");

      if (requestedStatus === DevelopmentPlanStatus.COMPLETED) {
        const openAssignments = await tx.learningAssignment.count({
          where: {
            tenantId: ctx.tenantId,
            developmentPlanId: id,
            status: { notIn: [LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.WAIVED] }
          }
        });
        if (openAssignments > 0) throw new Error(`OPEN_ASSIGNMENTS:${openAssignments}`);
        if (!outcomeNotes) throw new Error("OUTCOME_NOTES_REQUIRED");

        if (plan.focusSkillId && plan.targetProficiency) {
          const current = await tx.employmentSkill.findFirst({
            where: { tenantId: ctx.tenantId, employmentId: plan.employmentId, skillId: plan.focusSkillId },
            select: { proficiency: true }
          });
          if (!current || proficiencyOrder.indexOf(current.proficiency) < proficiencyOrder.indexOf(plan.targetProficiency)) {
            throw new Error("TARGET_NOT_REASSESSED");
          }
        }
      }

      const nextStatus = requestedStatus ?? plan.status;
      const changed = await tx.developmentPlan.updateMany({
        where: { id, tenantId: ctx.tenantId, status: plan.status },
        data: {
          title,
          objective,
          outcomeNotes,
          targetAt,
          status: nextStatus,
          completedAt: nextStatus === DevelopmentPlanStatus.COMPLETED ? new Date() : undefined
        }
      });
      if (changed.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.developmentPlan.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      const action = requestedStatus && requestedStatus !== plan.status
        ? `development-plan.transition.${plan.status.toLowerCase()}.${requestedStatus.toLowerCase()}`
        : "development-plan.updated";
      await appendAudit(tx, ctx, {
        action,
        resourceType: "DevelopmentPlan",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });

      if (requestedStatus === DevelopmentPlanStatus.ACTIVE && plan.status === DevelopmentPlanStatus.DRAFT) {
        await enqueueDevelopmentPlanActivated(tx, {
          tenantId: ctx.tenantId,
          employmentId: plan.employmentId,
          planId: plan.id,
          planTitle: title ?? plan.title,
          targetAt: nextTargetAt,
          skillCode: plan.focusSkill?.code,
          skillName: plan.focusSkill?.name,
          targetProficiency: plan.targetProficiency
        });
      }
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Development plan not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Development plan employee is outside your authorized relationship scope.");
    if (code === "PLAN_LOCKED") return Response.json({ error: "Completed or cancelled development plans are immutable." }, { status: 409 });
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") return Response.json({ error: "Development plan transition is not allowed from the current state." }, { status: 409 });
    if (code === "INVALID_TARGET_DATE") return Response.json({ error: "Target date must be after the plan start date." }, { status: 400 });
    if (code.startsWith("OPEN_ASSIGNMENTS:")) return Response.json({ error: `${code.split(":")[1]} learning actions remain open; complete or waive them before closing the development plan.` }, { status: 409 });
    if (code === "OUTCOME_NOTES_REQUIRED") return Response.json({ error: "Human-entered outcome notes are required before completing the development plan." }, { status: 400 });
    if (code === "TARGET_NOT_REASSESSED") return Response.json({ error: "The target skill proficiency has not yet been confirmed by a human assessment." }, { status: 409 });
    throw error;
  }
}
