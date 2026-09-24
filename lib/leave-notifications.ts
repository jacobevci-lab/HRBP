import { DataClassification, type Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

async function userForEmployment(tx: Prisma.TransactionClient, tenantId: string, employmentId: string) {
  const employment = await tx.employment.findFirst({
    where: { id: employmentId, tenantId },
    select: { person: { select: { workEmail: true } } }
  });
  const email = employment?.person.workEmail?.trim();
  if (!email) return null;
  return tx.userAccount.findFirst({
    where: { tenantId, active: true, email: { equals: email, mode: "insensitive" } },
    select: { id: true }
  });
}

export async function enqueueLeaveApprovalNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    managerEmploymentId: string;
    requestId: string;
    employeeName: string;
    leaveType: string;
    startsAt: Date;
    endsAt: Date;
    units: string;
  }
) {
  const user = await userForEmployment(tx, input.tenantId, input.managerEmploymentId);
  if (!user) return null;
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "LEAVE_APPROVAL_REQUIRED",
    recipientUserId: user.id,
    templateKey: "leave.approval-required",
    resourceType: "LeaveRequest",
    resourceId: input.requestId,
    dedupeKey: `leave-request:${input.requestId}:approval-required`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      employeeName: input.employeeName,
      leaveType: input.leaveType,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      units: input.units
    }
  });
}

export async function enqueueLeaveDecisionNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    employmentId: string;
    requestId: string;
    decision: "APPROVED" | "REJECTED";
    leaveType: string;
    startsAt: Date;
    endsAt: Date;
    units: string;
  }
) {
  const user = await userForEmployment(tx, input.tenantId, input.employmentId);
  if (!user) return null;
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.decision === "APPROVED" ? "LEAVE_REQUEST_APPROVED" : "LEAVE_REQUEST_REJECTED",
    recipientUserId: user.id,
    templateKey: input.decision === "APPROVED" ? "leave.request-approved" : "leave.request-rejected",
    resourceType: "LeaveRequest",
    resourceId: input.requestId,
    dedupeKey: `leave-request:${input.requestId}:${input.decision.toLowerCase()}`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      leaveType: input.leaveType,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      units: input.units,
      decision: input.decision
    }
  });
}
