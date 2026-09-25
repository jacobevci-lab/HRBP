import { AccessRevocationStatus, AssetReturnStatus, EmploymentStatus, ExitTaskStatus, SeparationStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(value);
}

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

const OPEN_STATUSES: SeparationStatus[] = [SeparationStatus.DRAFT, SeparationStatus.NOTICE_PERIOD, SeparationStatus.CLEARANCE, SeparationStatus.FINAL_PAY_REVIEW, SeparationStatus.READY_TO_CLOSE];
const TERMINAL_TASK_STATUSES: ExitTaskStatus[] = [ExitTaskStatus.COMPLETED, ExitTaskStatus.WAIVED];
const TERMINAL_ASSET_STATUSES: AssetReturnStatus[] = [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF];
const TERMINAL_ACCESS_STATUSES: AccessRevocationStatus[] = [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION];
const ACTIVE_EMPLOYMENTS: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED];

export type OffboardingTaskRow = { id: string; domain: string; title: string; status: string; rawStatus: string; blocking: boolean; dueAt: string; dueAtIso: string | null };
export type OffboardingAssetRow = { id: string; assetTag: string; assetType: string; serialNumber: string | null; status: string; rawStatus: string; returnedAt: string | null; conditionNote: string | null };
export type OffboardingAccessRow = { id: string; systemName: string; accountId: string | null; status: string; rawStatus: string; scheduledAt: string | null; revokedAt: string | null; exceptionReason: string | null };
export type OffboardingKnowledgeTransferRow = { id: string; title: string; description: string | null; recipientId: string | null; status: string; rawStatus: string; dueAt: string; dueAtIso: string | null; completedAt: string | null };

export type OffboardingProcessRow = {
  id: string; employmentId: string; personId: string | null; initiatedById: string; employee: string; employeeNumber: string; position: string; type: string; status: string; rawStatus: string;
  lastWorkingDate: string; lastWorkingDateIso: string; completedTasks: number; taskCount: number; openBlockingTasks: number; overdueTasks: number; assetsOpen: number; accessOpen: number; openKnowledgeTransfers: number;
  finalSettlementStatus: string; finalSettlementNote: string | null; finalSettlementPreparedById: string | null; finalSettlementPreparedAt: string | null; finalSettlementApprovedById: string | null; finalSettlementApprovedAt: string | null; finalSettlementSettledById: string | null; finalSettlementSettledAt: string | null; finalSettlementReversalReason: string | null; finalSettlementReversedById: string | null; finalSettlementReversedAt: string | null; finalSettlementClear: boolean;
  controlsClear: boolean; readyToClose: boolean; exitRisk: boolean; tasks: OffboardingTaskRow[]; assets: OffboardingAssetRow[]; accessControls: OffboardingAccessRow[]; knowledgeTransfers: OffboardingKnowledgeTransferRow[];
};

export type OffboardingEligibleEmployment = { id: string; personId: string; employee: string; employeeNumber: string; position: string; department: string };
export type OffboardingWorkspaceData = { openSeparations: number; leavingThisWeek: number; blockingTasks: number; overdueTasks: number; exitRiskProcesses: number; readyToClose: number; finalPayReview: number; processes: OffboardingProcessRow[]; eligibleEmployments: OffboardingEligibleEmployment[] };

