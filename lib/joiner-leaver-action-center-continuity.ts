import {
  AccessRevocationStatus,
  AssetReturnStatus,
  EmploymentStatus,
  ExitTaskStatus,
  OnboardingStatus,
  OnboardingTaskStatus,
  PlatformRole,
  SeparationStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getLifecycleActionCenterContinuityData, type ExpandedLifecycleActionItem } from "@/lib/growth-action-center-continuity";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

const OPEN_ONBOARDING_TASKS: OnboardingTaskStatus[] = [
  OnboardingTaskStatus.NOT_STARTED,
  OnboardingTaskStatus.IN_PROGRESS,
  OnboardingTaskStatus.BLOCKED
];
const OPEN_EXIT_TASKS: ExitTaskStatus[] = [ExitTaskStatus.NOT_STARTED, ExitTaskStatus.IN_PROGRESS, ExitTaskStatus.BLOCKED];
const TERMINAL_EXIT_TASKS: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
const OPEN_SEPARATIONS: SeparationStatus[] = [
  SeparationStatus.DRAFT,
  SeparationStatus.NOTICE_PERIOD,
  SeparationStatus.CLEARANCE,
  SeparationStatus.FINAL_PAY_REVIEW,
  SeparationStatus.READY_TO_CLOSE
];

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function boundedHours(key: string, fallback: number) {
  return Math.min(336, Math.max(1, Math.floor(runtimeNumber(key, fallback))));
}

function urgencyForDate(dueAt: Date | null, fallback: "normal" | "warning" | "critical" = "normal", now = Date.now()) {
  if (!dueAt) return fallback;
  if (dueAt.getTime() < now) return "critical" as const;
  if (dueAt.getTime() <= now + 24 * 60 * 60 * 1000) return fallback === "critical" ? "critical" as const : "warning" as const;
  return fallback;
}

