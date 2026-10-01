import { OfferStatus, RequisitionStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  getDocumentSignatureLifecycleActionCenterData,
} from "@/lib/document-signature-action-continuity";
import type { FullLifecycleActionItem } from "@/lib/employee-lifecycle-action-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

export type RecruitingLifecycleAttentionItem = Omit<FullLifecycleActionItem, "kind"> & {
  kind: "recruiting";
};
export type CompleteLifecycleActionItem = FullLifecycleActionItem | RecruitingLifecycleAttentionItem;

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function offerUrgency(expiresAt: Date | null, now = Date.now()): LifecycleActionUrgency {
  if (!expiresAt) return "warning";
  const due = expiresAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return "warning";
  return "warning";
}

function sortItems(left: CompleteLifecycleActionItem, right: CompleteLifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function recruitingApprovalItems(ctx: RequestContext): Promise<RecruitingLifecycleAttentionItem[]> {
  if (!can(ctx, "recruiting:write") || !can(ctx, "recruiting:approve")) return [];

  const [requisitions, offers] = await Promise.all([
    db.requisition.findMany({
      where: { tenantId: ctx.tenantId, status: RequisitionStatus.APPROVAL },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        title: true,
        openings: true,
        status: true,
        createdAt: true,
        position: { select: { positionCode: true, title: true } }
      }
    }),
    db.offer.findMany({
      where: { tenantId: ctx.tenantId, status: OfferStatus.APPROVAL },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        startDate: true,
        expiresAt: true,
        createdAt: true,
        application: {
          select: {
            candidate: { select: { givenName: true, familyName: true } },
            requisition: { select: { title: true } }
          }
        }
      }
    })
  ]);

  const requisitionIds = requisitions.map((row) => row.id);
  const offerIds = offers.map((row) => row.id);
  if (!requisitionIds.length && !offerIds.length) return [];

  const audits = await db.auditEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        ...(requisitionIds.length ? [{ resourceType: "Requisition", resourceId: { in: requisitionIds }, action: "REQUISITION_CREATED" }] : []),
        ...(offerIds.length ? [{ resourceType: "Offer", resourceId: { in: offerIds }, action: "OFFER_CREATED" }] : [])
      ]
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 200,
    select: { resourceType: true, resourceId: true, actorId: true, occurredAt: true }
  });

  const creators = new Map<string, { actorId: string; occurredAt: Date }>();
  for (const audit of audits) {
    const key = `${audit.resourceType}:${audit.resourceId}`;
    if (!creators.has(key)) creators.set(key, { actorId: audit.actorId, occurredAt: audit.occurredAt });
  }

  const items: RecruitingLifecycleAttentionItem[] = [];
  for (const requisition of requisitions) {
    const creator = creators.get(`Requisition:${requisition.id}`);
    // Missing provenance cannot satisfy the four-eyes control. Fail closed rather than
    // projecting a record whose creator cannot be distinguished from the approver.
    if (!creator || creator.actorId === ctx.actorId) continue;
    const position = requisition.position
      ? `${requisition.position.positionCode} · ${requisition.position.title}`
      : "Unassigned position";
    items.push({
      id: `recruiting:requisition:${requisition.id}`,
      kind: "recruiting",
      title: `Requisition approval · ${requisition.title}`,
      subtitle: `${position} · ${requisition.openings} opening${requisition.openings === 1 ? "" : "s"}`,
      module: "recruiting",
      href: `/module/recruiting?requisition=${encodeURIComponent(requisition.id)}`,
      subjectType: "Requisition",
      subjectId: requisition.id,
      status: statusLabel(requisition.status),
      dueAt: null,
      createdAt: creator.occurredAt.toISOString(),
      urgency: "warning",
      action: { type: "approve-requisition", requisitionId: requisition.id },
      secondaryAction: { type: "return-requisition", requisitionId: requisition.id }
    });
  }

  for (const offer of offers) {
    const creator = creators.get(`Offer:${offer.id}`);
    if (!creator || creator.actorId === ctx.actorId) continue;
    const candidateName = `${offer.application.candidate.givenName} ${offer.application.candidate.familyName}`;
    const startDate = offer.startDate.toISOString().slice(0, 10);
    items.push({
      id: `recruiting:offer:${offer.id}`,
      kind: "recruiting",
      title: `Offer approval · ${candidateName}`,
      subtitle: `${offer.application.requisition.title} · start ${startDate}`,
      module: "recruiting",
      href: `/module/recruiting?offer=${encodeURIComponent(offer.id)}`,
      subjectType: "Offer",
      subjectId: offer.id,
      status: statusLabel(offer.status),
      dueAt: offer.expiresAt?.toISOString() ?? null,
      createdAt: creator.occurredAt.toISOString(),
      urgency: offerUrgency(offer.expiresAt),
      action: { type: "approve-offer", offerId: offer.id },
      secondaryAction: { type: "return-offer", offerId: offer.id }
    });
  }

  return items;
}

export async function getRecruitingLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getDocumentSignatureLifecycleActionCenterData(ctx);
  let recruitingItems: RecruitingLifecycleAttentionItem[] = [];
  let recruitingDegraded = false;

  try {
    recruitingItems = await recruitingApprovalItems(ctx);
  } catch (error) {
    recruitingDegraded = true;
    console.error("[HRBP] Recruiting approval attention failed; preserving the governed Action Center.", error);
  }

  const items: CompleteLifecycleActionItem[] = [...base.items, ...recruitingItems].sort(sortItems).slice(0, 350);
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
      recruiting: items.filter((item) => item.kind === "recruiting").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded: base.documentSignatureDegraded,
    recruitingDegraded
  };
}
