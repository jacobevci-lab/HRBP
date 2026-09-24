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
};

export async function getLearningParticipantData(ctx: RequestContext): Promise<LearningParticipantAssignment[]> {
  if (!ctx.employmentId || !can(ctx, "learning:self-progress")) return [];

  return withDb(async (db) => {
    const rows = await db.learningAssignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] }
      },
      orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
      take: 100,
      select: {
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
      }
    });

    return rows.map((row) => ({
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
      targetProficiency: row.targetProficiency
    }));
  });
}