function sortItems(left: ExpandedLifecycleActionItem, right: ExpandedLifecycleActionItem) {
  const rank = { critical: 0, warning: 1, normal: 2 } as const;
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function onboardingAttentionItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!can(ctx, "onboarding:write")) return [];

  const now = new Date();
  const dueSoonAt = new Date(now.getTime() + boundedHours("HRBP_ONBOARDING_DUE_SOON_HOURS", 48) * 60 * 60 * 1000);
  const startRiskAt = new Date(now.getTime() + boundedHours("HRBP_ONBOARDING_START_RISK_HOURS", 72) * 60 * 60 * 1000);
  const scope = await resolveOnboardingPopulationScope(db, ctx);

  // Keep the exact same plan population, ordering and bound as the governed
  // onboarding operations console. Action Center must not discover a broader
  // record set than the owning workspace can render after a deep link.
  const plans = await db.onboardingPlan.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { status: { not: OnboardingStatus.COMPLETED } },
        { status: OnboardingStatus.COMPLETED, employment: { is: { status: EmploymentStatus.PREBOARDING } } }
      ],
      ...onboardingPlanPopulationFilter(scope)
    },
    orderBy: { targetStartDate: "asc" },
    take: 100,
    select: {
      id: true,
      ownerId: true,
      status: true,
      targetStartDate: true,
      createdAt: true,
      person: { select: { givenName: true, familyName: true } },
      employment: {
        select: {
          status: true,
          manager: { select: { person: { select: { workEmail: true } } } }
        }
      },
      _count: { select: { tasks: { where: { status: { in: OPEN_ONBOARDING_TASKS } } } } },
      tasks: {
        where: {
          status: { in: OPEN_ONBOARDING_TASKS },
          OR: [
            { status: OnboardingTaskStatus.BLOCKED },
            { dueDate: { not: null, lte: dueSoonAt } }
          ]
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: 100,
        select: { id: true, title: true, ownerType: true, status: true, dueDate: true, sensitive: true, createdAt: true }
      }
    }
  });

  const managerEmails = [...new Set(plans.flatMap((plan) => {
    const value = plan.employment?.manager?.person.workEmail?.trim().toLowerCase();
    return value ? [value] : [];
  }))];
  const managerUsers = managerEmails.length ? await db.userAccount.findMany({
    where: {
      tenantId: ctx.tenantId,
      active: true,
      OR: managerEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }))
    },
    take: 100,
    select: { id: true, email: true }
  }) : [];
  const managerByEmail = new Map(managerUsers.map((user) => [user.email.trim().toLowerCase(), user.id]));

  const items: ExpandedLifecycleActionItem[] = [];
  const plansWithActorTaskAttention = new Set<string>();

  for (const plan of plans) {
    const employeeName = `${plan.person.givenName} ${plan.person.familyName}`;
    const managerEmail = plan.employment?.manager?.person.workEmail?.trim().toLowerCase() ?? null;
    const managerUserId = managerEmail ? managerByEmail.get(managerEmail) ?? null : null;

    for (const task of plan.tasks) {
      const recipientId = task.ownerType.trim().toUpperCase() === "MANAGER"
        ? managerUserId ?? plan.ownerId
        : plan.ownerId;
      if (recipientId !== ctx.actorId) continue;

      plansWithActorTaskAttention.add(plan.id);
      const dueAt = task.dueDate ?? plan.targetStartDate;
      items.push({
        id: `onboarding:${task.id}`,
        // Keep the shared UI source contract stable: this is native lifecycle
        // attention rendered as deep-link-only workflow work, never a direct mutation.
        kind: "workflow",
        title: task.sensitive ? "Restricted onboarding task" : `Onboarding · ${task.title}`,
        subtitle: `${employeeName} · ${task.ownerType} owner`,
        module: "onboarding",
        href: `/module/onboarding?task=${encodeURIComponent(task.id)}`,
        subjectType: "OnboardingTask",
        subjectId: task.id,
        status: statusLabel(task.status),
        dueAt: dueAt.toISOString(),
        createdAt: task.createdAt.toISOString(),
        urgency: task.status === OnboardingTaskStatus.BLOCKED ? "critical" : urgencyForDate(task.dueDate, "warning"),
        action: null
      });
    }

    if (plan.ownerId !== ctx.actorId || plan.targetStartDate > startRiskAt) continue;

    if (plan.status === OnboardingStatus.COMPLETED && plan.employment?.status === EmploymentStatus.PREBOARDING) {
      items.push({
        id: `onboarding:activation:${plan.id}`,
        kind: "workflow",
        title: `Onboarding activation · ${employeeName}`,
        subtitle: "Readiness gate cleared · governed employment activation remains a human action",
        module: "onboarding",
        href: `/module/onboarding?plan=${encodeURIComponent(plan.id)}`,
        subjectType: "OnboardingPlan",
        subjectId: plan.id,
        status: "ready for activation",
        dueAt: plan.targetStartDate.toISOString(),
        createdAt: plan.createdAt.toISOString(),
        urgency: urgencyForDate(plan.targetStartDate, "warning"),
        action: null
      });
      continue;
    }

    if (plan.status !== OnboardingStatus.COMPLETED && plan._count.tasks > 0 && !plansWithActorTaskAttention.has(plan.id)) {
      items.push({
        id: `onboarding:start-risk:${plan.id}`,
        kind: "workflow",
        title: `Onboarding start readiness · ${employeeName}`,
        subtitle: `${plan._count.tasks} open onboarding control${plan._count.tasks === 1 ? "" : "s"} remain before target start`,
        module: "onboarding",
        href: `/module/onboarding?plan=${encodeURIComponent(plan.id)}`,
        subjectType: "OnboardingPlan",
        subjectId: plan.id,
        status: statusLabel(plan.status),
        dueAt: plan.targetStartDate.toISOString(),
        createdAt: plan.createdAt.toISOString(),
        urgency: urgencyForDate(plan.targetStartDate, "warning"),
        action: null
      });
    }
  }

  return items;
}

