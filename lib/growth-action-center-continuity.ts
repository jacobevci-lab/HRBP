import { BenefitEnrollmentStatus, DevelopmentPlanStatus, LearningAssignmentStatus, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getLifecycleActionCenterData, type LifecycleActionItem, type LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

export type GrowthLifecycleActionKind = "benefits" | "performance" | "learning" | "development-plan" | "succession";
export type ExpandedLifecycleActionItem = LifecycleActionItem | (Omit<LifecycleActionItem, "kind"> & { kind: GrowthLifecycleActionKind });

function urgencyForDueDate(dueAt: Date | null, fallback: LifecycleActionUrgency = "normal", now = Date.now()): LifecycleActionUrgency {
  if (!dueAt) return fallback;
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return fallback === "critical" ? "critical" : "warning";
  return fallback;
}

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function boundedWarningDays(key: string, fallback: number) {
  return Math.min(90, Math.max(1, Math.floor(runtimeNumber(key, fallback))));
}

async function benefitsPendingItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!can(ctx, "benefits:write")) return [];
  const scope = await resolveEmploymentScope(db, ctx);
  const rows = await db.benefitEnrollment.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: BenefitEnrollmentStatus.PENDING,
      ...employmentIdFilter(scope)
    },
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      employmentId: true,
      status: true,
      effectiveFrom: true,
      createdAt: true,
      benefitPlan: { select: { code: true, name: true } }
    }
  });
  const employmentIds = [...new Set(rows.map((row) => row.employmentId))];
  const employments = employmentIds.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
    select: { id: true, person: { select: { givenName: true, familyName: true } } }
  }) : [];
  const names = new Map(employments.map((employment) => [employment.id, `${employment.person.givenName} ${employment.person.familyName}`]));

  return rows.map((enrollment): ExpandedLifecycleActionItem => ({
    id: `benefits:${enrollment.id}`,
    kind: "benefits",
    title: `Benefit election · ${names.get(enrollment.employmentId) ?? "Scoped employee"}`,
    subtitle: `${enrollment.benefitPlan.code} · ${enrollment.benefitPlan.name} · pending governance decision`,
    module: "benefits",
    href: `/module/benefits?enrollment=${encodeURIComponent(enrollment.id)}`,
    subjectType: "BenefitEnrollment",
    subjectId: enrollment.id,
    status: statusLabel(enrollment.status),
    dueAt: enrollment.effectiveFrom.toISOString(),
    createdAt: enrollment.createdAt.toISOString(),
    urgency: urgencyForDueDate(enrollment.effectiveFrom, "normal"),
    action: null
  }));
}

async function performanceParticipantItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!ctx.employmentId) return [];
  const selfEnabled = can(ctx, "performance:self-submit");
  const managerEnabled = can(ctx, "performance:manager-review");
  if (!selfEnabled && !managerEnabled) return [];

  const [selfReviews, managerReviews] = await Promise.all([
    selfEnabled ? db.performanceReview.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW] },
        cycle: { status: ReviewCycleStatus.OPEN }
      },
      orderBy: [{ cycle: { endsAt: "asc" } }, { updatedAt: "asc" }],
      take: 50,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        cycle: { select: { name: true, endsAt: true } }
      }
    }) : Promise.resolve([]),
    managerEnabled ? db.performanceReview.findMany({
      where: {
        tenantId: ctx.tenantId,
        managerEmploymentId: ctx.employmentId,
        status: ReviewStatus.MANAGER_REVIEW,
        cycle: { status: ReviewCycleStatus.OPEN }
      },
      orderBy: [{ cycle: { endsAt: "asc" } }, { updatedAt: "asc" }],
      take: 100,
      select: {
        id: true,
        employmentId: true,
        status: true,
        updatedAt: true,
        cycle: { select: { name: true, endsAt: true } }
      }
    }) : Promise.resolve([])
  ]);

  const employmentIds = [...new Set(managerReviews.map((review) => review.employmentId))];
  const employments = employmentIds.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
    select: { id: true, person: { select: { givenName: true, familyName: true } } }
  }) : [];
  const names = new Map(employments.map((employment) => [employment.id, `${employment.person.givenName} ${employment.person.familyName}`]));

  return [
    ...selfReviews.map((review): ExpandedLifecycleActionItem => ({
      id: `performance:self:${review.id}`,
      kind: "performance",
      title: `Self review · ${review.cycle.name}`,
      subtitle: "Your rating is required before manager review",
      module: "performance",
      href: `/module/performance?review=${encodeURIComponent(review.id)}`,
      subjectType: "PerformanceReview",
      subjectId: review.id,
      status: statusLabel(review.status),
      dueAt: review.cycle.endsAt.toISOString(),
      createdAt: review.updatedAt.toISOString(),
      urgency: urgencyForDueDate(review.cycle.endsAt, "warning"),
      action: null
    })),
    ...managerReviews.map((review): ExpandedLifecycleActionItem => ({
      id: `performance:manager:${review.id}`,
      kind: "performance",
      title: `Manager review · ${names.get(review.employmentId) ?? "Assigned employee"}`,
      subtitle: `${review.cycle.name} · assigned manager decision required`,
      module: "performance",
      href: `/module/performance?review=${encodeURIComponent(review.id)}`,
      subjectType: "PerformanceReview",
      subjectId: review.id,
      status: statusLabel(review.status),
      dueAt: review.cycle.endsAt.toISOString(),
      createdAt: review.updatedAt.toISOString(),
      urgency: urgencyForDueDate(review.cycle.endsAt, "warning"),
      action: null
    }))
  ];
}

