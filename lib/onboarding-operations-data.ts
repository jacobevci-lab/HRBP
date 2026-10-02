import { EmploymentStatus, OnboardingStatus, Prisma } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { startRiskHours, type ReadinessPlan, type ReadinessTask } from "@/lib/onboarding-readiness-view.mjs";
import { encodeOnboardingCursor, onboardingOperationsPredicate, parseOnboardingOperationsQuery } from "@/lib/onboarding-operations-query.mjs";
import { runtimeNumber } from "@/lib/runtime-env";
import type { RequestContext } from "@/lib/request-context";

export type OnboardingTaskOperation = ReadinessTask & {
  person: string; employeeNumber: string; planStatus: string;
  employmentStatus: string | null; targetStartDate: string;
};
export type OnboardingOperationsSnapshot = {
  tasks: OnboardingTaskOperation[]; plans: ReadinessPlan[]; generatedAt: string;
  startRiskHours: number; canActivate: boolean; hasMorePlans: boolean;
  planLimit: number; taskLimit: number;
  page: { version: 1; mode: "list" | "focus"; nextCursor: string | null; resolved: boolean };
};
const PLAN_LIMIT = 100;
const TASK_LIMIT = 200;
const taskSelect = { id: true, title: true, ownerType: true, status: true, dueDate: true, sensitive: true } as const;

// Keep the existing server workspace call and signed-context contract.
export async function getOnboardingOperationsData(ctx: RequestContext): Promise<OnboardingOperationsSnapshot> {
  return getOnboardingOperationsPage(ctx, new URLSearchParams());
}

export async function getOnboardingOperationsPage(ctx: RequestContext, search: URLSearchParams): Promise<OnboardingOperationsSnapshot> {
  if (!can(ctx, "onboarding:read") || !can(ctx, "onboarding:write")) throw new Error("ONBOARDING_OPERATIONS_FORBIDDEN");
  const options = parseOnboardingOperationsQuery(search);
  return withDb((client) => client.$transaction(async (db) => {
    const scope = await resolveOnboardingPopulationScope(db, ctx);
    // Focus and cursors are positional filters, not authority. Re-resolve scope on every request.
    const where: Prisma.OnboardingPlanWhereInput = {
      tenantId: ctx.tenantId,
      AND: [
        { OR: [
          { status: { not: OnboardingStatus.COMPLETED } },
          { status: OnboardingStatus.COMPLETED, employment: { is: { status: EmploymentStatus.PREBOARDING } } }
        ] },
        onboardingPlanPopulationFilter(scope),
        onboardingOperationsPredicate(options, ctx.tenantId)
      ]
    };
    const records = await db.onboardingPlan.findMany({
      where,
      orderBy: [{ targetStartDate: "asc" }, { id: "asc" }],
      take: options.mode === "focus" ? 1 : PLAN_LIMIT + 1,
      select: {
        id: true, status: true, targetStartDate: true,
        person: { select: { givenName: true, familyName: true, employeeNumber: true } },
        employment: { select: { status: true, startDate: true } },
        _count: { select: { tasks: true } },
        tasks: {
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: TASK_LIMIT,
          select: taskSelect
        }
      }
    });
    const plans = records.slice(0, PLAN_LIMIT);
    // A notification may target task 201+. Pin it without removing the total-count
    // warning or making a partial task list eligible for employment activation.
    if (options.mode === "focus" && options.taskId && plans[0] && !plans[0].tasks.some((task) => task.id === options.taskId)) {
      const task = await db.onboardingTask.findFirst({
        where: { id: options.taskId, tenantId: ctx.tenantId, planId: plans[0].id, plan: { is: where } },
        select: taskSelect
      });
      if (!task) throw new Error("ONBOARDING_FOCUS_CHANGED");
      plans[0].tasks = [...plans[0].tasks.slice(0, TASK_LIMIT - 1), task];
    }
    const hasMorePlans = options.mode === "list" && records.length > PLAN_LIMIT;
    const last = plans.at(-1);
    return {
      plans: plans.map((plan) => ({
        id: plan.id, person: `${plan.person.givenName} ${plan.person.familyName}`,
        employeeNumber: plan.person.employeeNumber ?? "—", planStatus: plan.status,
        employmentStatus: plan.employment?.status ?? null,
        targetStartDate: plan.targetStartDate.toISOString(),
        employmentStartDate: plan.employment?.startDate.toISOString() ?? null,
        totalTasks: plan._count.tasks
      })),
      tasks: plans.flatMap((plan) => plan.tasks.map((task) => ({
        id: task.id, planId: plan.id,
        person: `${plan.person.givenName} ${plan.person.familyName}`,
        employeeNumber: plan.person.employeeNumber ?? "—", planStatus: plan.status,
        employmentStatus: plan.employment?.status ?? null,
        targetStartDate: plan.targetStartDate.toISOString(),
        title: task.title, ownerType: task.ownerType, status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null, sensitive: task.sensitive
      }))),
      generatedAt: new Date().toISOString(),
      startRiskHours: startRiskHours(runtimeNumber("HRBP_ONBOARDING_START_RISK_HOURS", 72)),
      canActivate: can(ctx, "onboarding:write") && can(ctx, "people:write"),
      hasMorePlans, planLimit: PLAN_LIMIT, taskLimit: TASK_LIMIT,
      page: {
        version: 1 as const, mode: options.mode,
        nextCursor: hasMorePlans && last ? encodeOnboardingCursor({ date: last.targetStartDate.toISOString(), id: last.id }) : null,
        resolved: options.mode === "list" || plans.length === 1
      }
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 }));
}
