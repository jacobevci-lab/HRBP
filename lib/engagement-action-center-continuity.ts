import { SurveyStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  getPrivacyLifecycleActionCenterData,
  type PrivacyLifecycleAttentionItem
} from "@/lib/privacy-action-center-continuity";
import type { CompleteLifecycleActionItem } from "@/lib/recruiting-action-center-continuity";
import type { PolicyLifecycleAttentionItem } from "@/lib/policy-action-center-continuity";
import type { WorkforcePlanningLifecycleAttentionItem } from "@/lib/workforce-planning-action-center-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type EngagementLifecycleAttentionItem = Omit<PrivacyLifecycleAttentionItem, "kind"> & {
  kind: "engagement";
};

type EngagementTopLevelItem =
  | CompleteLifecycleActionItem
  | PolicyLifecycleAttentionItem
  | WorkforcePlanningLifecycleAttentionItem
  | PrivacyLifecycleAttentionItem
  | EngagementLifecycleAttentionItem;

function urgencyForDate(value: Date | null, now = Date.now()): LifecycleActionUrgency {
  if (!value) return "normal";
  const due = value.getTime();
  if (due <= now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return "warning";
  return "normal";
}

function sortItems(left: EngagementTopLevelItem, right: EngagementTopLevelItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function engagementCampaignItems(ctx: RequestContext): Promise<EngagementLifecycleAttentionItem[]> {
  if (!can(ctx, "engagement:write")) return [];

  const campaigns = await db.surveyCampaign.findMany({
    where: {
      tenantId: ctx.tenantId,
      createdById: ctx.actorId,
      status: { in: [SurveyStatus.SCHEDULED, SurveyStatus.OPEN] }
    },
    orderBy: [{ opensAt: "asc" }, { closesAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      opensAt: true,
      closesAt: true,
      createdAt: true
    }
  });

  return campaigns.map((campaign) => {
    const dueAt = campaign.status === SurveyStatus.SCHEDULED ? campaign.opensAt : campaign.closesAt;
    const verb = campaign.status === SurveyStatus.SCHEDULED ? "Open" : "Close";
    return {
      id: `engagement:campaign:${campaign.id}`,
      kind: "engagement" as const,
      title: `Campaign ${verb.toLowerCase()} · ${campaign.name}`,
      subtitle: campaign.status === SurveyStatus.SCHEDULED ? "Scheduled campaign opening" : "Open campaign closing",
      module: "engagement",
      href: `/module/engagement?campaign=${encodeURIComponent(campaign.id)}&mode=work`,
      subjectType: "SurveyCampaign",
      subjectId: campaign.id,
      status: campaign.status.toLowerCase(),
      dueAt: dueAt?.toISOString() ?? null,
      createdAt: campaign.createdAt.toISOString(),
      urgency: urgencyForDate(dueAt),
      action: null
    };
  });
}

export async function getEngagementLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getPrivacyLifecycleActionCenterData(ctx);
  let engagementItems: EngagementLifecycleAttentionItem[] = [];
  let engagementDegraded = false;

  try {
    engagementItems = await engagementCampaignItems(ctx);
  } catch (error) {
    engagementDegraded = true;
    console.error("[HRBP] Engagement campaign attention failed; preserving the governed Action Center.", error);
  }

  const items: EngagementTopLevelItem[] = [...base.items, ...engagementItems].sort(sortItems).slice(0, 550);
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
      engagement: items.filter((item) => item.kind === "engagement").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded: base.recruitingDegraded,
    policyDegraded: base.policyDegraded,
    workforcePlanningDegraded: base.workforcePlanningDegraded,
    privacyDegraded: base.privacyDegraded,
    engagementDegraded
  };
}
