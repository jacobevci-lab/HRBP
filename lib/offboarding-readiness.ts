import { AccessRevocationStatus, AssetReturnStatus, DataClassification, ExitTaskStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/request-context";

export const terminalExitTaskStatuses: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
export const terminalAssetReturnStatuses: AssetReturnStatus[] = [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF];
export const terminalAccessRevocationStatuses: AccessRevocationStatus[] = [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION];

export async function recalculateSeparationReadiness(tx: Prisma.TransactionClient, ctx: RequestContext, processId: string) {
  const process = await tx.separationProcess.findFirst({
    where: { id: processId, tenantId: ctx.tenantId },
    select: { id: true, status: true }
  });
  if (!process) throw new Error("PROCESS_NOT_FOUND");
  if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");

  const [tasks, assetsOpen, accessOpen] = await Promise.all([
    tx.separationTask.findMany({
      where: { tenantId: ctx.tenantId, processId },
      select: { status: true, blocking: true, domain: true }
    }),
    tx.assetReturn.count({
      where: { tenantId: ctx.tenantId, processId, status: { notIn: terminalAssetReturnStatuses } }
    }),
    tx.accessRevocation.count({
      where: { tenantId: ctx.tenantId, processId, status: { notIn: terminalAccessRevocationStatuses } }
    })
  ]);

  const openBlocking = tasks.filter((item) => item.blocking && !terminalExitTaskStatuses.includes(item.status));
  const payrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() === "PAYROLL");
  const nonPayrollBlocking = openBlocking.filter((item) => item.domain.trim().toUpperCase() !== "PAYROLL");
  const nextStatus = openBlocking.length === 0 && assetsOpen === 0 && accessOpen === 0
    ? SeparationStatus.READY_TO_CLOSE
    : payrollBlocking.length > 0 && nonPayrollBlocking.length === 0 && assetsOpen === 0 && accessOpen === 0
      ? SeparationStatus.FINAL_PAY_REVIEW
      : SeparationStatus.CLEARANCE;

  if (nextStatus !== process.status) {
    const updated = await tx.separationProcess.updateMany({
      where: { id: process.id, tenantId: ctx.tenantId, status: process.status },
      data: { status: nextStatus }
    });
    if (updated.count !== 1) throw new Error("STATE_CONFLICT");
    await appendAudit(tx, ctx, {
      action: `offboarding.process-${process.status.toLowerCase()}-to-${nextStatus.toLowerCase()}`,
      resourceType: "SeparationProcess",
      resourceId: process.id,
      classification: DataClassification.RESTRICTED,
      purpose: nextStatus === SeparationStatus.READY_TO_CLOSE
        ? "Exit readiness gate cleared: blocking tasks, assets and access controls are complete"
        : "Separation stage recalculated from governed exit controls"
    });
  }

  return {
    processStatus: nextStatus,
    openBlockingTasks: openBlocking.length,
    openAssets: assetsOpen,
    openAccess: accessOpen
  };
}
