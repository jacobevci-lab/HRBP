import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type DevelopmentPlanAssignment = {
  id: string;
  courseCode: string;
  courseTitle: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
};

export type DevelopmentPlanOperation = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  title: string;
  objective: string | null;
  outcomeNotes: string | null;
  status: string;
  owner: string;
  sourceCycleLabel: string | null;
  successionCandidateId: string | null;
  focusSkillId: string | null;
  focusSkill: string | null;
  focusSkillCode: string | null;
  targetProficiency: string | null;
  currentProficiency: string | null;
  startsAt: string;
  targetAt: string;
  completedAt: string | null;
  assignments: DevelopmentPlanAssignment[];
};

export type DevelopmentPlanCatalogSkill = {
  id: string;
  code: string;
  name: string;
};

export type DevelopmentPlanCatalogCourse = {
  id: string;
  code: string;
  title: string;
  provider: string;
};

export type DevelopmentPlanGovernanceData = {
  plans: DevelopmentPlanOperation[];
  skills: DevelopmentPlanCatalogSkill[];
  courses: DevelopmentPlanCatalogCourse[];
};

export async function getDevelopmentPlanGovernanceData(
  ctx: RequestContext,
  options: { includeLearningCatalog?: boolean } = {}
): Promise<DevelopmentPlanGovernanceData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const plans = await db.developmentPlan.findMany({
      where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
      orderBy: [{ status: "asc" }, { targetAt: "asc" }, { updatedAt: "desc" }],
      take: 250,
      select: {
        id: true,
        employmentId: true,
        title: true,
        objective: true,
        outcomeNotes: true,
        status: true,
        ownerId: true,
        successionCandidateId: true,
        focusSkillId: true,
        targetProficiency: true,
        startsAt: true,
        targetAt: true,
        completedAt: true,
        sourceAssessment: { select: { cycleLabel: true } },
        focusSkill: { select: { code: true, name: true } },
        learningAssignments: {
          orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
          take: 50,
          select: {
            id: true,
            status: true,
            dueAt: true,
            completedAt: true,
            course: { select: { code: true, title: true } }
          }
        }
      }
    });

    const employmentIds = [...new Set(plans.map((plan) => plan.employmentId))];
    const ownerIds = [...new Set(plans.map((plan) => plan.ownerId))];
    const skillIds = [...new Set(plans.flatMap((plan) => plan.focusSkillId ? [plan.focusSkillId] : []))];

    const [employments, owners, proficiencies, skills, courses] = await Promise.all([
      employmentIds.length ? db.employment.findMany({
        where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
        select: {
          id: true,
          person: { select: { givenName: true, familyName: true, employeeNumber: true } },
          position: { select: { title: true } }
        }
      }) : [],
      ownerIds.length ? db.userAccount.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ownerIds } },
        select: { id: true, displayName: true, email: true }
      }) : [],
      employmentIds.length && skillIds.length ? db.employmentSkill.findMany({
        where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds }, skillId: { in: skillIds } },
        select: { employmentId: true, skillId: true, proficiency: true }
      }) : [],
      options.includeLearningCatalog ? db.skill.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ critical: "desc" }, { name: "asc" }],
        take: 300,
        select: { id: true, code: true, name: true }
      }) : [],
      options.includeLearningCatalog ? db.learningCourse.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ mandatory: "desc" }, { title: "asc" }],
        take: 300,
        select: { id: true, code: true, title: true, provider: true }
      }) : []
    ]);

    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const proficiencyMap = new Map(proficiencies.map((entry) => [`${entry.employmentId}:${entry.skillId}`, entry.proficiency]));

    return {
      plans: plans.map((plan) => {
        const employment = employmentMap.get(plan.employmentId);
        const owner = ownerMap.get(plan.ownerId);
        return {
          id: plan.id,
          employmentId: plan.employmentId,
          person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : plan.employmentId,
          employeeNumber: employment?.person.employeeNumber ?? "—",
          position: employment?.position?.title ?? "Unassigned",
          title: plan.title,
          objective: plan.objective,
          outcomeNotes: plan.outcomeNotes,
          status: plan.status,
          owner: owner?.displayName ?? owner?.email ?? plan.ownerId,
          sourceCycleLabel: plan.sourceAssessment?.cycleLabel ?? null,
          successionCandidateId: plan.successionCandidateId,
          focusSkillId: plan.focusSkillId,
          focusSkill: plan.focusSkill?.name ?? null,
          focusSkillCode: plan.focusSkill?.code ?? null,
          targetProficiency: plan.targetProficiency,
          currentProficiency: plan.focusSkillId ? proficiencyMap.get(`${plan.employmentId}:${plan.focusSkillId}`) ?? null : null,
          startsAt: plan.startsAt.toISOString(),
          targetAt: plan.targetAt.toISOString(),
          completedAt: plan.completedAt?.toISOString() ?? null,
          assignments: plan.learningAssignments.map((assignment) => ({
            id: assignment.id,
            courseCode: assignment.course.code,
            courseTitle: assignment.course.title,
            status: assignment.status,
            dueAt: assignment.dueAt?.toISOString() ?? null,
            completedAt: assignment.completedAt?.toISOString() ?? null
          }))
        };
      }),
      skills: skills.map((skill) => ({ id: skill.id, code: skill.code, name: skill.name })),
      courses: courses.map((course) => ({ id: course.id, code: course.code, title: course.title, provider: course.provider ?? "—" }))
    };
  });
}
