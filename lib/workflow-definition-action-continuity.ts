import { WorkflowDefinitionStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  getEngagementLifecycleActionCenterData,
  type EngagementLifecycleAttentionItem
} from "@/lib/engagement-action-center-continuity";
import type { CompleteLifecycleActionItem } from "@/lib/recruiting-action-center-continuity";
import type { PolicyLifecycleAttentionItem } from "@/lib/policy-action-center-continuity";
import type { WorkforcePlanningLifecycleAttentionItem } from "@/lib/workforce-planning-action-center-continuity";
import type { PrivacyLifecycleAttentionItem } from "@/lib/privacy-action-center-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type WorkflowDefinitionAttentionItem = Omit<EngagementLifecycleAttentionItem, "kind"> & {
  kind: "workflow";
};

type WorkflowTopLevelItem =
  | CompleteLifecycleActionItem
  | PolicyLifecycleAttentionItem
  | WorkforcePlanningLifecycleAttentionItem
  | PrivacyLifecycleAttentionItem
  | EngagementLifecycleAttentionItem
  | WorkflowDefinitionAttentionItem;

function sortItems(left: WorkflowTopLevelItem, right: WorkflowTopLevelItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function workflowDefinitionApprovalItems(ctx: RequestContext): Promise<WorkflowDefinitionAttentionItem[]> {
  if (!can(ctx, "workflows:approve")) return [];

  const definitions = await db.workflowDefinition.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: WorkflowDefinitionStatus.DRAFT,
      createdById: { not: ctx.actorId }
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: {
      id: true,
      key: true,
      name: true,
      version: true,
      status: true,
      updatedAt: true
    }
  });

  return definitions.map((definition) => ({
    id: `workflow:definition:${definition.id}`,
    kind: "workflow",
    title: `Workflow activation · ${definition.name}`,
    subtitle: `${definition.key} · v${definition.version}`,
    module: "workflows",
    href: `/module/workflows?definition=${encodeURIComponent(definition.id)}&mode=governance`,
    subjectType: "WorkflowDefinition",
    subjectId: definition.id,
    status: definition.status.toLowerCase(),
    dueAt: null,
    createdAt: definition.updatedAt.toISOString(),
    urgency: "warning",
    action: null
  }));
}

export async function getWorkflowDefinitionLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getEngagementLifecycleActionCenterData(ctx);
  let definitionItems: WorkflowDefinitionAttentionItem[] = [];
  let workflowDefinitionDegraded = false;

  try {
    definitionItems = await workflowDefinitionApprovalItems(ctx);
  } catch (error) {
    workflowDefinitionDegraded = true;
    console.error("[HRBP] Workflow definition attention failed; preserving the governed Action Center.", error);
  }

  const items: WorkflowTopLevelItem[] = [...base.items, ...definitionItems].sort(sortItems).slice(0, 600);
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
      workflow: items.filter((item) => item.kind === "workflow").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded: base.recruitingDegraded,
    policyDegraded: base.policyDegraded,
    workforcePlanningDegraded: base.workforcePlanningDegraded,
    privacyDegraded: base.privacyDegraded,
    engagementDegraded: base.engagementDegraded,
    workflowDefinitionDegraded
  };
}
