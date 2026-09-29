import { LearningAssignmentStatus, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getLifecycleActionCenterData, type LifecycleActionItem, type LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type GrowthLifecycleActionKind = "performance" | "learning";
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
        status: true,
        updatedAt: true,
        cycle: { select: { name: true, endsAt: true } },
        employment: { select: { person: { select: { givenName: true, familyName: true } } } }
      }
    }) : Promise.resolve([])
  ]);

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
      title: `Manager review · ${review.employment.person.givenName} ${review.employment.person.familyName}`,
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
    const [performance, learning] = await Promise.all([
      performanceParticipantItems(ctx),
      learningParticipantItems(ctx)
    ]);
    growth = [...performance, ...learning];
  } catch (error) {
    growthDegraded = true;
    console.error("[HRBP] Growth participant action aggregation failed; preserving the governed core Action Center.", error);
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
      performance: items.filter((item) => item.kind === "performance").length,
      learning: items.filter((item) => item.kind === "learning").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded
  };
}