async function learningParticipantItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!ctx.employmentId || !can(ctx, "learning:self-progress")) return [];

  const rows = await db.learningAssignment.findMany({
    where: {
      tenantId: ctx.tenantId,
      employmentId: ctx.employmentId,
      status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] }
    },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      dueAt: true,
      assignedAt: true,
      course: { select: { code: true, title: true, mandatory: true } }
    }
  });

  return rows.map((assignment): ExpandedLifecycleActionItem => ({
    id: `learning:${assignment.id}`,
    kind: "learning",
    title: assignment.course.title,
    subtitle: `${assignment.course.code} · ${assignment.course.mandatory ? "mandatory learning" : "development learning"}`,
    module: "learning",
    href: `/module/learning?assignment=${encodeURIComponent(assignment.id)}`,
    subjectType: "LearningAssignment",
    subjectId: assignment.id,
    status: statusLabel(assignment.status),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    createdAt: assignment.assignedAt.toISOString(),
    urgency: assignment.status === LearningAssignmentStatus.OVERDUE
      ? "critical"
      : urgencyForDueDate(assignment.dueAt, assignment.course.mandatory ? "warning" : "normal"),
    action: null
  }));
}

async function developmentPlanOwnerItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!can(ctx, "talent:write")) return [];
  const warningDays = boundedWarningDays("HRBP_DEVELOPMENT_PLAN_WARNING_DAYS", 30);
  const horizon = new Date(Date.now() + warningDays * 86_400_000);
  const rows = await db.developmentPlan.findMany({
    where: {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      status: DevelopmentPlanStatus.ACTIVE,
      targetAt: { lte: horizon }
    },
    orderBy: [{ targetAt: "asc" }, { updatedAt: "asc" }],
    take: 100,
    select: { id: true, title: true, status: true, targetAt: true, updatedAt: true }
  });

  return rows.map((plan): ExpandedLifecycleActionItem => ({
    id: `development-plan:${plan.id}`,
    kind: "development-plan",
    title: plan.title,
    subtitle: "Development outcome / human reassessment review",
    module: "talent",
    href: `/module/talent?developmentPlan=${encodeURIComponent(plan.id)}`,
    subjectType: "DevelopmentPlan",
    subjectId: plan.id,
    status: statusLabel(plan.status),
    dueAt: plan.targetAt.toISOString(),
    createdAt: plan.updatedAt.toISOString(),
    urgency: urgencyForDueDate(plan.targetAt, "warning"),
    action: null
  }));
}

async function successionPlanOwnerItems(ctx: RequestContext): Promise<ExpandedLifecycleActionItem[]> {
  if (!can(ctx, "succession:write")) return [];
  const warningDays = boundedWarningDays("HRBP_SUCCESSION_REVIEW_WARNING_DAYS", 30);
  const horizon = new Date(Date.now() + warningDays * 86_400_000);
  const plans = await db.successionPlan.findMany({
    where: {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      active: true,
      reviewDueAt: { not: null, lte: horizon }
    },
    orderBy: [{ reviewDueAt: "asc" }, { updatedAt: "asc" }],
    take: 100,
    select: { id: true, name: true, positionId: true, reviewDueAt: true, updatedAt: true }
  });

  const positionIds = [...new Set(plans.map((plan) => plan.positionId))];
  const positions = positionIds.length ? await db.position.findMany({
    where: { tenantId: ctx.tenantId, id: { in: positionIds } },
    select: { id: true, positionCode: true, title: true }
  }) : [];
  const positionMap = new Map(positions.map((position) => [position.id, position]));

  return plans.flatMap((plan): ExpandedLifecycleActionItem[] => {
    if (!plan.reviewDueAt) return [];
    const position = positionMap.get(plan.positionId);
    const title = plan.name?.trim() || position?.title || "Succession plan";
    const code = position?.positionCode ? `${position.positionCode} · ` : "";
    return [{
      id: `succession:${plan.id}`,
      kind: "succession",
      title: `Succession review · ${title}`,
      subtitle: `${code}human readiness review owned by you`,
      module: "succession",
      href: `/module/succession?plan=${encodeURIComponent(plan.id)}`,
      subjectType: "SuccessionPlan",
      subjectId: plan.id,
      status: "active",
      dueAt: plan.reviewDueAt.toISOString(),
      createdAt: plan.updatedAt.toISOString(),
      urgency: urgencyForDueDate(plan.reviewDueAt, "warning"),
      action: null
    }];
  });
}

function sortItems(left: ExpandedLifecycleActionItem, right: ExpandedLifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

export async function getLifecycleActionCenterContinuityData(ctx: RequestContext) {
  const base = await getLifecycleActionCenterData(ctx);
  let growth: ExpandedLifecycleActionItem[] = [];
  let growthDegraded = false;

  try {
    const [benefits, performance, learning, developmentPlans, succession] = await Promise.all([
      benefitsPendingItems(ctx),
      performanceParticipantItems(ctx),
      learningParticipantItems(ctx),
      developmentPlanOwnerItems(ctx),
      successionPlanOwnerItems(ctx)
    ]);
    growth = [...benefits, ...performance, ...learning, ...developmentPlans, ...succession];
  } catch (error) {
    growthDegraded = true;
    console.error("[HRBP] Growth lifecycle action aggregation failed; preserving the governed core Action Center.", error);
  }

  const items: ExpandedLifecycleActionItem[] = [...base.items, ...growth].sort(sortItems).slice(0, 300);
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
      benefits: items.filter((item) => item.kind === "benefits").length,
      performance: items.filter((item) => item.kind === "performance").length,
      learning: items.filter((item) => item.kind === "learning").length,
      developmentPlans: items.filter((item) => item.kind === "development-plan").length,
      succession: items.filter((item) => item.kind === "succession").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded
  };
}
