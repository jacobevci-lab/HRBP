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

export async function enqueueTimeApprovalNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    managerEmploymentId: string;
    entryId: string;
    submissionVersion: string;
    employeeName: string;
    workDate: Date;
    minutes: number;
    overtimeMinutes: number;
  }
) {
  const user = await userForEmployment(tx, input.tenantId, input.managerEmploymentId);
  if (!user) return null;
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "TIME_ENTRY_APPROVAL_REQUIRED",
    recipientUserId: user.id,
    templateKey: "time.entry-approval-required",
    resourceType: "TimeEntry",
    resourceId: input.entryId,
    dedupeKey: `time-entry:${input.entryId}:approval-required:${input.submissionVersion}`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      employeeName: input.employeeName,
      workDate: input.workDate.toISOString(),
      minutes: input.minutes,
      overtimeMinutes: input.overtimeMinutes
    }
  });
}

export async function enqueueTimeDecisionNotification(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    employmentId: string;
    entryId: string;
    decisionVersion: string;
    decision: "APPROVED" | "REJECTED";
    workDate: Date;
    minutes: number;
    overtimeMinutes: number;
  }
) {
  const user = await userForEmployment(tx, input.tenantId, input.employmentId);
  if (!user) return null;
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: input.decision === "APPROVED" ? "TIME_ENTRY_APPROVED" : "TIME_ENTRY_REJECTED",
    recipientUserId: user.id,
    templateKey: input.decision === "APPROVED" ? "time.entry-approved" : "time.entry-rejected",
    resourceType: "TimeEntry",
    resourceId: input.entryId,
    dedupeKey: `time-entry:${input.entryId}:${input.decision.toLowerCase()}:${input.decisionVersion}`,
    classification: DataClassification.CONFIDENTIAL,
    payload: {
      workDate: input.workDate.toISOString(),
      minutes: input.minutes,
      overtimeMinutes: input.overtimeMinutes,
      decision: input.decision
    }
  });
}
