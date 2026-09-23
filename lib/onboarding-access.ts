import { Prisma, PrismaClient } from "@prisma/client";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

export type OnboardingPopulationScope = {
  employmentIds: string[] | null;
  personIds: string[] | null;
};

export async function resolveOnboardingPopulationScope(client: ScopeClient, ctx: RequestContext): Promise<OnboardingPopulationScope> {
  const employmentIds = await resolveEmploymentScope(client, ctx);
  if (employmentIds === null) return { employmentIds: null, personIds: null };
  if (!employmentIds.length) return { employmentIds: [], personIds: [] };
  const rows = await client.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
    select: { personId: true }
  });
  return { employmentIds, personIds: [...new Set(rows.map((row) => row.personId))] };
}

export function onboardingPlanPopulationFilter(scope: OnboardingPopulationScope): Prisma.OnboardingPlanWhereInput {
  if (scope.employmentIds === null || scope.personIds === null) return {};
  return {
    OR: [
      { employmentId: { in: scope.employmentIds } },
      { personId: { in: scope.personIds } }
    ]
  };
}

export function canAccessOnboardingPlan(scope: OnboardingPopulationScope, plan: { employmentId: string | null; personId: string }) {
  if (scope.employmentIds === null || scope.personIds === null) return true;
  return Boolean((plan.employmentId && scope.employmentIds.includes(plan.employmentId)) || scope.personIds.includes(plan.personId));
}
