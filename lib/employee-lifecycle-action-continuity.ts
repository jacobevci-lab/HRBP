import {
  AccessRevocationStatus,
  AssetReturnStatus,
  EmploymentStatus,
  ExitTaskStatus,
  OnboardingStatus,
  OnboardingTaskStatus,
  SeparationStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import {
  getLifecycleActionCenterContinuityData,
  type ExpandedLifecycleActionItem
} from "@/lib/growth-action-center-continuity";
import {
  onboardingPlanPopulationFilter,
  resolveOnboardingPopulationScope
} from "@/lib/onboarding-access";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type EmployeeLifecycleAttentionKind = "onboarding" | "offboarding";
export type EmployeeLifecycleAttentionItem = Omit<ExpandedLifecycleActionItem, "kind"> & {
  kind: EmployeeLifecycleAttentionKind;
};
export type FullLifecycleActionItem = ExpandedLifecycleActionItem | EmployeeLifecycleAttentionItem;

const OPEN_ONBOARDING_TASKS = [
  OnboardingTaskStatus.NOT_STARTED,
  OnboardingTaskStatus.IN_PROGRESS,
  OnboardingTaskStatus.BLOCKED
];
const OPEN_SEPARATIONS = [
  SeparationStatus.DRAFT,
  SeparationStatus.NOTICE_PERIOD,
  SeparationStatus.CLEARANCE,
  SeparationStatus.FINAL_PAY_REVIEW,
  SeparationStatus.READY_TO_CLOSE
];
const CLOSED_EXIT_TASKS = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
const CLOSED_ASSETS = [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF];
const CLOSED_ACCESS = [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION];

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function urgencyForDueDate(dueAt: Date | null, fallback: LifecycleActionUrgency = "normal", now = Date.now()): LifecycleActionUrgency {
  if (!dueAt) return fallback;
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return fallback === "critical" ? "critical" : "warning";
  return fallback;
}

function sortItems(left: FullLifecycleActionItem, right: FullLifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function onboardingItems(ctx: RequestContext): Promise<EmployeeLifecycleAttentionItem[]> {
  if (!can(ctx, "onboarding:write")) return [];
  const scope = await resolveOnboardingPopulationScope(db, ctx);
  const canActivateEmployment = can(ctx, "people:write");

  const [plans, activationPlans] = await Promise.all([
    db.onboardingPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...onboardingPlanPopulationFilter(scope),
        tasks: {
          some: {
            sensitive: false,
            status: { in: OPEN_ONBOARDING_TASKS }
          }
        }
      },
      orderBy: [{ targetStartDate: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        targetStartDate: true,
        createdAt: true,
        person: { select: { givenName: true, familyName: true } },
        tasks: {
          where: {
            sensitive: false,
            status: { in: OPEN_ONBOARDING_TASKS }
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            ownerType: true,
            status: true,
            dueDate: true,
            createdAt: true
          }
        }
      }
    }),
    canActivateEmployment ? db.onboardingPlan.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...onboardingPlanPopulationFilter(scope),
        status: OnboardingStatus.COMPLETED,
        employment: { is: { status: EmploymentStatus.PREBOARDING } }
      },
      orderBy: [{ targetStartDate: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        targetStartDate: true,
        createdAt: true,
        person: { select: { givenName: true, familyName: true } },
        employment: { select: { id: true, status: true, startDate: true } }
      }
    }) : Promise.resolve([])
  ]);

  const taskItems = plans.flatMap((plan) => plan.tasks.map((task): EmployeeLifecycleAttentionItem => {
    const dueAt = task.dueDate ?? plan.targetStartDate;
    return {
      id: `onboarding:${task.id}`,
      kind: "onboarding",
      title: `Onboarding task · ${plan.person.givenName} ${plan.person.familyName}`,
      subtitle: `${task.title} · ${task.ownerType}`,
      module: "onboarding",
      href: `/module/onboarding?task=${encodeURIComponent(task.id)}`,
      subjectType: "OnboardingTask",
      subjectId: task.id,
      status: statusLabel(task.status),
      dueAt: dueAt.toISOString(),
      createdAt: task.createdAt.toISOString(),
      urgency: task.status === OnboardingTaskStatus.BLOCKED
        ? "critical"
        : urgencyForDueDate(dueAt, "warning"),
      action: task.status === OnboardingTaskStatus.IN_PROGRESS
        ? { type: "advance-onboarding-task", taskId: task.id, status: "COMPLETED" }
        : { type: "advance-onboarding-task", taskId: task.id, status: "IN_PROGRESS" }
    };
  }));

  const now = Date.now();
  const activationItems = activationPlans.map((plan): EmployeeLifecycleAttentionItem => {
    const startReached = plan.targetStartDate.getTime() <= now
      && Boolean(plan.employment && plan.employment.startDate.getTime() <= now);
    return {
      id: `onboarding:activation:${plan.id}`,
      kind: "onboarding",
      title: `Employment activation · ${plan.person.givenName} ${plan.person.familyName}`,
      subtitle: startReached
        ? "Completed onboarding · preboarding employment ready for governed activation"
        : "Completed onboarding · awaiting governed start date",
      module: "onboarding",
      href: `/module/onboarding?plan=${encodeURIComponent(plan.id)}`,
      subjectType: "OnboardingPlan",
      subjectId: plan.id,
      status: "activation ready",
      dueAt: plan.targetStartDate.toISOString(),
      createdAt: plan.createdAt.toISOString(),
      urgency: startReached ? "warning" : urgencyForDueDate(plan.targetStartDate, "normal"),
      action: startReached ? { type: "activate-onboarding-employment", planId: plan.id } : null
    };
  });

  return [...taskItems, ...activationItems];
}

