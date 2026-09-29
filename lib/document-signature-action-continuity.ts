import { SignatureEnvelopeStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { documentVisibilityWhere } from "@/lib/document-access";
import {
  getEmployeeLifecycleActionCenterData,
  type FullLifecycleActionItem
} from "@/lib/employee-lifecycle-action-continuity";
import type { LifecycleActionUrgency } from "@/lib/lifecycle-action-center";
import type { RequestContext } from "@/lib/request-context";

const SIGNATURE_FOLLOWUP_DAYS = 30;

function statusLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function urgencyForDueDate(dueAt: Date, now = Date.now()): LifecycleActionUrgency {
  const due = dueAt.getTime();
  if (due < now) return "critical";
  if (due <= now + 24 * 60 * 60 * 1000) return "warning";
  return "normal";
}

function sortItems(left: FullLifecycleActionItem, right: FullLifecycleActionItem) {
  const rank: Record<LifecycleActionUrgency, number> = { critical: 0, warning: 1, normal: 2 };
  if (rank[left.urgency] !== rank[right.urgency]) return rank[left.urgency] - rank[right.urgency];
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function signatureFollowupItems(ctx: RequestContext): Promise<FullLifecycleActionItem[]> {
  if (!can(ctx, "documents:sign") || !can(ctx, "documents:read")) return [];

  const horizon = new Date(Date.now() + SIGNATURE_FOLLOWUP_DAYS * 86_400_000);
  const envelopes = await db.signatureEnvelope.findMany({
    where: {
      tenantId: ctx.tenantId,
      createdById: ctx.actorId,
      status: { in: [SignatureEnvelopeStatus.SENT, SignatureEnvelopeStatus.IN_PROGRESS] },
      expiresAt: { not: null, lte: horizon }
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      documentId: true,
      title: true,
      status: true,
      expiresAt: true,
      createdAt: true
    }
  });
  if (!envelopes.length) return [];

  const visibility = await documentVisibilityWhere(db, ctx);
  const documentIds = [...new Set(envelopes.map((envelope) => envelope.documentId))];
  const visibleDocuments = await db.documentRecord.findMany({
    where: { AND: [visibility, { id: { in: documentIds } }] },
    take: 100,
    select: { id: true, fileName: true, purpose: true }
  });
  const documents = new Map(visibleDocuments.map((document) => [document.id, document]));

  return envelopes.flatMap((envelope): FullLifecycleActionItem[] => {
    const document = documents.get(envelope.documentId);
    if (!document || !envelope.expiresAt) return [];
    return [{
      id: `documents:signature:${envelope.id}`,
      kind: "documents",
      title: `Signature follow-up · ${document.fileName}`,
      subtitle: `${envelope.title} · ${statusLabel(envelope.status)}`,
      module: "documents",
      href: `/module/documents?document=${encodeURIComponent(document.id)}&envelope=${encodeURIComponent(envelope.id)}`,
      subjectType: "SignatureEnvelope",
      subjectId: envelope.id,
      status: statusLabel(envelope.status),
      dueAt: envelope.expiresAt.toISOString(),
      createdAt: envelope.createdAt.toISOString(),
      urgency: urgencyForDueDate(envelope.expiresAt),
      action: null
    }];
  });
}

export async function getDocumentSignatureLifecycleActionCenterData(ctx: RequestContext) {
  const base = await getEmployeeLifecycleActionCenterData(ctx);
  let signatureItems: FullLifecycleActionItem[] = [];
  let documentSignatureDegraded = false;

  try {
    signatureItems = await signatureFollowupItems(ctx);
  } catch (error) {
    documentSignatureDegraded = true;
    console.error("[HRBP] Document signature lifecycle attention failed; preserving the governed Action Center.", error);
  }

  const items = [...base.items, ...signatureItems].sort(sortItems).slice(0, 300);
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
      documents: items.filter((item) => item.kind === "documents").length
    },
    generatedAt: new Date(now).toISOString(),
    growthDegraded: base.growthDegraded,
    employeeLifecycleDegraded: base.employeeLifecycleDegraded,
    documentSignatureDegraded
  };
}
