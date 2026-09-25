import { AccessRevocationStatus, AssetReturnStatus, ExitTaskStatus, SeparationStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

const TERMINAL_STATUSES: SeparationStatus[] = [SeparationStatus.CLOSED, SeparationStatus.CANCELLED];
const TASK_TERMINAL: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
const ASSET_TERMINAL: AssetReturnStatus[] = [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF];
const ACCESS_TERMINAL: AccessRevocationStatus[] = [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION];

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export type OffboardingHistoryAuditEvidence = {
  action: string;
  resourceType: string;
  actorId: string;
  purpose: string | null;
  occurredAt: string;
  hash: string;
  previousHash: string | null;
};

export type OffboardingHistoryEvent = {
  key: string;
  kind: "PROCESS" | "SCHEDULE" | "INTERVIEW" | "SETTLEMENT" | "DECISION" | "TERMINAL";
  title: string;
  actorId: string | null;
  occurredAt: string;
  detail: string | null;
};

export type OffboardingHistoryRow = {
  id: string;
  employmentId: string;
  personId: string | null;
  employee: string;
  employeeNumber: string;
  position: string;
  type: string;
  status: "CLOSED" | "CANCELLED";
  noticeDate: string | null;
  lastWorkingDate: string;
  terminalAt: string;
  initiatedById: string;
  cancellationReason: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  replacementRequired: boolean | null;
  replacementDecisionReason: string | null;
  replacementDecisionById: string | null;
  replacementDecisionAt: string | null;
  replacementRequisitionId: string | null;
  finalSettlementStatus: string;
  finalSettlementReversalReason: string | null;
  finalSettlementReversedById: string | null;
  finalSettlementReversedAt: string | null;
  rehireEligible: boolean | null;
  rehireDecisionReason: string | null;
  rehireDecisionById: string | null;
  rehireDecisionAt: string | null;
  taskCount: number;
  tasksCompleted: number;
  tasksWaived: number;
  tasksOpen: number;
  assetCount: number;
  assetsReturned: number;
  assetsWrittenOff: number;
  assetsOpen: number;
  accessCount: number;
  accessRevoked: number;
  accessExceptions: number;
  accessOpen: number;
  knowledgeTransferCount: number;
  knowledgeTransfersOpen: number;
  exitInterviewRecorded: boolean;
  scheduleAmendmentCount: number;
  events: OffboardingHistoryEvent[];
  auditEvidence: OffboardingHistoryAuditEvidence[];
};

export type OffboardingHistoryData = {
  total: number;
  closed: number;
  cancelled: number;
  last30Days: number;
  auditVisible: boolean;
  rows: OffboardingHistoryRow[];
};

export async function getOffboardingHistoryData(ctx: RequestContext, includeAudit = false): Promise<OffboardingHistoryData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const processes = await db.separationProcess.findMany({
      where: { tenantId: ctx.tenantId, status: { in: TERMINAL_STATUSES }, ...employmentIdFilter(scope) },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        employmentId: true,
        type: true,
        status: true,
        noticeDate: true,
        lastWorkingDate: true,
        initiatedById: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        cancellationReason: true,
        cancelledById: true,
        cancelledAt: true,
        replacementRequired: true,
        replacementDecisionReason: true,
        replacementDecisionById: true,
        replacementDecisionAt: true,
        replacementRequisitionId: true,
        finalSettlementStatus: true,
        finalSettlementPreparedById: true,
        finalSettlementPreparedAt: true,
        finalSettlementApprovedById: true,
        finalSettlementApprovedAt: true,
        finalSettlementSettledById: true,
        finalSettlementSettledAt: true,
        finalSettlementReversalReason: true,
        finalSettlementReversedById: true,
        finalSettlementReversedAt: true,
        rehireEligible: true,
        rehireDecisionReason: true,
        rehireDecisionById: true,
        rehireDecisionAt: true,
        tasks: { select: { status: true } },
        assets: { select: { status: true } },
        accessRevocations: { select: { status: true } },
        knowledgeTransfers: { select: { status: true } },
        scheduleAmendments: {
          orderBy: { changedAt: "asc" },
          take: 100,
          select: { id: true, previousNoticeDate: true, newNoticeDate: true, previousLastWorkingDate: true, newLastWorkingDate: true, reason: true, changedById: true, changedAt: true }
        },
        exitInterview: { select: { interviewerId: true, conductedAt: true, wouldRecommend: true } }
      }
    });

    const employmentIds = [...new Set(processes.map((process) => process.employmentId))];
    const employments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: employmentIds }, ...employmentPrimaryKeyFilter(scope) },
      select: {
        id: true,
        personId: true,
        person: { select: { employeeNumber: true, givenName: true, familyName: true } },
        position: { select: { title: true } }
      }
    }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));

    const processIds = processes.map((process) => process.id);
    const replacementRequisitionIds = [...new Set(processes.flatMap((process) => process.replacementRequisitionId ? [process.replacementRequisitionId] : []))];
    const audit = includeAudit && processIds.length ? await db.auditEvent.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [
          { resourceType: "SeparationProcess", resourceId: { in: processIds } },
          ...(employmentIds.length ? [{ resourceType: "Employment", resourceId: { in: employmentIds } }] : []),
          ...(replacementRequisitionIds.length ? [{ resourceType: "Requisition", resourceId: { in: replacementRequisitionIds } }] : [])
        ]
      },
      orderBy: { occurredAt: "asc" },
      take: 1500,
      select: { action: true, resourceType: true, resourceId: true, actorId: true, purpose: true, occurredAt: true, hash: true, previousHash: true }
    }) : [];

    const rows = processes.map<OffboardingHistoryRow>((process) => {
      const employment = employmentMap.get(process.employmentId);
      const status = process.status === SeparationStatus.CANCELLED ? "CANCELLED" : "CLOSED";
      const terminalAtDate = process.cancelledAt ?? process.completedAt ?? process.updatedAt;
      const events: OffboardingHistoryEvent[] = [
        {
          key: `${process.id}:created`,
          kind: "PROCESS",
          title: "Separation initiated",
          actorId: process.initiatedById,
          occurredAt: process.createdAt.toISOString(),
          detail: null
        }
      ];
      for (const amendment of process.scheduleAmendments) {
        events.push({
          key: `${process.id}:schedule:${amendment.id}`,
          kind: "SCHEDULE",
          title: "Exit schedule amended",
          actorId: amendment.changedById,
          occurredAt: amendment.changedAt.toISOString(),
          detail: `Notice ${amendment.previousNoticeDate?.toISOString() ?? "none"} -> ${amendment.newNoticeDate?.toISOString() ?? "none"}; last day ${amendment.previousLastWorkingDate.toISOString()} -> ${amendment.newLastWorkingDate.toISOString()} · ${amendment.reason}`
        });
      }
      if (process.replacementDecisionAt) {
        events.push({
          key: `${process.id}:replacement`,
          kind: "DECISION",
          title: process.replacementRequired ? "Replacement approved and handed to Recruiting" : "No replacement required",
          actorId: process.replacementDecisionById,
          occurredAt: process.replacementDecisionAt.toISOString(),
          detail: process.replacementRequired
            ? `${process.replacementRequisitionId ? `Draft requisition ${process.replacementRequisitionId}` : "Backfill approved"}${process.replacementDecisionReason ? ` · ${process.replacementDecisionReason}` : ""}`
            : process.replacementDecisionReason
        });
      }
      if (process.exitInterview) events.push({
        key: `${process.id}:interview`,
        kind: "INTERVIEW",
        title: "Exit interview recorded",
        actorId: process.exitInterview.interviewerId,
        occurredAt: process.exitInterview.conductedAt.toISOString(),
        detail: process.exitInterview.wouldRecommend === null ? null : process.exitInterview.wouldRecommend ? "Interview recommendation: would recommend future employment" : "Interview recommendation: would not recommend future employment"
      });
      if (process.rehireDecisionAt) events.push({
        key: `${process.id}:rehire`,
        kind: "DECISION",
        title: "Human rehire eligibility decision",
        actorId: process.rehireDecisionById,
        occurredAt: process.rehireDecisionAt.toISOString(),
        detail: process.rehireEligible === null ? process.rehireDecisionReason : `${process.rehireEligible ? "Eligible" : "Not eligible"}${process.rehireDecisionReason ? ` · ${process.rehireDecisionReason}` : ""}`
      });
      if (process.finalSettlementPreparedAt) events.push({
        key: `${process.id}:settlement-prepared`,
        kind: "SETTLEMENT",
        title: "Final settlement prepared",
        actorId: process.finalSettlementPreparedById,
        occurredAt: process.finalSettlementPreparedAt.toISOString(),
        detail: null
      });
      if (process.finalSettlementApprovedAt) events.push({
        key: `${process.id}:settlement-approved`,
        kind: "SETTLEMENT",
        title: "Final settlement independently approved",
        actorId: process.finalSettlementApprovedById,
        occurredAt: process.finalSettlementApprovedAt.toISOString(),
        detail: null
      });
      if (process.finalSettlementSettledAt) events.push({
        key: `${process.id}:settlement-settled`,
        kind: "SETTLEMENT",
        title: "Final settlement settled",
        actorId: process.finalSettlementSettledById,
        occurredAt: process.finalSettlementSettledAt.toISOString(),
        detail: null
      });
      if (process.finalSettlementReversedAt) events.push({
        key: `${process.id}:settlement-reversed`,
        kind: "SETTLEMENT",
        title: "Final settlement reversed under four-eyes control",
        actorId: process.finalSettlementReversedById,
        occurredAt: process.finalSettlementReversedAt.toISOString(),
        detail: process.finalSettlementReversalReason
      });
      events.push({
        key: `${process.id}:terminal`,
        kind: "TERMINAL",
        title: status === "CANCELLED" ? "Separation cancelled without employment termination" : "Employment terminated and separation closed",
        actorId: status === "CANCELLED" ? process.cancelledById : audit.find((item) => item.resourceType === "SeparationProcess" && item.resourceId === process.id && item.action === "offboarding.process-closed")?.actorId ?? null,
        occurredAt: terminalAtDate.toISOString(),
        detail: status === "CANCELLED" ? process.cancellationReason : null
      });
      events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

      const processAudit = audit.filter((item) =>
        (item.resourceType === "SeparationProcess" && item.resourceId === process.id) ||
        (item.resourceType === "Employment" && item.resourceId === process.employmentId) ||
        (Boolean(process.replacementRequisitionId) && item.resourceType === "Requisition" && item.resourceId === process.replacementRequisitionId)
      );
      const tasksCompleted = process.tasks.filter((task) => task.status === ExitTaskStatus.COMPLETED).length;
      const tasksWaived = process.tasks.filter((task) => task.status === ExitTaskStatus.WAIVED).length;
      const assetsReturned = process.assets.filter((asset) => asset.status === AssetReturnStatus.RETURNED).length;
      const assetsWrittenOff = process.assets.filter((asset) => asset.status === AssetReturnStatus.WRITTEN_OFF).length;
      const accessRevoked = process.accessRevocations.filter((access) => access.status === AccessRevocationStatus.REVOKED).length;
      const accessExceptions = process.accessRevocations.filter((access) => access.status === AccessRevocationStatus.EXCEPTION).length;

      return {
        id: process.id,
        employmentId: process.employmentId,
        personId: employment?.personId ?? null,
        employee: employment ? `${employment.person.givenName} ${employment.person.familyName}` : "Employment record",
        employeeNumber: employment?.person.employeeNumber ?? "—",
        position: employment?.position?.title ?? "Position unavailable",
        type: process.type,
        status,
        noticeDate: iso(process.noticeDate),
        lastWorkingDate: process.lastWorkingDate.toISOString(),
        terminalAt: terminalAtDate.toISOString(),
        initiatedById: process.initiatedById,
        cancellationReason: process.cancellationReason,
        cancelledById: process.cancelledById,
        cancelledAt: iso(process.cancelledAt),
        replacementRequired: process.replacementRequired,
        replacementDecisionReason: process.replacementDecisionReason,
        replacementDecisionById: process.replacementDecisionById,
        replacementDecisionAt: iso(process.replacementDecisionAt),
        replacementRequisitionId: process.replacementRequisitionId,
        finalSettlementStatus: process.finalSettlementStatus ?? "NOT_STARTED",
        finalSettlementReversalReason: process.finalSettlementReversalReason,
        finalSettlementReversedById: process.finalSettlementReversedById,
        finalSettlementReversedAt: iso(process.finalSettlementReversedAt),
        rehireEligible: process.rehireEligible,
        rehireDecisionReason: process.rehireDecisionReason,
        rehireDecisionById: process.rehireDecisionById,
        rehireDecisionAt: iso(process.rehireDecisionAt),
        taskCount: process.tasks.length,
        tasksCompleted,
        tasksWaived,
        tasksOpen: process.tasks.filter((task) => !TASK_TERMINAL.includes(task.status)).length,
        assetCount: process.assets.length,
        assetsReturned,
        assetsWrittenOff,
        assetsOpen: process.assets.filter((asset) => !ASSET_TERMINAL.includes(asset.status)).length,
        accessCount: process.accessRevocations.length,
        accessRevoked,
        accessExceptions,
        accessOpen: process.accessRevocations.filter((access) => !ACCESS_TERMINAL.includes(access.status)).length,
        knowledgeTransferCount: process.knowledgeTransfers.length,
        knowledgeTransfersOpen: process.knowledgeTransfers.filter((transfer) => !TASK_TERMINAL.includes(transfer.status)).length,
        exitInterviewRecorded: Boolean(process.exitInterview),
        scheduleAmendmentCount: process.scheduleAmendments.length,
        events,
        auditEvidence: processAudit.map((item) => ({
          action: item.action,
          resourceType: item.resourceType,
          actorId: item.actorId,
          purpose: item.purpose,
          occurredAt: item.occurredAt.toISOString(),
          hash: item.hash,
          previousHash: item.previousHash
        }))
      };
    });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      total: rows.length,
      closed: rows.filter((row) => row.status === "CLOSED").length,
      cancelled: rows.filter((row) => row.status === "CANCELLED").length,
      last30Days: rows.filter((row) => new Date(row.terminalAt).getTime() >= thirtyDaysAgo).length,
      auditVisible: includeAudit,
      rows
    };
  });
}