async function offboardingItems(ctx: RequestContext): Promise<EmployeeLifecycleAttentionItem[]> {
  if (!can(ctx, "offboarding:write")) return [];
  const scope = await resolveEmploymentScope(db, ctx);
  const processes = await db.separationProcess.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: OPEN_SEPARATIONS },
      ...employmentIdFilter(scope)
    },
    orderBy: [{ lastWorkingDate: "asc" }, { createdAt: "asc" }],
    take: 120,
    select: {
      id: true,
      employmentId: true,
      status: true,
      lastWorkingDate: true,
      createdAt: true,
      finalSettlementStatus: true,
      tasks: {
        where: { blocking: true, status: { notIn: CLOSED_EXIT_TASKS } },
        select: { id: true, status: true },
        take: 50
      },
      assets: {
        where: { status: { notIn: CLOSED_ASSETS } },
        select: { id: true },
        take: 50
      },
      accessRevocations: {
        where: { status: { notIn: CLOSED_ACCESS } },
        select: { id: true },
        take: 50
      },
      knowledgeTransfers: {
        where: { status: { notIn: CLOSED_EXIT_TASKS } },
        select: { id: true },
        take: 50
      }
    }
  });

  const employmentIds = [...new Set(processes.map((process) => process.employmentId))];
  const employments = employmentIds.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentIds }, ...employmentIdFilter(scope) },
    select: { id: true, person: { select: { givenName: true, familyName: true } } }
  }) : [];
  const names = new Map(employments.map((employment) => [employment.id, `${employment.person.givenName} ${employment.person.familyName}`]));

  return processes.flatMap((process): EmployeeLifecycleAttentionItem[] => {
    const blockerCount = process.tasks.length + process.assets.length + process.accessRevocations.length + process.knowledgeTransfers.length;
    const finalSettlementClear = process.finalSettlementStatus === "SETTLED";
    const needsAttention = blockerCount > 0 || !finalSettlementClear || process.status === SeparationStatus.FINAL_PAY_REVIEW || process.status === SeparationStatus.READY_TO_CLOSE;
    if (!needsAttention) return [];

    const employee = names.get(process.employmentId) ?? "Scoped employee";
    const stage = statusLabel(process.status);
    const blockerText = blockerCount ? `${blockerCount} open clearance control${blockerCount === 1 ? "" : "s"}` : "clearance controls complete";
    const settlementText = finalSettlementClear ? "final settlement complete" : `final settlement ${statusLabel(process.finalSettlementStatus ?? "not started")}`;
    return [{
      id: `offboarding:${process.id}`,
      kind: "offboarding",
      title: `Offboarding clearance · ${employee}`,
      subtitle: `${stage} · ${blockerText} · ${settlementText}`,
      module: "offboarding",
      href: `/module/offboarding?separation=${encodeURIComponent(process.id)}`,
      subjectType: "SeparationProcess",
      subjectId: process.id,
      status: stage,
      dueAt: process.lastWorkingDate.toISOString(),
      createdAt: process.createdAt.toISOString(),
      urgency: process.status === SeparationStatus.READY_TO_CLOSE
        ? "warning"
        : urgencyForDueDate(process.lastWorkingDate, blockerCount > 0 ? "warning" : "normal"),
      action: null
    }];
  });
}

export async function getEmployeeLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getLifecycleActionCenterContinuityData(ctx);
  let employeeLifecycle: EmployeeLifecycleAttentionItem[] = [];
  let employeeLifecycleDegraded = false;

  try {
    const [onboarding, offboarding] = await Promise.all([
      onboardingItems(ctx),
      offboardingItems(ctx)
    ]);
    employeeLifecycle = [...onboarding, ...offboarding];
  } catch (error) {
    employeeLifecycleDegraded = true;
    console.error("[HRBP] Onboarding/offboarding lifecycle attention failed; preserving the governed Action Center.", error);
  }

  const items: FullLifecycleActionItem[] = [...base.items, ...employeeLifecycle].sort(sortItems).slice(0, 300);
  const now = Date.now();
  const soon = now + 24 * 60 * 60 * 1000;

  return {
    items,
    summary: {
      ...base.summary,
      total: items.length,
      overdue: items.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now).length,
      dueSoon: items.filter((item) => {
        if (!item.dueAt) return false;
        const due = new Date(item.dueAt).getTime();
        return due >= now && due <= soon;
      }).length,
      critical: items.filter((item) => item.urgency === "critical").length,
      onboarding: items.filter((item) => item.kind === "onboarding").length,
      offboarding: items.filter((item) => item.kind === "offboarding").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded
  };
}