export async function getOffboardingWorkspaceData(ctx: RequestContext, includeEligible = false): Promise<OffboardingWorkspaceData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const processes = await db.separationProcess.findMany({
      where: { tenantId: ctx.tenantId, status: { in: OPEN_STATUSES }, ...employmentIdFilter(scope) },
      orderBy: [{ lastWorkingDate: "asc" }, { createdAt: "desc" }],
      take: 150,
      select: {
        id: true, employmentId: true, initiatedById: true, type: true, status: true, lastWorkingDate: true,
        finalSettlementStatus: true, finalSettlementNote: true, finalSettlementPreparedById: true, finalSettlementPreparedAt: true,
        finalSettlementApprovedById: true, finalSettlementApprovedAt: true, finalSettlementSettledById: true, finalSettlementSettledAt: true,
        finalSettlementReversalReason: true, finalSettlementReversedById: true, finalSettlementReversedAt: true,
        tasks: { orderBy: [{ blocking: "desc" }, { createdAt: "asc" }], select: { id: true, domain: true, title: true, status: true, blocking: true, dueAt: true } },
        assets: { orderBy: { assetTag: "asc" }, select: { id: true, assetTag: true, assetType: true, serialNumber: true, status: true, returnedAt: true, conditionNote: true } },
        accessRevocations: { orderBy: { systemName: "asc" }, select: { id: true, systemName: true, accountId: true, status: true, scheduledAt: true, revokedAt: true, exceptionReason: true } },
        knowledgeTransfers: { orderBy: [{ dueAt: "asc" }, { title: "asc" }], select: { id: true, title: true, description: true, recipientId: true, status: true, dueAt: true, completedAt: true } }
      }
    });

    const employmentIds = [...new Set(processes.map((process) => process.employmentId))];
    const processEmployments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: employmentIds }, ...employmentPrimaryKeyFilter(scope) },
      select: { id: true, personId: true, person: { select: { employeeNumber: true, givenName: true, familyName: true } }, position: { select: { title: true, orgUnit: { select: { name: true } } } } }
    }) : [];
    const employmentMap = new Map(processEmployments.map((employment) => [employment.id, employment]));

    const eligible = includeEligible ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ACTIVE_EMPLOYMENTS }, ...employmentPrimaryKeyFilter(scope), NOT: { id: { in: employmentIds.length ? employmentIds : ["__none__"] } } },
      orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
      take: 300,
      select: { id: true, personId: true, person: { select: { employeeNumber: true, givenName: true, familyName: true } }, position: { select: { title: true, orgUnit: { select: { name: true } } } } }
    }) : [];

    const now = new Date();
    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
    const exitRiskEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const rows = processes.map<OffboardingProcessRow>((process) => {
      const employment = employmentMap.get(process.employmentId);
      const completedTasks = process.tasks.filter((task) => TERMINAL_TASK_STATUSES.includes(task.status)).length;
      const openBlockingTasks = process.tasks.filter((task) => task.blocking && !TERMINAL_TASK_STATUSES.includes(task.status)).length;
      const overdueTasks = process.tasks.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status) && task.dueAt && task.dueAt < now).length;
      const assetsOpen = process.assets.filter((asset) => !TERMINAL_ASSET_STATUSES.includes(asset.status)).length;
      const accessOpen = process.accessRevocations.filter((access) => !TERMINAL_ACCESS_STATUSES.includes(access.status)).length;
      const openKnowledgeTransfers = process.knowledgeTransfers.filter((transfer) => !TERMINAL_TASK_STATUSES.includes(transfer.status)).length;
      const controlsClear = openBlockingTasks === 0 && assetsOpen === 0 && accessOpen === 0 && openKnowledgeTransfers === 0;
      const finalSettlementStatus = process.finalSettlementStatus ?? "NOT_STARTED";
      const finalSettlementClear = finalSettlementStatus === "SETTLED";
      const readyToClose = controlsClear && finalSettlementClear && process.status === SeparationStatus.READY_TO_CLOSE;
      const exitRisk = !readyToClose && process.lastWorkingDate <= exitRiskEnd;
      return {
        id: process.id, employmentId: process.employmentId, personId: employment?.personId ?? null, initiatedById: process.initiatedById,
        employee: employment ? `${employment.person.givenName} ${employment.person.familyName}` : "Employment record",
        employeeNumber: employment?.person.employeeNumber ?? "—", position: employment?.position?.title ?? "Position unavailable", type: label(process.type), status: label(process.status), rawStatus: process.status,
        lastWorkingDate: formatDate(process.lastWorkingDate), lastWorkingDateIso: process.lastWorkingDate.toISOString(), completedTasks, taskCount: process.tasks.length, openBlockingTasks, overdueTasks, assetsOpen, accessOpen, openKnowledgeTransfers,
        finalSettlementStatus, finalSettlementNote: process.finalSettlementNote, finalSettlementPreparedById: process.finalSettlementPreparedById, finalSettlementPreparedAt: process.finalSettlementPreparedAt?.toISOString() ?? null,
        finalSettlementApprovedById: process.finalSettlementApprovedById, finalSettlementApprovedAt: process.finalSettlementApprovedAt?.toISOString() ?? null,
        finalSettlementSettledById: process.finalSettlementSettledById, finalSettlementSettledAt: process.finalSettlementSettledAt?.toISOString() ?? null,
        finalSettlementReversalReason: process.finalSettlementReversalReason, finalSettlementReversedById: process.finalSettlementReversedById, finalSettlementReversedAt: process.finalSettlementReversedAt?.toISOString() ?? null, finalSettlementClear,
        controlsClear, readyToClose, exitRisk,
        tasks: process.tasks.map((task) => ({ id: task.id, domain: task.domain, title: task.title, status: label(task.status), rawStatus: task.status, blocking: task.blocking, dueAt: formatDate(task.dueAt), dueAtIso: task.dueAt?.toISOString() ?? null })),
        assets: process.assets.map((asset) => ({ id: asset.id, assetTag: asset.assetTag, assetType: asset.assetType, serialNumber: asset.serialNumber, status: label(asset.status), rawStatus: asset.status, returnedAt: asset.returnedAt?.toISOString() ?? null, conditionNote: asset.conditionNote })),
        accessControls: process.accessRevocations.map((access) => ({ id: access.id, systemName: access.systemName, accountId: access.accountId, status: label(access.status), rawStatus: access.status, scheduledAt: access.scheduledAt?.toISOString() ?? null, revokedAt: access.revokedAt?.toISOString() ?? null, exceptionReason: access.exceptionReason })),
        knowledgeTransfers: process.knowledgeTransfers.map((transfer) => ({ id: transfer.id, title: transfer.title, description: transfer.description, recipientId: transfer.recipientId, status: label(transfer.status), rawStatus: transfer.status, dueAt: formatDate(transfer.dueAt), dueAtIso: transfer.dueAt?.toISOString() ?? null, completedAt: transfer.completedAt?.toISOString() ?? null }))
      };
    });

    return {
      openSeparations: rows.length,
      leavingThisWeek: processes.filter((process) => process.lastWorkingDate >= now && process.lastWorkingDate <= weekEnd).length,
      blockingTasks: rows.reduce((sum, row) => sum + row.openBlockingTasks + row.openKnowledgeTransfers, 0),
      overdueTasks: rows.reduce((sum, row) => sum + row.overdueTasks, 0),
      exitRiskProcesses: rows.filter((row) => row.exitRisk).length,
      readyToClose: rows.filter((row) => row.readyToClose).length,
      finalPayReview: rows.filter((row) => row.rawStatus === SeparationStatus.FINAL_PAY_REVIEW || (row.controlsClear && !row.finalSettlementClear)).length,
      processes: rows,
      eligibleEmployments: eligible.map((employment) => ({ id: employment.id, personId: employment.personId, employee: `${employment.person.givenName} ${employment.person.familyName}`, employeeNumber: employment.person.employeeNumber ?? "—", position: employment.position?.title ?? "Unassigned", department: employment.position?.orgUnit.name ?? "Unassigned" }))
    };
  });
}
