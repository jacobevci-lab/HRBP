import { asDecimalInput, asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, LearningAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { enqueueDevelopmentPlanReassessment } from "@/lib/development-plan-notifications";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { enqueueSuccessionDevelopmentReassessment } from "@/lib/succession-development-notifications";

const transitions: Record<LearningAssignmentStatus, LearningAssignmentStatus[]> = {
  ASSIGNED: [LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.WAIVED, LearningAssignmentStatus.OVERDUE],
  IN_PROGRESS: [LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.WAIVED, LearningAssignmentStatus.OVERDUE],
  COMPLETED: [],
  OVERDUE: [LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.COMPLETED, LearningAssignmentStatus.WAIVED],
  WAIVED: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid assignment id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(LearningAssignmentStatus));
  if (!next) return Response.json({ error: "A valid learning assignment status is required." }, { status: 400 });

  const scoreProvided = body.score !== undefined && body.score !== null && body.score !== "";
  const parsedScore = scoreProvided ? asDecimalInput(body.score, 3, 2) : undefined;
  if (parsedScore === null) return Response.json({ error: "score must be a decimal with no more than two fractional digits." }, { status: 400 });
  const score = parsedScore === undefined ? undefined : Number(parsedScore);
  if (score !== undefined && (score < 0 || score > 100)) return Response.json({ error: "score must be between 0 and 100." }, { status: 400 });

  const certificateReference = asOptionalText(body.certificateReference, 500);
  if (certificateReference === null) return Response.json({ error: "certificateReference must be text up to 500 characters." }, { status: 400 });
  if (next !== LearningAssignmentStatus.COMPLETED && (scoreProvided || certificateReference !== undefined)) {
    return Response.json({ error: "Completion evidence can only be recorded when completing an assignment." }, { status: 400 });
  }

  const waiverReason = asOptionalText(body.waiverReason, 2000);
  if (waiverReason === null || (next === LearningAssignmentStatus.WAIVED && (!waiverReason || waiverReason.length < 12))) {
    return Response.json({ error: "Waiving a learning assignment requires a reason between 12 and 2000 characters." }, { status: 400 });
  }
  if (next !== LearningAssignmentStatus.WAIVED && waiverReason !== undefined) {
    return Response.json({ error: "A waiver reason is only accepted for a waiver decision." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const assignment = await tx.learningAssignment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          completedAt: true,
          targetProficiency: true,
          course: { select: { code: true, title: true } },
          developmentSkill: { select: { code: true, name: true } },
          developmentPlan: { select: { id: true, title: true, ownerId: true } },
          successionCandidate: {
            select: { id: true, active: true, plan: { select: { ownerId: true, positionId: true } } }
          }
        }
      });
      if (!assignment) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, assignment.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!(transitions[assignment.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");

      const changed = await tx.learningAssignment.updateMany({
        where: { id, tenantId: ctx.tenantId, status: assignment.status },
        data: {
          status: next,
          completedAt: next === LearningAssignmentStatus.COMPLETED ? new Date() : assignment.completedAt,
          score: next === LearningAssignmentStatus.COMPLETED ? score : undefined,
          certificateReference: next === LearningAssignmentStatus.COMPLETED ? certificateReference : undefined,
          waivedAt: next === LearningAssignmentStatus.WAIVED ? new Date() : undefined,
          waivedById: next === LearningAssignmentStatus.WAIVED ? ctx.actorId : undefined,
          waiverReason: next === LearningAssignmentStatus.WAIVED ? waiverReason : undefined
        }
      });
      if (changed.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.learningAssignment.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: `learning-assignment.transition.${assignment.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "LearningAssignment",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });

      if (next === LearningAssignmentStatus.COMPLETED && assignment.developmentPlan && assignment.developmentSkill && assignment.targetProficiency) {
        const activeOwner = await tx.userAccount.findFirst({
          where: { id: assignment.developmentPlan.ownerId, tenantId: ctx.tenantId, active: true },
          select: { id: true }
        });
        await enqueueDevelopmentPlanReassessment(tx, {
          tenantId: ctx.tenantId,
          assignmentId: id,
          planId: assignment.developmentPlan.id,
          ownerId: activeOwner?.id ?? null,
          planTitle: assignment.developmentPlan.title,
          courseCode: assignment.course.code,
          courseTitle: assignment.course.title,
          skillCode: assignment.developmentSkill.code,
          skillName: assignment.developmentSkill.name,
          targetProficiency: assignment.targetProficiency
        });
      }

      if (next === LearningAssignmentStatus.COMPLETED && assignment.successionCandidate?.active && assignment.developmentSkill && assignment.targetProficiency) {
        const [position, activeOwner] = await Promise.all([
          tx.position.findFirst({
            where: { id: assignment.successionCandidate.plan.positionId, tenantId: ctx.tenantId },
            select: { positionCode: true, title: true }
          }),
          assignment.successionCandidate.plan.ownerId ? tx.userAccount.findFirst({
            where: { id: assignment.successionCandidate.plan.ownerId, tenantId: ctx.tenantId, active: true },
            select: { id: true }
          }) : Promise.resolve(null)
        ]);
        if (position) {
          await enqueueSuccessionDevelopmentReassessment(tx, {
            tenantId: ctx.tenantId,
            assignmentId: id,
            candidateId: assignment.successionCandidate.id,
            ownerId: activeOwner?.id ?? null,
            positionCode: position.positionCode,
            positionTitle: position.title,
            courseCode: assignment.course.code,
            courseTitle: assignment.course.title,
            skillCode: assignment.developmentSkill.code,
            skillName: assignment.developmentSkill.name,
            targetProficiency: assignment.targetProficiency
          });
        }
      }
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Learning assignment not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") return Response.json({ error: "Learning assignment transition is not allowed from the current state." }, { status: 409 });
    throw error;
  }
}
