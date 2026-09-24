import { EmploymentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type SuccessionTalentSignal = {
  cycleLabel: string;
  performance: string;
  potential: string;
  criticalTalent: boolean;
  assessedAt: string;
};

export type SuccessionDevelopmentAssignment = {
  id: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  courseCode: string;
  courseTitle: string;
  skillCode: string;
  skillName: string;
  targetProficiency: string | null;
  currentProficiency: string | null;
};

export type SuccessionCandidateOperation = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  readiness: string;
  rank: number | null;
  developmentGap: string | null;
  latestTalent: SuccessionTalentSignal | null;
  developmentAssignments: SuccessionDevelopmentAssignment[];
};

export type SuccessionPlanOperation = {
  id: string;
  positionId: string;
  position: string;
  positionCode: string;
  organization: string;
  critical: boolean;
  active: boolean;
  reviewDueAt: string | null;
  overdue: boolean;
  candidates: SuccessionCandidateOperation[];
};

export type SuccessionDevelopmentCourseOption = {
  id: string;
  code: string;
  title: string;
};

export type SuccessionDevelopmentSkillOption = {
  id: string;
  code: string;
  name: string;
  critical: boolean;
};

export type SuccessionGovernanceData = {
  plans: SuccessionPlanOperation[];
  courses: SuccessionDevelopmentCourseOption[];
  skills: SuccessionDevelopmentSkillOption[];
};

export async function getSuccessionGovernanceData(
  ctx: RequestContext,
  options: { includeDevelopmentCatalog?: boolean } = {}
): Promise<SuccessionGovernanceData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const scopedPositionIds = scope === null ? null : [...new Set((await db.employment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { not: EmploymentStatus.TERMINATED },
        positionId: { not: null },
        ...employmentPrimaryKeyFilter(scope)
      },
      select: { positionId: true }
    })).flatMap((employment) => employment.positionId ? [employment.positionId] : []))];

    const plans = await db.successionPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(scopedPositionIds === null ? {} : { positionId: { in: scopedPositionIds } })
      },
      orderBy: [{ active: "desc" }, { reviewDueAt: "asc" }, { updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        positionId: true,
        active: true,
        reviewDueAt: true,
        candidates: {
          where: { ...employmentIdFilter(scope) },
          orderBy: [{ rank: "asc" }, { addedAt: "asc" }],
          select: {
            id: true,
            employmentId: true,
            readiness: true,
            rank: true,
            developmentGap: true,
            learningAssignments: {
              orderBy: { assignedAt: "desc" },
              take: 20,
              select: {
                id: true,
                status: true,
                dueAt: true,
                completedAt: true,
                developmentSkillId: true,
                targetProficiency: true,
                course: { select: { code: true, title: true } },
                developmentSkill: { select: { code: true, name: true } }
              }
            }
          }
        }
      }
    });

    const positionIds = [...new Set(plans.map((plan) => plan.positionId))];
    const employmentIds = [...new Set(plans.flatMap((plan) => plan.candidates.map((candidate) => candidate.employmentId)))];
    const linkedSkillIds = [...new Set(plans.flatMap((plan) => plan.candidates.flatMap((candidate) => candidate.learningAssignments.flatMap((assignment) => assignment.developmentSkillId ? [assignment.developmentSkillId] : []))))];

    const [positions, employments, talentAssessments, employmentSkills, courses, skills] = await Promise.all([
      positionIds.length ? db.position.findMany({
        where: { tenantId: ctx.tenantId, id: { in: positionIds } },
        select: { id: true, positionCode: true, title: true, critical: true, orgUnit: { select: { name: true } } }
      }) : Promise.resolve([]),
      employmentIds.length ? db.employment.findMany({
        where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
        select: {
          id: true,
          person: { select: { givenName: true, familyName: true, employeeNumber: true } },
          position: { select: { title: true } }
        }
      }) : Promise.resolve([]),
      employmentIds.length ? db.talentAssessment.findMany({
        where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds } },
        orderBy: { assessedAt: "desc" },
        select: { employmentId: true, cycleLabel: true, performance: true, potential: true, criticalTalent: true, assessedAt: true }
      }) : Promise.resolve([]),
      employmentIds.length && linkedSkillIds.length ? db.employmentSkill.findMany({
        where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds }, skillId: { in: linkedSkillIds } },
        select: { employmentId: true, skillId: true, proficiency: true }
      }) : Promise.resolve([]),
      options.includeDevelopmentCatalog ? db.learningCourse.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ mandatory: "desc" }, { title: "asc" }],
        take: 300,
        select: { id: true, code: true, title: true }
      }) : Promise.resolve([]),
      options.includeDevelopmentCatalog ? db.skill.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ critical: "desc" }, { name: "asc" }],
        take: 500,
        select: { id: true, code: true, name: true, critical: true }
      }) : Promise.resolve([])
    ]);

    const positionMap = new Map(positions.map((position) => [position.id, position]));
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const latestTalentMap = new Map<string, (typeof talentAssessments)[number]>();
    for (const assessment of talentAssessments) {
      if (!latestTalentMap.has(assessment.employmentId)) latestTalentMap.set(assessment.employmentId, assessment);
    }
    const proficiencyMap = new Map(employmentSkills.map((record) => [`${record.employmentId}:${record.skillId}`, record.proficiency]));
    const now = Date.now();

    return {
      courses,
      skills,
      plans: plans.map((plan) => {
        const position = positionMap.get(plan.positionId);
        return {
          id: plan.id,
          positionId: plan.positionId,
          position: position?.title ?? plan.positionId,
          positionCode: position?.positionCode ?? "—",
          organization: position?.orgUnit.name ?? "Unassigned",
          critical: position?.critical ?? false,
          active: plan.active,
          reviewDueAt: plan.reviewDueAt?.toISOString() ?? null,
          overdue: Boolean(plan.active && plan.reviewDueAt && plan.reviewDueAt.getTime() < now),
          candidates: plan.candidates.map((candidate) => {
            const employment = employmentMap.get(candidate.employmentId);
            const latestTalent = latestTalentMap.get(candidate.employmentId);
            return {
              id: candidate.id,
              employmentId: candidate.employmentId,
              person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : candidate.employmentId,
              employeeNumber: employment?.person.employeeNumber ?? "—",
              position: employment?.position?.title ?? "Unassigned",
              readiness: candidate.readiness,
              rank: candidate.rank,
              developmentGap: candidate.developmentGap,
              latestTalent: latestTalent ? {
                cycleLabel: latestTalent.cycleLabel,
                performance: latestTalent.performance,
                potential: latestTalent.potential,
                criticalTalent: latestTalent.criticalTalent,
                assessedAt: latestTalent.assessedAt.toISOString()
              } : null,
              developmentAssignments: candidate.learningAssignments.flatMap((assignment) => {
                if (!assignment.developmentSkill) return [];
                return [{
                  id: assignment.id,
                  status: assignment.status,
                  dueAt: assignment.dueAt?.toISOString() ?? null,
                  completedAt: assignment.completedAt?.toISOString() ?? null,
                  courseCode: assignment.course.code,
                  courseTitle: assignment.course.title,
                  skillCode: assignment.developmentSkill.code,
                  skillName: assignment.developmentSkill.name,
                  targetProficiency: assignment.targetProficiency,
                  currentProficiency: assignment.developmentSkillId ? proficiencyMap.get(`${candidate.employmentId}:${assignment.developmentSkillId}`) ?? null : null
                }];
              })
            };
          })
        };
      })
    };
  });
}