function fallbackRoleForExitDomain(domain: string) {
  const normalized = domain.trim().toUpperCase();
  if (normalized === "PAYROLL") return PlatformRole.PAYROLL_ADMIN;
  if (normalized === "LEGAL") return PlatformRole.LEGAL;
  return PlatformRole.HR_OPERATIONS;
}

async function offboardingAttentionItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!can(ctx, "offboarding:write")) return [];

  const now = new Date();
  const dueSoonAt = new Date(now.getTime() + boundedHours("HRBP_OFFBOARDING_DUE_SOON_HOURS", 48) * 60 * 60 * 1000);
  const exitRiskAt = new Date(now.getTime() + boundedHours("HRBP_OFFBOARDING_EXIT_RISK_HOURS", 72) * 60 * 60 * 1000);
  const scope = await resolveEmploymentScope(db, ctx);

  // Mirror the active process population and 150-row bound used by the owning
  // offboarding workspace so an Action Center deep link cannot widen scope.
  const processes = await db.separationProcess.findMany({
    where: { tenantId: ctx.tenantId, status: { in: OPEN_SEPARATIONS }, ...employmentIdFilter(scope) },
    orderBy: [{ lastWorkingDate: "asc" }, { createdAt: "desc" }],
    take: 150,
    select: {
      id: true,
      employmentId: true,
      initiatedById: true,
      status: true,
      lastWorkingDate: true,
      createdAt: true,
      finalSettlementStatus: true,
      _count: {
        select: {
          tasks: { where: { blocking: true, status: { notIn: TERMINAL_EXIT_TASKS } } },
          assets: { where: { status: { notIn: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF] } } },
          accessRevocations: { where: { status: { notIn: [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION] } } },
          knowledgeTransfers: { where: { status: { notIn: TERMINAL_EXIT_TASKS } } }
        }
      },
      tasks: {
        where: {
          status: { in: OPEN_EXIT_TASKS },
          OR: [
            { status: ExitTaskStatus.BLOCKED },
            { dueAt: { not: null, lte: dueSoonAt } }
          ]
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 100,
        select: { id: true, title: true, domain: true, ownerId: true, status: true, dueAt: true, blocking: true, createdAt: true }
      }
    }
  });

  const employmentIds = [...new Set(processes.map((process) => process.employmentId))];
  const employments = employmentIds.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentIds }, ...employmentIdFilter(scope) },
    take: 150,
    select: { id: true, person: { select: { givenName: true, familyName: true } } }
  }) : [];
  const names = new Map(employments.map((employment) => [employment.id, `${employment.person.givenName} ${employment.person.familyName}`]));

  const items: ExpandedLifecycleActionItem[] = [];
  const actorTaskProcesses = new Set<string>();

  for (const process of processes) {
    const employeeName = names.get(process.employmentId) ?? "Scoped employee";

    for (const task of process.tasks) {
      const accountable = task.ownerId ? task.ownerId === ctx.actorId : ctx.role === fallbackRoleForExitDomain(task.domain);
      if (!accountable) continue;
      actorTaskProcesses.add(process.id);
      const dueAt = task.dueAt ?? process.lastWorkingDate;
      items.push({
        id: `offboarding:${task.id}`,
        kind: "workflow",
        title: `Offboarding · ${task.title}`,
        subtitle: `${employeeName} · ${task.domain}${task.blocking ? " · blocking control" : ""}`,
        module: "offboarding",
        href: `/module/offboarding?task=${encodeURIComponent(task.id)}`,
        subjectType: "SeparationTask",
        subjectId: task.id,
        status: statusLabel(task.status),
        dueAt: dueAt.toISOString(),
        createdAt: task.createdAt.toISOString(),
        urgency: task.status === ExitTaskStatus.BLOCKED ? "critical" : urgencyForDate(task.dueAt, task.blocking ? "warning" : "normal"),
        action: null
      });
    }

    const openControls = process._count.tasks + process._count.assets + process._count.accessRevocations + process._count.knowledgeTransfers;
    const nonTaskControls = process._count.assets + process._count.accessRevocations + process._count.knowledgeTransfers;
    const settlementClear = process.finalSettlementStatus === "SETTLED";
    const controlsClear = openControls === 0;

    if (
      process.status === SeparationStatus.READY_TO_CLOSE &&
      process.lastWorkingDate <= now &&
      controlsClear &&
      settlementClear &&
      process.initiatedById !== ctx.actorId
    ) {
      items.push({
        id: `offboarding:close:${process.id}`,
        kind: "workflow",
        title: `Close separation · ${employeeName}`,
        subtitle: "Exit controls and final settlement are clear · independent closure required",
        module: "offboarding",
        href: `/module/offboarding?process=${encodeURIComponent(process.id)}`,
        subjectType: "SeparationProcess",
        subjectId: process.id,
        status: "ready to close",
        dueAt: process.lastWorkingDate.toISOString(),
        createdAt: process.createdAt.toISOString(),
        urgency: "critical",
        action: null
      });
      continue;
    }

    if (
      process.initiatedById === ctx.actorId &&
      process.status !== SeparationStatus.READY_TO_CLOSE &&
      process.lastWorkingDate <= exitRiskAt &&
      openControls > 0 &&
      (nonTaskControls > 0 || !actorTaskProcesses.has(process.id))
    ) {
      items.push({
        id: `offboarding:exit-risk:${process.id}`,
        kind: "workflow",
        title: `Exit readiness · ${employeeName}`,
        subtitle: `${process._count.tasks} blocking task${process._count.tasks === 1 ? "" : "s"} · ${process._count.assets} asset${process._count.assets === 1 ? "" : "s"} · ${process._count.accessRevocations} access control${process._count.accessRevocations === 1 ? "" : "s"} · ${process._count.knowledgeTransfers} handover${process._count.knowledgeTransfers === 1 ? "" : "s"}`,
        module: "offboarding",
        href: `/module/offboarding?process=${encodeURIComponent(process.id)}`,
        subjectType: "SeparationProcess",
        subjectId: process.id,
        status: statusLabel(process.status),
        dueAt: process.lastWorkingDate.toISOString(),
        createdAt: process.createdAt.toISOString(),
        urgency: urgencyForDate(process.lastWorkingDate, "warning"),
        action: null
      });
    }
  }

  return items;
}

async function settle(label: string, work: Promise<ExpandedLifecycleActionItem[]>) {
  try {
    return { items: await work, degraded: false };
  } catch (error) {
    console.error(`[HRBP] ${label} lifecycle attention aggregation failed; preserving the remaining governed Action Center.`, error);
    return { items: [] as ExpandedLifecycleActionItem[], degraded: true };
  }
}

export async function getLifecycleActionCenterFullContinuityData(ctx: RequestContext) {
  const base = await getLifecycleActionCenterContinuityData(ctx);
  const [onboarding, offboarding] = await Promise.all([
    settle("Onboarding", onboardingAttentionItems(ctx)),
    settle("Offboarding", offboardingAttentionItems(ctx))
  ]);

  const items = [...base.items, ...onboarding.items, ...offboarding.items].sort(sortItems).slice(0, 300);
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
      workflow: items.filter((item) => item.kind === "workflow").length,
      onboarding: items.filter((item) => item.module === "onboarding").length,
      offboarding: items.filter((item) => item.module === "offboarding").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    joinerLeaverDegraded: onboarding.degraded || offboarding.degraded,
    joinerLeaverSources: {
      onboardingDegraded: onboarding.degraded,
      offboardingDegraded: offboarding.degraded
    }
  };
}
