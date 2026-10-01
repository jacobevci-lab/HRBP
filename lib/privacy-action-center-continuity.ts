import { DSRStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  getWorkforcePlanningLifecycleActionCenterData,
  type WorkforcePlanningLifecycleAttentionItem
} from "@/lib/workforce-planning-action-center-continuity";
import type { CompleteLifecycleActionItem } from "@/lib/recruiting-action-center-continuity";
import type { PolicyLifecycleAttentionItem } from "@/lib/policy-action-center-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type PrivacyLifecycleAttentionItem = Omit<WorkforcePlanningLifecycleAttentionItem, "kind"> & {
  kind: "privacy";
};

type PrivacyTopLevelItem =
  | CompleteLifecycleActionItem
  | PolicyLifecycleAttentionItem
  | WorkforcePlanningLifecycleAttentionItem
  | PrivacyLifecycleAttentionItem;

const openStatuses = [
  DSRStatus.RECEIVED,
  DSRStatus.IDENTITY_VERIFICATION,
  DSRStatus.IN_PROGRESS,
  DSRStatus.WAITING
];

function urgencyForDueDate(dueAt: Date, now = Date.now()): LifecycleActionUrgency {
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 7 * 24 * 60 * 60 * 1000) return "warning";
  return "normal";
}

function sortItems(left: PrivacyTopLevelItem, right: PrivacyTopLevelItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function privacyDsrItems(ctx: RequestContext): Promise<PrivacyLifecycleAttentionItem[]> {
  if (!can(ctx, "privacy:write")) return [];

  const dsrs = await db.dataSubjectRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      status: { in: openStatuses }
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      requestNumber: true,
      type: true,
      status: true,
      dueAt: true,
      createdAt: true
    }
  });

  return dsrs.map((dsr) => ({
    id: `privacy:dsr:${dsr.id}`,
    kind: "privacy",
    title: `DSR action · ${dsr.requestNumber}`,
    subtitle: dsr.type.toLowerCase().replace(/_/g, " "),
    module: "privacy",
    href: `/module/privacy?dsr=${encodeURIComponent(dsr.id)}&mode=work`,
    subjectType: "DataSubjectRequest",
    subjectId: dsr.id,
    status: dsr.status.toLowerCase().replace(/_/g, " "),
    dueAt: dsr.dueAt.toISOString(),
    createdAt: dsr.createdAt.toISOString(),
    urgency: urgencyForDueDate(dsr.dueAt),
    action: dsr.status === DSRStatus.RECEIVED
      ? { type: "begin-dsr-verification", dsrId: dsr.id }
      : dsr.status === DSRStatus.IDENTITY_VERIFICATION
        ? { type: "verify-dsr", dsrId: dsr.id }
        : dsr.status === DSRStatus.IN_PROGRESS
          ? { type: "wait-dsr", dsrId: dsr.id }
          : { type: "resume-dsr", dsrId: dsr.id }
  }));
}

async function privacyAssuranceItems(ctx: RequestContext): Promise<PrivacyLifecycleAttentionItem[]> {
  if (!can(ctx, "privacy:write")) return [];

  const now = new Date();
  const assuranceHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [assessments, transfers] = await Promise.all([
    db.privacyRiskAssessment.findMany({
      where: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actorId,
        completedAt: null,
        status: { notIn: ["COMPLETED", "CLOSED"] },
        dueAt: { not: null, lte: assuranceHorizon }
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        riskLevel: true,
        requiresDpia: true,
        status: true,
        dueAt: true,
        createdAt: true
      }
    }),
    db.dataTransferRegister.findMany({
      where: {
        tenantId: ctx.tenantId,
        active: true,
        transferImpactDueAt: { not: null, lte: assuranceHorizon }
      },
      orderBy: [{ transferImpactDueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        destinationCountry: true,
        mechanism: true,
        transferImpactDueAt: true,
        createdAt: true
      }
    })
  ]);

  const assessmentItems: PrivacyLifecycleAttentionItem[] = assessments.map((assessment) => ({
    id: `privacy:assessment:${assessment.id}`,
    kind: "privacy",
    title: `${assessment.requiresDpia ? "DPIA" : "Privacy assessment"} · ${assessment.name}`,
    subtitle: `${assessment.riskLevel} risk · ${assessment.status}`,
    module: "privacy",
    href: `/module/privacy?assessment=${encodeURIComponent(assessment.id)}&mode=assessment`,
    subjectType: "PrivacyRiskAssessment",
    subjectId: assessment.id,
    status: assessment.status.toLowerCase().replace(/_/g, " "),
    dueAt: assessment.dueAt?.toISOString() ?? null,
    createdAt: assessment.createdAt.toISOString(),
    urgency: assessment.dueAt ? urgencyForDueDate(assessment.dueAt) : "normal",
    action: assessment.status.toUpperCase() === "WAITING"
      ? { type: "resume-privacy-assessment", assessmentId: assessment.id }
      : assessment.status.toUpperCase() === "IN_PROGRESS"
        ? { type: "wait-privacy-assessment", assessmentId: assessment.id }
        : { type: "start-privacy-assessment", assessmentId: assessment.id }
  }));

  const transferItems: PrivacyLifecycleAttentionItem[] = transfers.map((transfer) => ({
      id: `privacy:transfer:${transfer.id}`,
      kind: "privacy",
      title: `Transfer impact review · ${transfer.name}`,
      subtitle: `${transfer.destinationCountry} · ${transfer.mechanism.toLowerCase().replace(/_/g, " ")}`,
      module: "privacy",
      href: `/module/privacy?transfer=${encodeURIComponent(transfer.id)}&mode=transfer`,
      subjectType: "DataTransferRegister",
      subjectId: transfer.id,
      status: "active",
      dueAt: transfer.transferImpactDueAt?.toISOString() ?? null,
      createdAt: transfer.createdAt.toISOString(),
      urgency: transfer.transferImpactDueAt ? urgencyForDueDate(transfer.transferImpactDueAt) : "normal",
      action: null
    }));

  return [...assessmentItems, ...transferItems];
}

export async function getPrivacyLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getWorkforcePlanningLifecycleActionCenterData(ctx);
  let privacyItems: PrivacyLifecycleAttentionItem[] = [];
  let privacyDegraded = false;

  try {
    const [dsrItems, assuranceItems] = await Promise.all([
      privacyDsrItems(ctx),
      privacyAssuranceItems(ctx)
    ]);
    privacyItems = [...dsrItems, ...assuranceItems];
  } catch (error) {
    privacyDegraded = true;
    console.error("[HRBP] Privacy attention failed; preserving the governed Action Center.", error);
  }

  const items: PrivacyTopLevelItem[] = [...base.items, ...privacyItems].sort(sortItems).slice(0, 500);
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
      privacy: items.filter((item) => item.kind === "privacy").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded: base.recruitingDegraded,
    policyDegraded: base.policyDegraded,
    workforcePlanningDegraded: base.workforcePlanningDegraded,
    privacyDegraded
  };
}
