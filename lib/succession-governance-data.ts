import { EmploymentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type SuccessionCandidateOperation = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  readiness: string;
  rank: number | null;
  developmentGap: string | null;
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

export async function getSuccessionGovernanceData(ctx: RequestContext): Promise<SuccessionPlanOperation[]> {
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
            developmentGap: true
          }
        }
      }
    });

    const positionIds = [...new Set(plans.map((plan) => plan.positionId))];
    const employmentIds = [...new Set(plans.flatMap((plan) => plan.candidates.map((candidate) => candidate.employmentId)))];
    const [positions, employments] = await Promise.all([
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
      }) : Promise.resolve([])
    ]);
    const positionMap = new Map(positions.map((position) => [position.id, position]));
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const now = Date.now();

    return plans.map((plan) => {
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
          return {
            id: candidate.id,
            employmentId: candidate.employmentId,
            person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : candidate.employmentId,
            employeeNumber: employment?.person.employeeNumber ?? "—",
            position: employment?.position?.title ?? "Unassigned",
            readiness: candidate.readiness,
            rank: candidate.rank,
            developmentGap: candidate.developmentGap
          };
        })
      };
    });
  });
}
