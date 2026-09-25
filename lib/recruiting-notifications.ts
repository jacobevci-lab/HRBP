import { DataClassification, type Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

export async function enqueueRequisitionApprovalNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; requisitionId: string; title: string; openings: number }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "RECRUITING_REQUISITION_APPROVAL_REQUIRED",
    recipientRole: "HR_OPERATIONS",
    templateKey: "recruiting.requisition-approval-required",
    resourceType: "Requisition",
    resourceId: input.requisitionId,
    dedupeKey: `requisition:${input.requisitionId}:approval-required`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      recruitingRecordType: "REQUISITION",
      recruitingTitle: input.title,
      recruitingOpenings: input.openings,
      recruitingDecision: "APPROVAL_REQUIRED"
    }
  });
}

export async function enqueueRequisitionDecisionNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; recipientUserId: string; requisitionId: string; title: string; openings: number; decision: "APPROVED" | "RETURNED" | "CANCELLED" }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.decision === "APPROVED" ? "RECRUITING_REQUISITION_APPROVED" : input.decision === "RETURNED" ? "RECRUITING_REQUISITION_RETURNED" : "RECRUITING_REQUISITION_CANCELLED",
    recipientUserId: input.recipientUserId,
    templateKey: `recruiting.requisition-${input.decision.toLowerCase()}`,
    resourceType: "Requisition",
    resourceId: input.requisitionId,
    dedupeKey: `requisition:${input.requisitionId}:${input.decision.toLowerCase()}`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      recruitingRecordType: "REQUISITION",
      recruitingTitle: input.title,
      recruitingOpenings: input.openings,
      recruitingDecision: input.decision
    }
  });
}

export async function enqueueOfferApprovalNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; offerId: string; candidateName: string; requisitionTitle: string; currency: string; annualBase: string; startDate: Date }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "RECRUITING_OFFER_APPROVAL_REQUIRED",
    recipientRole: "HR_OPERATIONS",
    templateKey: "recruiting.offer-approval-required",
    resourceType: "Offer",
    resourceId: input.offerId,
    dedupeKey: `offer:${input.offerId}:approval-required`,
    classification: DataClassification.RESTRICTED,
    payload: {
      recruitingRecordType: "OFFER",
      recruitingTitle: input.requisitionTitle,
      recruitingCandidateName: input.candidateName,
      recruitingCurrency: input.currency,
      recruitingAnnualBase: input.annualBase,
      recruitingStartDate: input.startDate.toISOString(),
      recruitingDecision: "APPROVAL_REQUIRED"
    }
  });
}

export async function enqueueOfferDecisionNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; recipientUserId: string; offerId: string; candidateName: string; requisitionTitle: string; currency: string; annualBase: string; startDate: Date; decision: "APPROVED" | "RETURNED" | "WITHDRAWN" }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.decision === "APPROVED" ? "RECRUITING_OFFER_APPROVED" : input.decision === "RETURNED" ? "RECRUITING_OFFER_RETURNED" : "RECRUITING_OFFER_WITHDRAWN",
    recipientUserId: input.recipientUserId,
    templateKey: `recruiting.offer-${input.decision.toLowerCase()}`,
    resourceType: "Offer",
    resourceId: input.offerId,
    dedupeKey: `offer:${input.offerId}:${input.decision.toLowerCase()}`,
    classification: DataClassification.RESTRICTED,
    payload: {
      recruitingRecordType: "OFFER",
      recruitingTitle: input.requisitionTitle,
      recruitingCandidateName: input.candidateName,
      recruitingCurrency: input.currency,
      recruitingAnnualBase: input.annualBase,
      recruitingStartDate: input.startDate.toISOString(),
      recruitingDecision: input.decision
    }
  });
}
