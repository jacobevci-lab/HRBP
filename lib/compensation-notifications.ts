import { DataClassification, type Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

export async function enqueueCompensationApprovalNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    changeId: string;
    employeeName: string;
    currency: string;
    currentAnnualBase: string | null;
    proposedAnnualBase: string;
    effectiveAt: Date;
  }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "COMPENSATION_APPROVAL_REQUIRED",
    recipientRole: "COMPENSATION_ADMIN",
    templateKey: "compensation.approval-required",
    resourceType: "CompensationChange",
    resourceId: input.changeId,
    dedupeKey: `compensation-change:${input.changeId}:approval-required`,
    classification: DataClassification.RESTRICTED,
    payload: {
      compensationEmployeeName: input.employeeName,
      compensationCurrency: input.currency,
      compensationCurrentAnnualBase: input.currentAnnualBase,
      compensationProposedAnnualBase: input.proposedAnnualBase,
      compensationEffectiveAt: input.effectiveAt.toISOString(),
      compensationDecision: "APPROVAL_REQUIRED"
    }
  });
}

export async function enqueueCompensationDecisionNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    requesterUserId: string;
    changeId: string;
    employeeName: string;
    currency: string;
    proposedAnnualBase: string;
    effectiveAt: Date;
    decision: "APPROVED" | "REJECTED";
  }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.decision === "APPROVED" ? "COMPENSATION_CHANGE_APPROVED" : "COMPENSATION_CHANGE_REJECTED",
    recipientUserId: input.requesterUserId,
    templateKey: input.decision === "APPROVED" ? "compensation.change-approved" : "compensation.change-rejected",
    resourceType: "CompensationChange",
    resourceId: input.changeId,
    dedupeKey: `compensation-change:${input.changeId}:${input.decision.toLowerCase()}`,
    classification: DataClassification.RESTRICTED,
    payload: {
      compensationEmployeeName: input.employeeName,
      compensationCurrency: input.currency,
      compensationProposedAnnualBase: input.proposedAnnualBase,
      compensationEffectiveAt: input.effectiveAt.toISOString(),
      compensationDecision: input.decision
    }
  });
}

export async function enqueueCompensationPayrollHandoffNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    changeId: string;
    employeeName: string;
    currency: string;
    proposedAnnualBase: string;
    effectiveAt: Date;
  }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "COMPENSATION_PAYROLL_HANDOFF_READY",
    recipientRole: "PAYROLL_ADMIN",
    templateKey: "compensation.payroll-handoff-ready",
    resourceType: "CompensationChange",
    resourceId: input.changeId,
    dedupeKey: `compensation-change:${input.changeId}:payroll-handoff`,
    classification: DataClassification.RESTRICTED,
    payload: {
      compensationEmployeeName: input.employeeName,
      compensationCurrency: input.currency,
      compensationProposedAnnualBase: input.proposedAnnualBase,
      compensationEffectiveAt: input.effectiveAt.toISOString(),
      compensationDecision: "APPLIED"
    }
  });
}
