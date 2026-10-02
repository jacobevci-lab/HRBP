import { EmploymentStatus, OnboardingStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { startRiskHours, type ReadinessPlan, type ReadinessTask } from "@/lib/onboarding-readiness-view.mjs";
import { runtimeNumber } from "@/lib/runtime-env";
import type { RequestContext } from "@/lib/request-context";

export type OnboardingTaskOperation = ReadinessTask & {
  person: string;
  employeeNumber: string;
  planStatus: string;
  employmentStatus: string | null;
  targetStartDate: string;
};
export type OnboardingOperationsSnapshot = {
  tasks: OnboardingTaskOperation[];
  plans: ReadinessPlan[];
  generatedAt: string;
  startRiskHours: number;
  canActivate: boolean;
  hasMorePlans: boolean;
  planLimit: number;
  taskLimit: number;
};
const PLAN_LIMIT = 100;
const TASK_LIMIT = 200;

export async function getOnboardingOperationsData(ctx: RequestContext): Promise<OnboardingOperationsSnapshot> {
  if (!can(ctx, "onboarding:read") || !can(ctx, "onboarding:write")) throw new Error("ONBOARDING_OPERATIONS_FORBIDDEN");
  return withDb(async (db) => {
    const scope = await resolveOnboardingPopulationScope(db, ctx);
    const records = await db.onboardingPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [
          { status: { not: OnboardingStatus.COMPLETED } },
          { status: OnboardingStatus.COMPLETED, employment: { is: { status: EmploymentStatus.PREBOARDING } } }
        ],
        ...onboardingPlanPopulationFilter(scope)
      },
      orderBy: [{ targetStartDate: "asc" }, { id: "asc" }],
      take: PLAN_LIMIT + 1,
      select: {
        id: true,
        status: true,
        targetStartDate: true,
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        employment: { select: { status: true, startDate: true } },
        _count: { select: { tasks: true } },
        tasks: {
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: TASK_LIMIT,
          select: { id: true, title: true, ownerType: true, status: true, dueDate: true, sensitive: true }
        }
      }
    });
    const plans = records.slice(0, PLAN_LIMIT);
    return {
      // Plan identity and task totals survive even when there are no task rows.
      plans: plans.map((plan) => ({
        id: plan.id,
        person: `${plan.person.givenName} ${plan.person.familyName}`,
        employeeNumber: plan.person.employeeNumber ?? "—",
        planStatus: plan.status,
        employmentStatus: plan.employment?.status ?? null,
        targetStartDate: plan.targetStartDate.toISOString(),
        employmentStartDate: plan.employment?.startDate.toISOString() ?? null,
        totalTasks: plan._count.tasks
      })),
      tasks: plans.flatMap((plan) => plan.tasks.map((task) => ({
        id: task.id,
        planId: plan.id,
        person: `${plan.person.givenName} ${plan.person.familyName}`,
        employeeNumber: plan.person.employeeNumber ?? "—",
        planStatus: plan.status,
        employmentStatus: plan.employment?.status ?? null,
        targetStartDate: plan.targetStartDate.toISOString(),
        title: task.title,
        ownerType: task.ownerType,
        status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null,
        sensitive: task.sensitive
      }))),
      generatedAt: new Date().toISOString(),
      startRiskHours: startRiskHours(runtimeNumber("HRBP_ONBOARDING_START_RISK_HOURS", 72)),
      canActivate: can(ctx, "onboarding:write") && can(ctx, "people:write"),
      hasMorePlans: records.length > PLAN_LIMIT,
      planLimit: PLAN_LIMIT,
      taskLimit: TASK_LIMIT
    };
  });
}
