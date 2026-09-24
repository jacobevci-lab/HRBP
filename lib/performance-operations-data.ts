import { EmploymentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type PerformanceEmploymentOption = {
  id: string;
  person: string;
  employeeNumber: string;
  position: string;
  organization: string;
};

export type PerformanceCycleOperation = {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  calibrationAt: string | null;
  reviewCount: number;
};

export type PerformanceReviewOperation = {
  id: string;
  cycleId: string;
  cycleName: string;
  employmentId: string;
  person: string;
  status: string;
  selfRating: string | null;
  managerRating: string | null;
  finalRating: string | null;
};

export type PerformanceGoalOperation = {
  id: string;
  employmentId: string;
  person: string;
  title: string;
  progress: number;
  status: string;
  dueAt: string;
};

export type PerformanceOperationsData = {
  employments: PerformanceEmploymentOption[];
  cycles: PerformanceCycleOperation[];
  reviews: PerformanceReviewOperation[];
  goals: PerformanceGoalOperation[];
};

export async function getPerformanceOperationsData(ctx: RequestContext): Promise<PerformanceOperationsData> {
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
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    });
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));

    const [cycles, reviews, goals] = await Promise.all([
      db.reviewCycle.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { endsAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          status: true,
          startsAt: true,
          endsAt: true,
          calibrationAt: true,
          _count: { select: { reviews: { where: { ...employmentIdFilter(scope) } } } }
        }
      }),
      db.performanceReview.findMany({
        where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        orderBy: { updatedAt: "desc" },
        take: 250,
        select: {
          id: true,
          cycleId: true,
          employmentId: true,
          status: true,
          selfRating: true,
          managerRating: true,
          finalRating: true,
          cycle: { select: { name: true } }
        }
      }),
      db.goal.findMany({
        where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
        take: 120,
        select: { id: true, employmentId: true, title: true, progress: true, status: true, dueAt: true }
      })
    ]);

    const personName = (employmentId: string) => {
      const employment = employmentMap.get(employmentId);
      return employment ? `${employment.person.givenName} ${employment.person.familyName}` : employmentId;
    };

    return {
      employments: employments.map((employment) => ({
        id: employment.id,
        person: `${employment.person.givenName} ${employment.person.familyName}`,
        employeeNumber: employment.person.employeeNumber ?? "—",
        position: employment.position?.title ?? "Unassigned",
        organization: employment.position?.orgUnit.name ?? "Unassigned"
      })),
      cycles: cycles.map((cycle) => ({
        id: cycle.id,
        name: cycle.name,
        status: cycle.status,
        startsAt: cycle.startsAt.toISOString(),
        endsAt: cycle.endsAt.toISOString(),
        calibrationAt: cycle.calibrationAt?.toISOString() ?? null,
        reviewCount: cycle._count.reviews
      })),
      reviews: reviews.map((review) => ({
        id: review.id,
        cycleId: review.cycleId,
        cycleName: review.cycle.name,
        employmentId: review.employmentId,
        person: personName(review.employmentId),
        status: review.status,
        selfRating: review.selfRating,
        managerRating: review.managerRating,
        finalRating: review.finalRating
      })),
      goals: goals.map((goal) => ({
        id: goal.id,
        employmentId: goal.employmentId,
        person: personName(goal.employmentId),
        title: goal.title,
        progress: goal.progress,
        status: goal.status,
        dueAt: goal.dueAt.toISOString()
      }))
    };
  });
}
