import { EmploymentStatus, PositionStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type GrowthWriteSlug = "benefits" | "talent" | "succession" | "learning";
export type GrowthEmploymentOption = { id: string; person: string; employeeNumber: string; position: string; organization: string };
export type GrowthPositionOption = { id: string; code: string; title: string; organization: string; critical: boolean };
export type GrowthPlanOption = { id: string; code: string; name: string; type: string };
export type GrowthSuccessionPlanOption = { id: string; position: string; positionCode: string };
export type GrowthCourseOption = { id: string; code: string; title: string; mandatory: boolean };
export type GrowthSkillOption = { id: string; code: string; name: string; critical: boolean };

export type GrowthOperationsData = {
  employments: GrowthEmploymentOption[];
  positions: GrowthPositionOption[];
  benefitPlans: GrowthPlanOption[];
  successionPlans: GrowthSuccessionPlanOption[];
  courses: GrowthCourseOption[];
  skills: GrowthSkillOption[];
};

export async function getGrowthOperationsData(ctx: RequestContext, slug: GrowthWriteSlug): Promise<GrowthOperationsData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const employments = await db.employment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: [EmploymentStatus.PREBOARDING, EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] },
        ...employmentPrimaryKeyFilter(scope)
      },
      orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
      take: 500,
      select: {
        id: true,
        positionId: true,
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    });

    const scopedPositionIds = scope === null ? null : [...new Set(employments.flatMap((employment) => employment.positionId ? [employment.positionId] : []))];
    const empty: never[] = [];
    const [positions, benefitPlans, successionPlans, courses, skills] = await Promise.all([
      slug === "succession" ? db.position.findMany({
        where: {
          tenantId: ctx.tenantId,
          validTo: null,
          status: { not: PositionStatus.CLOSED },
          ...(scopedPositionIds === null ? {} : { id: { in: scopedPositionIds } })
        },
        orderBy: [{ critical: "desc" }, { positionCode: "asc" }],
        take: 500,
        select: { id: true, positionCode: true, title: true, critical: true, orgUnit: { select: { name: true } } }
      }) : Promise.resolve(empty),
      slug === "benefits" ? db.benefitPlan.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        take: 250,
        select: { id: true, code: true, name: true, type: true }
      }) : Promise.resolve(empty),
      slug === "succession" ? db.successionPlan.findMany({
        where: {
          tenantId: ctx.tenantId,
          active: true,
          ...(scopedPositionIds === null ? {} : { positionId: { in: scopedPositionIds } })
        },
        orderBy: { updatedAt: "desc" },
        take: 250,
        select: { id: true, position: { select: { positionCode: true, title: true } } }
      }) : Promise.resolve(empty),
      slug === "learning" ? db.learningCourse.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ mandatory: "desc" }, { title: "asc" }],
        take: 300,
        select: { id: true, code: true, title: true, mandatory: true }
      }) : Promise.resolve(empty),
      slug === "learning" ? db.skill.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: [{ critical: "desc" }, { name: "asc" }],
        take: 500,
        select: { id: true, code: true, name: true, critical: true }
      }) : Promise.resolve(empty)
    ]);

    return {
      employments: employments.map((employment) => ({
        id: employment.id,
        person: `${employment.person.givenName} ${employment.person.familyName}`,
        employeeNumber: employment.person.employeeNumber ?? "—",
        position: employment.position?.title ?? "Unassigned",
        organization: employment.position?.orgUnit.name ?? "Unassigned"
      })),
      positions: positions.map((position) => ({ id: position.id, code: position.positionCode, title: position.title, organization: position.orgUnit.name, critical: position.critical })),
      benefitPlans: benefitPlans.map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, type: plan.type })),
      successionPlans: successionPlans.map((plan) => ({ id: plan.id, position: plan.position.title, positionCode: plan.position.positionCode })),
      courses: courses.map((course) => ({ id: course.id, code: course.code, title: course.title, mandatory: course.mandatory })),
      skills: skills.map((skill) => ({ id: skill.id, code: skill.code, name: skill.name, critical: skill.critical }))
    };
  });
}
