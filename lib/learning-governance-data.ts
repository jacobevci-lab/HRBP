import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type LearningGovernanceCourse = {
  id: string;
  code: string;
  title: string;
  provider: string | null;
  mandatory: boolean;
  validityMonths: number | null;
  active: boolean;
  assignments: number;
};

export type LearningGovernanceSkill = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  critical: boolean;
  active: boolean;
  assessed: number;
};

export type EmploymentSkillGovernance = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  organization: string;
  skill: string;
  skillCode: string;
  proficiency: string;
  source: string | null;
  assessedAt: string;
};

export type LearningGovernanceData = {
  courses: LearningGovernanceCourse[];
  skills: LearningGovernanceSkill[];
  employmentSkills: EmploymentSkillGovernance[];
};

export async function getLearningGovernanceData(ctx: RequestContext): Promise<LearningGovernanceData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const [courses, skills, employmentSkills] = await Promise.all([
      db.learningCourse.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ active: "desc" }, { mandatory: "desc" }, { title: "asc" }],
        take: 300,
        select: {
          id: true,
          code: true,
          title: true,
          provider: true,
          mandatory: true,
          validityMonths: true,
          active: true,
          _count: { select: { assignments: { where: { ...employmentIdFilter(scope) } } } }
        }
      }),
      db.skill.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ active: "desc" }, { critical: "desc" }, { name: "asc" }],
        take: 500,
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          critical: true,
          active: true,
          _count: { select: { employments: { where: { ...employmentIdFilter(scope) } } } }
        }
      }),
      db.employmentSkill.findMany({
        where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        orderBy: { assessedAt: "desc" },
        take: 500,
        select: { id: true, employmentId: true, skillId: true, proficiency: true, source: true, assessedAt: true }
      })
    ]);

    const employmentIds = [...new Set(employmentSkills.map((row) => row.employmentId))];
    const skillIds = [...new Set(employmentSkills.map((row) => row.skillId))];
    const [employments, assessedSkills] = await Promise.all([
      employmentIds.length ? db.employment.findMany({
        where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
        select: {
          id: true,
          person: { select: { givenName: true, familyName: true, employeeNumber: true } },
          position: { select: { title: true, orgUnit: { select: { name: true } } } }
        }
      }) : [],
      skillIds.length ? db.skill.findMany({
        where: { tenantId: ctx.tenantId, id: { in: skillIds } },
        select: { id: true, code: true, name: true }
      }) : []
    ]);
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const skillMap = new Map(assessedSkills.map((skill) => [skill.id, skill]));

    return {
      courses: courses.map((course) => ({
        id: course.id,
        code: course.code,
        title: course.title,
        provider: course.provider,
        mandatory: course.mandatory,
        validityMonths: course.validityMonths,
        active: course.active,
        assignments: course._count.assignments
      })),
      skills: skills.map((skill) => ({
        id: skill.id,
        code: skill.code,
        name: skill.name,
        category: skill.category,
        critical: skill.critical,
        active: skill.active,
        assessed: skill._count.employments
      })),
      employmentSkills: employmentSkills.map((row) => {
        const employment = employmentMap.get(row.employmentId);
        const skill = skillMap.get(row.skillId);
        return {
          id: row.id,
          employmentId: row.employmentId,
          person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : row.employmentId,
          employeeNumber: employment?.person.employeeNumber ?? "—",
          position: employment?.position?.title ?? "Unassigned",
          organization: employment?.position?.orgUnit.name ?? "Unassigned",
          skill: skill?.name ?? row.skillId,
          skillCode: skill?.code ?? "—",
          proficiency: row.proficiency,
          source: row.source,
          assessedAt: row.assessedAt.toISOString()
        };
      })
    };
  });
}
