import { EmploymentStatus, WorkforceScenarioStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import {
  getPolicyLifecycleActionCenterData,
  type PolicyLifecycleAttentionItem
} from "@/lib/policy-action-center-continuity";
import type { CompleteLifecycleActionItem } from "@/lib/recruiting-action-center-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type WorkforcePlanningLifecycleAttentionItem = Omit<PolicyLifecycleAttentionItem, "kind"> & {
  kind: "workforce-planning";
};

type TopLevelLifecycleItem =
  | CompleteLifecycleActionItem
  | PolicyLifecycleAttentionItem
  | WorkforcePlanningLifecycleAttentionItem;

function sortItems(left: TopLevelLifecycleItem, right: TopLevelLifecycleItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function workforcePlanningReviewItems(ctx: RequestContext): Promise<WorkforcePlanningLifecycleAttentionItem[]> {
  if (!can(ctx, "workforce-plan:approve")) return [];

  const scope = await resolveEmploymentScope(db, ctx);
  let scopedScenarioWhere = {};
  if (scope !== null) {
    const employments = scope.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } },
      select: { positionId: true, position: { select: { orgUnitId: true } } }
    }) : [];
    const orgUnitIds = [...new Set(employments.flatMap((row) => row.position?.orgUnitId ? [row.position.orgUnitId] : []))];
    const positionIds = [...new Set(employments.flatMap((row) => row.positionId ? [row.positionId] : []))];
    const selectors = [
      ...(orgUnitIds.length ? [{ orgUnitId: { in: orgUnitIds } }] : []),
      ...(positionIds.length ? [{ positionId: { in: positionIds } }] : [])
    ];
    scopedScenarioWhere = selectors.length ? { lines: { some: { OR: selectors } } } : { id: "__no_authorized_scenario__" };
  }

  const scenarios = await db.workforceScenario.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: WorkforceScenarioStatus.REVIEW,
      ownerId: { not: ctx.actorId },
      ...scopedScenarioWhere
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      baseDate: true,
      ownerId: true,
      updatedAt: true
    }
  });

  return scenarios.map((scenario) => ({
    id: `workforce-planning:review:${scenario.id}`,
    kind: "workforce-planning",
    title: `Workforce plan review · ${scenario.code}`,
    subtitle: scenario.name,
    module: "workforce-planning",
    href: `/module/workforce-planning?scenario=${encodeURIComponent(scenario.id)}&mode=review`,
    subjectType: "WorkforceScenario",
    subjectId: scenario.id,
    status: scenario.status.toLowerCase(),
    dueAt: null,
    createdAt: scenario.updatedAt.toISOString(),
    urgency: "warning",
    action: null
  }));
}

export async function getWorkforcePlanningLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getPolicyLifecycleActionCenterData(ctx);
  let planningItems: WorkforcePlanningLifecycleAttentionItem[] = [];
  let workforcePlanningDegraded = false;

  try {
    planningItems = await workforcePlanningReviewItems(ctx);
  } catch (error) {
    workforcePlanningDegraded = true;
    console.error("[HRBP] Workforce Planning attention failed; preserving the governed Action Center.", error);
  }

  const items: TopLevelLifecycleItem[] = [...base.items, ...planningItems].sort(sortItems).slice(0, 450);
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
      workforcePlanning: items.filter((item) => item.kind === "workforce-planning").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded: base.recruitingDegraded,
    policyDegraded: base.policyDegraded,
    workforcePlanningDegraded
  };
}
