import { DataClassification, DevelopmentPlanStatus, LearningAssignmentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueLearningAssignmentNotification } from "@/lib/learning-notifications";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parsedDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "talent:write") || !can(ctx, "learning:write")) return forbidden("Talent and learning write capabilities are both required.");

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const courseId = String(body.courseId ?? "").trim();
  const dueAt = parsedDate(body.dueAt);
  if (!courseId || !dueAt) return Response.json({ error: "courseId and a valid dueAt are required." }, { status: 400 });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (dueAt < today) return Response.json({ error: "dueAt cannot be in the past." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const plan = await tx.developmentPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          title: true,
          status: true,
          targetAt: true,
          focusSkillId: true,
          targetProficiency: true
        }
      });
      if (!plan) throw new Error("NOT_FOUND");
      if (plan.status !== DevelopmentPlanStatus.DRAFT && plan.status !== DevelopmentPlanStatus.ACTIVE) throw new Error("PLAN_LOCKED");
      if (!plan.focusSkillId || !plan.targetProficiency) throw new Error("SKILL_TARGET_REQUIRED");
      if (dueAt > plan.targetAt) throw new Error("DUE_AFTER_PLAN_TARGET");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, plan.employmentId)) throw new Error("OUT_OF_SCOPE");

      const [course, skill, duplicate] = await Promise.all([
        tx.learningCourse.findFirst({
          where: { id: courseId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, title: true }
        }),
        tx.skill.findFirst({
          where: { id: plan.focusSkillId, tenantId: ctx.tenantId, active: true },
          select: { id: true, code: true, name: true }
        }),
        tx.learningAssignment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            developmentPlanId: plan.id,
            courseId,
            status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] }
          },
          select: { id: true }
        })
      ]);
      if (!course || !skill) throw new Error("REFERENCE_NOT_FOUND");
      if (duplicate) throw new Error("DUPLICATE_OPEN_ASSIGNMENT");

      const assignment = await tx.learningAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: plan.employmentId,
          courseId: course.id,
          developmentPlanId: plan.id,
          developmentSkillId: skill.id,
          targetProficiency: plan.targetProficiency,
          status: LearningAssignmentStatus.ASSIGNED,
          dueAt
        }
      });

      await appendAudit(tx, ctx, {
        action: "learning-assignment.created-from-development-plan",
        resourceType: "LearningAssignment",
        resourceId: assignment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `${plan.title}; ${skill.code} target ${plan.targetProficiency}`
      });
      await appendAudit(tx, ctx, {
        action: "development-plan.learning-assignment-created",
        resourceType: "DevelopmentPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Learning assignment ${assignment.id} · ${course.code}`
      });
      await enqueueLearningAssignmentNotification(tx, {
        tenantId: ctx.tenantId,
        employmentId: plan.employmentId,
        assignmentId: assignment.id,
        courseCode: course.code,
        courseTitle: course.title,
        dueAt
      });

      return {
        ...assignment,
        course: { code: course.code, title: course.title },
        skill: { code: skill.code, name: skill.name }
      };
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Development plan not found in tenant." }, { status: 404 });
    if (code === "PLAN_LOCKED") return Response.json({ error: "Learning actions can only be added to draft or active development plans." }, { status: 409 });
    if (code === "SKILL_TARGET_REQUIRED") return Response.json({ error: "A focus skill and target proficiency are required before adding learning actions." }, { status: 409 });
    if (code === "DUE_AFTER_PLAN_TARGET") return Response.json({ error: "Learning due date cannot be after the development plan target date." }, { status: 400 });
    if (code === "OUT_OF_SCOPE") return forbidden("Development plan employee is outside your authorized relationship scope.");
    if (code === "REFERENCE_NOT_FOUND") return Response.json({ error: "Active course or focus skill was not found in tenant." }, { status: 404 });
    if (code === "DUPLICATE_OPEN_ASSIGNMENT") return Response.json({ error: "This course is already open on the development plan." }, { status: 409 });
    throw error;
  }
}
