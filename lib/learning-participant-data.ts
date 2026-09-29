import { LearningAssignmentStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type LearningParticipantAssignment = {
  id: string;
  course: string;
  courseCode: string;
  provider: string;
  mandatory: boolean;
  status: string;
  dueAt: string | null;
  assignedAt: string;
  successionCandidateId: string | null;
  developmentPlanId: string | null;
  developmentPlanTitle: string | null;
  developmentSkillCode: string | null;
  developmentSkillName: string | null;
  targetProficiency: string | null;
  focused: boolean;
};

export async function getLearningParticipantData(ctx: RequestContext, focusId?: string): Promise<LearningParticipantAssignment[]> {
  if (!ctx.employmentId || !can(ctx, "learning:self-progress")) return [];

  return withDb(async (db) => {
    const boundedFocusId = focusId?.trim().slice(0, 160) || undefined;
    const actionableStatuses = [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE];
    const assignmentSelect = {
      id: true,
      status: true,
      dueAt: true,
      assignedAt: true,
      successionCandidateId: true,
      developmentPlanId: true,
      developmentPlan: { select: { title: true } },
      targetProficiency: true,
      developmentSkill: { select: { code: true, name: true } },
      course: { select: { code: true, title: true, provider: true, mandatory: true } }
    } as const;

    const [rows, focusedAssignment] = await Promise.all([
      db.learningAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: { in: actionableStatuses }
        },
        orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
        take: 100,
        select: assignmentSelect
      }),
      boundedFocusId ? db.learningAssignment.findFirst({
        where: {
          id: boundedFocusId,
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: { in: actionableStatuses }
        },
        select: assignmentSelect
      }) : Promise.resolve(null)
    ]);

    const visibleRows = focusedAssignment && !rows.some((row) => row.id === focusedAssignment.id)
      ? [focusedAssignment, ...rows]
      : rows;

    return visibleRows.map((row) => ({
      id: row.id,
      course: row.course.title,
      courseCode: row.course.code,
      provider: row.course.provider ?? "—",
      mandatory: row.course.mandatory,
      status: row.status,
      dueAt: row.dueAt?.toISOString() ?? null,
      assignedAt: row.assignedAt.toISOString(),
      successionCandidateId: row.successionCandidateId,
      developmentPlanId: row.developmentPlanId,
      developmentPlanTitle: row.developmentPlan?.title ?? null,
      developmentSkillCode: row.developmentSkill?.code ?? null,
      developmentSkillName: row.developmentSkill?.name ?? null,
      targetProficiency: row.targetProficiency,
      focused: row.id === boundedFocusId
    }));
  });
}
