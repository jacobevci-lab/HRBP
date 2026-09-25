import { OnboardingStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import type { RequestContext } from "@/lib/request-context";

export type OnboardingTaskOperation = {
  id: string;
  planId: string;
  person: string;
  employeeNumber: string;
  planStatus: string;
  title: string;
  ownerType: string;
  status: string;
  dueDate: string | null;
  sensitive: boolean;
};

export async function getOnboardingOperationsData(ctx: RequestContext): Promise<OnboardingTaskOperation[]> {
  return withDb(async (db) => {
    const scope = await resolveOnboardingPopulationScope(db, ctx);
    const plans = await db.onboardingPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { not: OnboardingStatus.COMPLETED },
        ...onboardingPlanPopulationFilter(scope)
      },
      orderBy: { targetStartDate: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        tasks: {
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true, ownerType: true, status: true, dueDate: true, sensitive: true }
        }
      }
    });

    return plans.flatMap((plan) => plan.tasks.map((task) => ({
      id: task.id,
      planId: plan.id,
      person: `${plan.person.givenName} ${plan.person.familyName}`,
      employeeNumber: plan.person.employeeNumber ?? "—",
      planStatus: plan.status,
      title: task.title,
      ownerType: task.ownerType,
      status: task.status,
      dueDate: task.dueDate?.toISOString() ?? null,
      sensitive: task.sensitive
    })));
  });
}
