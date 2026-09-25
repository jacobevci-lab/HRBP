import { AccessRevocationStatus, AssetReturnStatus, DataClassification, ExitTaskStatus, PlatformRole, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";

export const terminalExitTaskStatuses: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
export const terminalKnowledgeTransferStatuses: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
export const terminalAssetReturnStatuses: AssetReturnStatus[] = [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF];
export const terminalAccessRevocationStatuses: AccessRevocationStatus[] = [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION];
export const settledFinalSettlementStatus = "SETTLED" as const;

export async function recalculateSeparationReadiness(tx: Prisma.TransactionClient, ctx: RequestContext, processId: string) {
  const process = await tx.separationProcess.findFirst({
    where: { id: processId, tenantId: ctx.tenantId },
    select: { id: true, status: true, lastWorkingDate: true, finalSettlementStatus: true }
  });
  if (!process) throw new Error("PROCESS_NOT_FOUND");
  if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");

  const [tasks, assetsOpen, accessOpen, knowledgeTransfersOpen] = await Promise.all([
    tx.separationTask.findMany({ where: { tenantId: ctx.tenantId, processId }, select: { status: true, blocking: true, domain: true } }),
    tx.assetReturn.count({ where: { tenantId: ctx.tenantId, processId, status: { notIn: terminalAssetReturnStatuses } } }),
    tx.accessRevocation.count({ where: { tenantId: ctx.tenantId, processId, status: { notIn: terminalAccessRevocationStatuses } } }),
    tx.knowledgeTransfer.count({ where: { tenantId: ctx.tenantId, processId, status: { notIn: terminalKnowledgeTransferStatuses } } })
  ]);

  const openBlocking = tasks.filter((item) => item.blocking && !terminalExitTaskStatuses.includes(item.status));
  const payrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() === "PAYROLL");
  const nonPayrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() !== "PAYROLL");
  const operationalClear = nonPayrollBlocking.length === 0 && assetsOpen === 0 && accessOpen === 0 && knowledgeTransfersOpen === 0;
  const settlementClear = process.finalSettlementStatus === settledFinalSettlementStatus;
  const payrollClear = payrollBlocking.length === 0 && settlementClear;
  const nextStatus = operationalClear && payrollClear
    ? SeparationStatus.READY_TO_CLOSE
    : operationalClear
      ? SeparationStatus.FINAL_PAY_REVIEW
      : SeparationStatus.CLEARANCE;

  if (nextStatus !== process.status) {
    const updated = await tx.separationProcess.updateMany({ where: { id: process.id, tenantId: ctx.tenantId, status: process.status }, data: { status: nextStatus } });
    if (updated.count !== 1) throw new Error("STATE_CONFLICT");
    await appendAudit(tx, ctx, {
      action: `offboarding.process-${process.status.toLowerCase()}-to-${nextStatus.toLowerCase()}`,
      resourceType: "SeparationProcess",
      resourceId: process.id,
      classification: DataClassification.RESTRICTED,
      purpose: nextStatus === SeparationStatus.READY_TO_CLOSE
        ? "Exit readiness gate cleared: blocking tasks, knowledge transfer, assets, access controls and final settlement are complete"
        : nextStatus === SeparationStatus.FINAL_PAY_REVIEW
          ? "Operational clearance is complete; governed final settlement remains open"
          : "Separation stage recalculated from governed exit controls"
    });

    if (nextStatus === SeparationStatus.READY_TO_CLOSE) {
      const now = new Date();
      await tx.notificationOutbox.updateMany({
        where: { tenantId: ctx.tenantId, resourceType: "SeparationProcess", resourceId: process.id, eventType: "OFFBOARDING_EXIT_READINESS_RISK", readAt: null },
        data: { readAt: now }
      });
      await enqueueNotificationOutbox(tx, {
        tenantId: ctx.tenantId,
        eventType: "OFFBOARDING_READY_TO_CLOSE",
        recipientRole: PlatformRole.HR_OPERATIONS,
        templateKey: "offboarding.ready-to-close",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        dedupeKey: `offboarding-process:${process.id}:ready-to-close:${process.lastWorkingDate.toISOString().slice(0, 10)}`,
        classification: DataClassification.RESTRICTED,
        payload: { separationProcessId: process.id, reminderState: "ready-to-close", lastWorkingDate: process.lastWorkingDate.toISOString(), finalSettlementStatus: process.finalSettlementStatus }
      });
    }
  }

  return {
    processStatus: nextStatus,
    openBlockingTasks: openBlocking.length,
    openPayrollTasks: payrollBlocking.length,
    openAssets: assetsOpen,
    openAccess: accessOpen,
    openKnowledgeTransfers: knowledgeTransfersOpen,
    finalSettlementStatus: process.finalSettlementStatus ?? "NOT_STARTED",
    finalSettlementClear: settlementClear
  };
}
