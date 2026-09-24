import { DataClassification, DevelopmentPlanStatus, EmploymentStatus, LearningAssignmentStatus, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueLearningAssignmentNotification } from "@/lib/learning-notifications";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "succession:write") || !can(ctx, "learning:write")) return forbidden("Succession and learning write capabilities are both required.");

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const courseId = String(body.courseId ?? "").trim();
  const skillId = String(body.skillId ?? "").trim();
  const targetProficiency = String(body.targetProficiency ?? "") as SkillProficiency;
  const dueAt = parsedDate(body.dueAt);
  if (!courseId || !skillId || !Object.values(SkillProficiency).includes(targetProficiency) || !dueAt) {
    return Response.json({ error: "courseId, skillId, targetProficiency and a valid dueAt are required." }, { status: 400 });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (dueAt < today) return Response.json({ error: "dueAt cannot be in the past." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const candidate = await tx.successionCandidate.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          developmentGap: true,
          plan: { select: { id: true, positionId: true, active: true, ownerId: true } }
        }
      });
      if (!candidate) throw new Error("NOT_FOUND");
      if (!candidate.plan.active) throw new Error("PLAN_INACTIVE");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, candidate.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (scope !== null) {
        const scopedIncumbent = await tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: candidate.plan.positionId,
            status: { not: EmploymentStatus.TERMINATED },
            ...employmentPrimaryKeyFilter(scope)
          },
          select: { id: true }
        });
        if (!scopedIncumbent) throw new Error("PLAN_OUT_OF_SCOPE");
      }

      const [course, skill, employment, position, currentSkill, duplicate, sourceAssessment, existingPlan] = await Promise.all([
        tx.learningCourse.findFirst({
          where: { id: courseId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, title: true }
        }),
        tx.skill.findFirst({
          where: { id: skillId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, name: true }
        }),
        tx.employment.findFirst({ where: { id: candidate.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        tx.position.findFirst({
          where: { id: candidate.plan.positionId, tenantId: ctx.tenantId },
          select: { positionCode: true, title: true }
        }),
        tx.employmentSkill.findFirst({
          where: { tenantId: ctx.tenantId, employmentId: candidate.employmentId, skillId },
          select: { proficiency: true }
        }),
        tx.learningAssignment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            successionCandidateId: candidate.id,
            courseId,
            developmentSkillId: skillId,
            status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] }
          },
          select: { id: true }
        }),
        tx.talentAssessment.findFirst({
          where: { tenantId: ctx.tenantId, employmentId: candidate.employmentId },
          orderBy: { assessedAt: "desc" },
          select: { id: true }
        }),
        tx.developmentPlan.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId: candidate.employmentId,
            successionCandidateId: candidate.id,
            focusSkillId: skillId,
            status: { in: [DevelopmentPlanStatus.DRAFT, DevelopmentPlanStatus.ACTIVE] }
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, targetAt: true, targetProficiency: true, status: true }
        })
      ]);
      if (!course || !skill || !employment || !position) throw new Error("DEVELOPMENT_REFERENCE_NOT_FOUND");
      if (duplicate) throw new Error("DUPLICATE_OPEN_PLAN");
      if (currentSkill && proficiencyOrder.indexOf(targetProficiency) <= proficiencyOrder.indexOf(currentSkill.proficiency)) {
        throw new Error("TARGET_NOT_ABOVE_CURRENT");
      }
      if (existingPlan?.targetProficiency && proficiencyOrder.indexOf(targetProficiency) < proficiencyOrder.indexOf(existingPlan.targetProficiency)) {
        throw new Error("TARGET_BELOW_PLAN");
      }

      let developmentPlanId = existingPlan?.id;
      if (existingPlan) {
        await tx.developmentPlan.update({
          where: { id: existingPlan.id },
          data: {
            status: DevelopmentPlanStatus.ACTIVE,
            targetAt: dueAt > existingPlan.targetAt ? dueAt : existingPlan.targetAt,
            targetProficiency
          }
        });
      } else {
        const developmentPlan = await tx.developmentPlan.create({
          data: {
            tenantId: ctx.tenantId,
            employmentId: candidate.employmentId,
            title: `Succession development · ${position.title}`,
            objective: candidate.developmentGap || `Build ${skill.name} capability for ${position.title}.`,
            status: DevelopmentPlanStatus.ACTIVE,
            ownerId: candidate.plan.ownerId ?? ctx.actorId,
            sourceAssessmentId: sourceAssessment?.id,
            successionCandidateId: candidate.id,
            focusSkillId: skill.id,
            targetProficiency,
            startsAt: new Date(),
            targetAt: dueAt
          }
        });
        developmentPlanId = developmentPlan.id;
        await appendAudit(tx, ctx, {
          action: "development-plan.created-from-succession",
          resourceType: "DevelopmentPlan",
          resourceId: developmentPlan.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: `${position.positionCode}; ${skill.code} target ${targetProficiency}`
        });
      }

      const assignment = await tx.learningAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: candidate.employmentId,
          courseId: course.id,
          successionCandidateId: candidate.id,
          developmentPlanId,
          developmentSkillId: skill.id,
          targetProficiency,
          status: LearningAssignmentStatus.ASSIGNED,
          dueAt
        }
      });

      await appendAudit(tx, ctx, {
        action: "learning-assignment.created-from-succession",
        resourceType: "LearningAssignment",
        resourceId: assignment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Succession development for ${position.positionCode}; ${skill.code} target ${targetProficiency}`
      });
      await appendAudit(tx, ctx, {
        action: "succession-candidate.development-assignment-created",
        resourceType: "SuccessionCandidate",
        resourceId: candidate.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Learning assignment ${assignment.id} linked to ${skill.code}`
      });
      if (developmentPlanId) {
        await appendAudit(tx, ctx, {
          action: "development-plan.learning-assignment-created",
          resourceType: "DevelopmentPlan",
          resourceId: developmentPlanId,
          classification: DataClassification.CONFIDENTIAL,
          purpose: `Learning assignment ${assignment.id} · ${course.code}`
        });
      }
      await enqueueLearningAssignmentNotification(tx, {
        tenantId: ctx.tenantId,
        employmentId: candidate.employmentId,
        assignmentId: assignment.id,
        courseCode: course.code,
        courseTitle: course.title,
        dueAt
      });

      return {
        ...assignment,
        course: { code: course.code, title: course.title },
        skill: { code: skill.code, name: skill.name },
        currentProficiency: currentSkill?.proficiency ?? null,
        developmentPlanId
      };
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Succession candidate not found in tenant." }, { status: 404 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Development assignments cannot be added to an inactive succession plan." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Candidate employment is outside your authorized relationship scope.");
    if (code === "PLAN_OUT_OF_SCOPE") return forbidden("Succession target position is outside your authorized relationship scope.");
    if (code === "DEVELOPMENT_REFERENCE_NOT_FOUND") return Response.json({ error: "Candidate employment, active course, active skill or target position was not found in tenant." }, { status: 404 });
    if (code === "DUPLICATE_OPEN_PLAN") return Response.json({ error: "An open development assignment already links this candidate, course and skill." }, { status: 409 });
    if (code === "TARGET_NOT_ABOVE_CURRENT") return Response.json({ error: "Target proficiency must be above the employee's current assessed proficiency." }, { status: 409 });
    if (code === "TARGET_BELOW_PLAN") return Response.json({ error: "Target proficiency cannot be lower than the active development plan target." }, { status: 409 });
    throw error;
  }
}
