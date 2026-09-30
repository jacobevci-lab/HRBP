import { PolicyAssignmentStatus, PolicyExceptionStatus, PolicyStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import {
  getRecruitingLifecycleActionCenterData,
  type CompleteLifecycleActionItem,
} from "@/lib/recruiting-action-center-continuity";
import type { RequestContext } from "@/lib/request-context";

export type PolicyLifecycleAttentionItem = Omit<CompleteLifecycleActionItem, "kind"> & {
  kind: "policies";
};
export type GovernedLifecycleActionItem = CompleteLifecycleActionItem | PolicyLifecycleAttentionItem;

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function dueUrgency(dueAt: Date | null, fallback: LifecycleActionUrgency = "normal", now = Date.now()): LifecycleActionUrgency {
  if (!dueAt) return fallback;
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return fallback === "critical" ? "critical" : "warning";
  return fallback;
}

function sortItems(left: GovernedLifecycleActionItem, right: GovernedLifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function policyAttentionItems(ctx: RequestContext): Promise<PolicyLifecycleAttentionItem[]> {
  if (!can(ctx, "policies:read")) return [];

  const canApprove = can(ctx, "policies:approve");
  const canAcknowledge = can(ctx, "policies:acknowledge") && Boolean(ctx.employmentId);
  if (!canApprove && !canAcknowledge) return [];

  const now = new Date();
  const [reviews, exceptions, assignments] = await Promise.all([
    canApprove ? db.policyRecord.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: PolicyStatus.REVIEW,
        ownerId: { not: ctx.actorId }
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
      select: { id: true, code: true, title: true, version: true, status: true, updatedAt: true }
    }) : Promise.resolve([]),
    canApprove ? db.policyException.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: PolicyExceptionStatus.REQUESTED,
        requestedById: { not: ctx.actorId }
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        policyId: true,
        status: true,
        requestedById: true,
        expiresAt: true,
        createdAt: true,
        policy: { select: { code: true, title: true, version: true } }
      }
    }) : Promise.resolve([]),
    canAcknowledge ? db.policyAssignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId!,
        status: { in: [PolicyAssignmentStatus.PENDING, PolicyAssignmentStatus.OVERDUE] },
        policy: {
          status: PolicyStatus.PUBLISHED,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
        }
      },
      orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }],
      take: 100,
      select: {
        id: true,
        policyId: true,
        status: true,
        dueAt: true,
        assignedAt: true,
        policy: { select: { code: true, title: true, version: true } }
      }
    }) : Promise.resolve([])
  ]);

  return [
    ...reviews.map((policy): PolicyLifecycleAttentionItem => ({
      id: `policies:review:${policy.id}`,
      kind: "policies",
      title: `Policy approval · ${policy.code}`,
      subtitle: `${policy.title} · v${policy.version}`,
      module: "policies",
      href: `/module/policies?policy=${encodeURIComponent(policy.id)}`,
      subjectType: "PolicyRecord",
      subjectId: policy.id,
      status: statusLabel(policy.status),
      dueAt: null,
      createdAt: policy.updatedAt.toISOString(),
      urgency: "warning",
      action: null
    })),
    ...exceptions.map((exception): PolicyLifecycleAttentionItem => ({
      id: `policies:exception:${exception.id}`,
      kind: "policies",
      title: `Policy exception decision · ${exception.policy.code}`,
      subtitle: `${exception.policy.title} · v${exception.policy.version} · independent decision required`,
      module: "policies",
      href: `/module/policies?policy=${encodeURIComponent(exception.policyId)}&exception=${encodeURIComponent(exception.id)}`,
      subjectType: "PolicyException",
      subjectId: exception.id,
      status: statusLabel(exception.status),
      dueAt: exception.expiresAt?.toISOString() ?? null,
      createdAt: exception.createdAt.toISOString(),
      urgency: dueUrgency(exception.expiresAt, "warning"),
      action: null
    })),
    ...assignments.map((assignment): PolicyLifecycleAttentionItem => ({
      id: `policies:acknowledgement:${assignment.id}`,
      kind: "policies",
      title: `Policy acknowledgement · ${assignment.policy.code}`,
      subtitle: `${assignment.policy.title} · v${assignment.policy.version}`,
      module: "policies",
      href: `/module/policies?policy=${encodeURIComponent(assignment.policyId)}`,
      subjectType: "PolicyAssignment",
      subjectId: assignment.id,
      status: statusLabel(assignment.status),
      dueAt: assignment.dueAt?.toISOString() ?? null,
      createdAt: assignment.assignedAt.toISOString(),
      urgency: dueUrgency(assignment.dueAt, assignment.status === PolicyAssignmentStatus.OVERDUE ? "critical" : "normal"),
      action: null
    }))
  ];
}

export async function getPolicyLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getRecruitingLifecycleActionCenterData(ctx);
  let policyItems: PolicyLifecycleAttentionItem[] = [];
  let policyDegraded = false;

  try {
    policyItems = await policyAttentionItems(ctx);
  } catch (error) {
    policyDegraded = true;
    console.error("[HRBP] Policy governance attention failed; preserving the governed Action Center.", error);
  }

  const items: GovernedLifecycleActionItem[] = [...base.items, ...policyItems].sort(sortItems).slice(0, 400);
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
