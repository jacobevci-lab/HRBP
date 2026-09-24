import { DataClassification, type Prisma } from "@prisma/client";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";

export async function enqueuePayrollApprovalNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; runId: string; periodCode: string; countryCode: string; runNumber: number; payDate: Date }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "PAYROLL_APPROVAL_REQUIRED",
    recipientRole: "PAYROLL_ADMIN",
    templateKey: "payroll.approval-required",
    resourceType: "PayrollRun",
    resourceId: input.runId,
    dedupeKey: `payroll-run:${input.runId}:approval-required`,
    classification: DataClassification.RESTRICTED,
    payload: {
      payrollPeriodCode: input.periodCode,
      payrollCountryCode: input.countryCode,
      payrollRunNumber: input.runNumber,
      payrollPayDate: input.payDate.toISOString(),
      payrollDecision: "APPROVAL_REQUIRED"
    }
  });
}

export async function enqueuePayrollApprovedNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; recipientUserId?: string | null; runId: string; periodCode: string; countryCode: string; runNumber: number; payDate: Date }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "PAYROLL_RUN_APPROVED",
    ...(input.recipientUserId ? { recipientUserId: input.recipientUserId } : { recipientRole: "PAYROLL_ADMIN" }),
    templateKey: "payroll.run-approved",
    resourceType: "PayrollRun",
    resourceId: input.runId,
    dedupeKey: `payroll-run:${input.runId}:approved`,
    classification: DataClassification.RESTRICTED,
    payload: {
      payrollPeriodCode: input.periodCode,
      payrollCountryCode: input.countryCode,
      payrollRunNumber: input.runNumber,
      payrollPayDate: input.payDate.toISOString(),
      payrollDecision: "APPROVED"
    }
  });
}

export async function enqueuePayrollPaidNotification(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; runId: string; periodCode: string; countryCode: string; runNumber: number; payDate: Date }
) {
  return enqueueNotificationOutbox(tx, {
    tenantId: input.tenantId,
    eventType: "PAYROLL_RUN_PAID",
    recipientRole: "PAYROLL_ADMIN",
    templateKey: "payroll.run-paid",
    resourceType: "PayrollRun",
    resourceId: input.runId,
    dedupeKey: `payroll-run:${input.runId}:paid`,
    classification: DataClassification.RESTRICTED,
    payload: {
      payrollPeriodCode: input.periodCode,
      payrollCountryCode: input.countryCode,
      payrollRunNumber: input.runNumber,
      payrollPayDate: input.payDate.toISOString(),
      payrollDecision: "PAID"
    }
  });
}
