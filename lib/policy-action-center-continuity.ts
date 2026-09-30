import { PolicyAssignmentStatus, PolicyStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  getRecruitingLifecycleActionCenterData,
  type CompleteLifecycleActionItem,
} from "@/lib/recruiting-action-center-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type PolicyLifecycleAttentionItem = Omit<CompleteLifecycleActionItem, "kind"> & {
  kind: "policies";
};

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function urgencyForDueDate(dueAt: Date | null, now = Date.now()): LifecycleActionUrgency {
  if (!dueAt) return "warning";
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return "warning";
  return "normal";
}

function sortItems(left: CompleteLifecycleActionItem | PolicyLifecycleAttentionItem, right: CompleteLifecycleActionItem | PolicyLifecycleAttentionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function policyReviewItems(ctx: RequestContext): Promise<PolicyLifecycleAttentionItem[]> {
  if (!can(ctx, "policies:approve")) return [];

  const policies = await db.policyRecord.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: PolicyStatus.REVIEW,
      ownerId: { not: ctx.actorId }
    },
    orderBy: [{ reviewDueAt: "asc" }, { updatedAt: "asc" }],
    take: 100,
    select: {
      id: true,
      code: true,
      title: true,
      version: true,
      status: true,
      ownerId: true,
      reviewDueAt: true,
      updatedAt: true
    }
  });

  return policies.map((policy) => ({
    id: `policies:review:${policy.id}`,
    kind: "policies",
    title: `Policy review · ${policy.code}`,
    subtitle: `${policy.title} · v${policy.version}`,
    module: "policies",
    href: `/module/policies?policy=${encodeURIComponent(policy.id)}&mode=review`,
    subjectType: "PolicyRecord",
    subjectId: policy.id,
    status: statusLabel(policy.status),
    dueAt: policy.reviewDueAt?.toISOString() ?? null,
    createdAt: policy.updatedAt.toISOString(),
    urgency: urgencyForDueDate(policy.reviewDueAt),
    action: null
  }));
}

async function policyAcknowledgementItems(ctx: RequestContext): Promise<PolicyLifecycleAttentionItem[]> {
  if (!can(ctx, "policies:acknowledge") || !ctx.employmentId) return [];

  const assignments = await db.policyAssignment.findMany({
    where: {
      tenantId: ctx.tenantId,
      employmentId: ctx.employmentId,
      status: { in: [PolicyAssignmentStatus.PENDING, PolicyAssignmentStatus.OVERDUE] },
      policy: { is: { tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED } }
    },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      dueAt: true,
      assignedAt: true,
      policy: {
        select: {
          id: true,
          code: true,
          title: true,
          version: true
        }
      }
    }
  });

  return assignments.map((assignment) => ({
    id: `policies:acknowledgement:${assignment.id}`,
    kind: "policies",
    title: `Policy acknowledgement · ${assignment.policy.code}`,
    subtitle: `${assignment.policy.title} · v${assignment.policy.version}`,
    module: "policies",
    href: `/module/policies?policy=${encodeURIComponent(assignment.policy.id)}&mode=acknowledge`,
    subjectType: "PolicyAssignment",
    subjectId: assignment.id,
    status: statusLabel(assignment.status),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    createdAt: assignment.assignedAt.toISOString(),
    urgency: urgencyForDueDate(assignment.dueAt),
    action: null
  }));
}

export async function getPolicyLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getRecruitingLifecycleActionCenterData(ctx);
  let policyItems: PolicyLifecycleAttentionItem[] = [];
  let policyDegraded = false;

  try {
    const [reviewItems, acknowledgementItems] = await Promise.all([
      policyReviewItems(ctx),
      policyAcknowledgementItems(ctx)
    ]);
    policyItems = [...reviewItems, ...acknowledgementItems];
  } catch (error) {
    policyDegraded = true;
    console.error("[HRBP] Policy lifecycle attention failed; preserving the governed Action Center.", error);
  }

  const items = [...base.items, ...policyItems].sort(sortItems).slice(0, 400);
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
      policies: items.filter((item) => item.kind === "policies").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded: base.recruitingDegraded,
    policyDegraded
  };
}
