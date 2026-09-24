import { DevelopmentPlanStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type DevelopmentPlanParticipantRow = {
  id: string;
  title: string;
  objective: string | null;
  outcomeNotes: string | null;
  status: string;
  owner: string;
  sourceCycleLabel: string | null;
  focusSkillCode: string | null;
  focusSkillName: string | null;
  currentProficiency: string | null;
  targetProficiency: string | null;
  startsAt: string;
  targetAt: string;
  completedAt: string | null;
  learningTotal: number;
  learningCompleted: number;
  learningOpen: number;
  successionLinked: boolean;
};

/**
 * Employee-facing development data is intentionally narrower than Talent.
 * Draft plans and talent-assessment ratings are not exposed here. Employees
 * only see their own activated/completed plan objectives, skill target and
 * aggregate learning evidence through the Learning self-service boundary.
 */
export async function getDevelopmentPlanParticipantData(ctx: RequestContext): Promise<DevelopmentPlanParticipantRow[]> {
  if (!ctx.employmentId || !can(ctx, "learning:self-progress")) return [];

  return withDb(async (db) => {
    const plans = await db.developmentPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [DevelopmentPlanStatus.ACTIVE, DevelopmentPlanStatus.COMPLETED] }
      },
      orderBy: [{ status: "asc" }, { targetAt: "asc" }, { updatedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        objective: true,
        outcomeNotes: true,
        status: true,
        ownerId: true,
        sourceAssessment: { select: { cycleLabel: true } },
        successionCandidateId: true,
        focusSkillId: true,
        focusSkill: { select: { code: true, name: true } },
        targetProficiency: true,
        startsAt: true,
        targetAt: true,
        completedAt: true,
        learningAssignments: {
          select: { status: true }
        }
      }
    });

    const ownerIds = [...new Set(plans.map((plan) => plan.ownerId))];
    const skillIds = [...new Set(plans.flatMap((plan) => plan.focusSkillId ? [plan.focusSkillId] : []))];
    const [owners, proficiencies] = await Promise.all([
      ownerIds.length ? db.userAccount.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ownerIds } },
        select: { id: true, displayName: true, email: true }
      }) : [],
      skillIds.length ? db.employmentSkill.findMany({
        where: { tenantId: ctx.tenantId, employmentId: ctx.employmentId, skillId: { in: skillIds } },
        select: { skillId: true, proficiency: true }
      }) : []
    ]);

    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const proficiencyMap = new Map(proficiencies.map((entry) => [entry.skillId, entry.proficiency]));

    return plans.map((plan) => {
      const owner = ownerMap.get(plan.ownerId);
      const learningCompleted = plan.learningAssignments.filter((assignment) => assignment.status === "COMPLETED" || assignment.status === "WAIVED").length;
      return {
        id: plan.id,
        title: plan.title,
        objective: plan.objective,
        outcomeNotes: plan.outcomeNotes,
        status: plan.status,
        owner: owner?.displayName ?? owner?.email ?? plan.ownerId,
        sourceCycleLabel: plan.sourceAssessment?.cycleLabel ?? null,
        focusSkillCode: plan.focusSkill?.code ?? null,
        focusSkillName: plan.focusSkill?.name ?? null,
        currentProficiency: plan.focusSkillId ? proficiencyMap.get(plan.focusSkillId) ?? null : null,
        targetProficiency: plan.targetProficiency,
        startsAt: plan.startsAt.toISOString(),
        targetAt: plan.targetAt.toISOString(),
        completedAt: plan.completedAt?.toISOString() ?? null,
        learningTotal: plan.learningAssignments.length,
        learningCompleted,
        learningOpen: plan.learningAssignments.length - learningCompleted,
        successionLinked: Boolean(plan.successionCandidateId)
      };
    });
  });
}
