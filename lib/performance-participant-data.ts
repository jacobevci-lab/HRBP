import { ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type ParticipantSelfReview = {
  id: string;
  cycle: string;
  status: string;
  selfRating: string | null;
  updatedAt: string;
};

export type ParticipantManagerReview = {
  id: string;
  cycle: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  selfRating: string | null;
  updatedAt: string;
};

export type PerformanceParticipantData = {
  selfReviews: ParticipantSelfReview[];
  managerReviews: ParticipantManagerReview[];
};

export async function getPerformanceParticipantData(ctx: RequestContext): Promise<PerformanceParticipantData> {
  if (!ctx.employmentId) return { selfReviews: [], managerReviews: [] };

  return withDb(async (db) => {
    const selfEnabled = can(ctx, "performance:self-submit");
    const managerEnabled = can(ctx, "performance:manager-review");

    const [selfReviews, managerReviews] = await Promise.all([
      selfEnabled ? db.performanceReview.findMany({
        where: {
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: { in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW] },
          cycle: { status: ReviewCycleStatus.OPEN }
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          selfRating: true,
          updatedAt: true,
          cycle: { select: { name: true } }
        }
      }) : Promise.resolve([]),
      managerEnabled ? db.performanceReview.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerEmploymentId: ctx.employmentId,
          status: ReviewStatus.MANAGER_REVIEW,
          cycle: { status: ReviewCycleStatus.OPEN }
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
        select: {
          id: true,
          employmentId: true,
          selfRating: true,
          updatedAt: true,
          cycle: { select: { name: true } }
        }
      }) : Promise.resolve([])
    ]);

    const employmentIds = [...new Set(managerReviews.map((review) => review.employmentId))];
    const employments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
      select: {
        id: true,
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        position: { select: { title: true } }
      }
    }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));

    return {
      selfReviews: selfReviews.map((review) => ({
        id: review.id,
        cycle: review.cycle.name,
        status: review.status,
        selfRating: review.selfRating,
        updatedAt: review.updatedAt.toISOString()
      })),
      managerReviews: managerReviews.flatMap((review) => {
        const employment = employmentMap.get(review.employmentId);
        return employment ? [{
          id: review.id,
          cycle: review.cycle.name,
          employmentId: review.employmentId,
          person: `${employment.person.givenName} ${employment.person.familyName}`,
          employeeNumber: employment.person.employeeNumber ?? "—",
          position: employment.position?.title ?? "Unassigned",
          selfRating: review.selfRating,
          updatedAt: review.updatedAt.toISOString()
        }] : [];
      })
    };
  });
}
