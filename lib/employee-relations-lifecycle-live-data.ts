import { AllegationStatus, CaseActionStatus, CaseAppealStatus, CaseStatus, Prisma } from "@prisma/client";
import { withDb } from "@/lib/db";
import { getCaseWallCase, listCaseWallCases } from "@/lib/case-wall";
import { asIdentifier, asText } from "@/lib/input-validation";
import type { RequestContext } from "@/lib/request-context";

const activeAllegations = new Set<AllegationStatus>([AllegationStatus.OPEN, AllegationStatus.INVESTIGATING]);
const activeActions = new Set<CaseActionStatus>([CaseActionStatus.OPEN, CaseActionStatus.IN_PROGRESS]);
const activeAppeals = new Set<CaseAppealStatus>([CaseAppealStatus.SUBMITTED, CaseAppealStatus.REVIEWING]);

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export type EmployeeRelationsLifecycleFocus = {
  query?: string;
  caseId?: string;
  actionId?: string;
  appealId?: string;
};

export type EmployeeRelationsActionRow = {
  id: string;
  actionType: string;
  status: CaseActionStatus;
  statusLabel: string;
  ownerId: string;
  dueAt: string | null;
  focused: boolean;
};

export type EmployeeRelationsLifecycleRow = {
  id: string;
  caseNumber: string;
  caseType: string;
  title: string;
  status: CaseStatus;
  statusLabel: string;
  openedAt: string;
  ownerUserId: string;
  openAllegations: number;
  openActions: number;
  activeAppeals: number;
  findings: number;
  readyToResolve: boolean;
  readyToClose: boolean;
  lastTransition: string | null;
  lastTransitionActorId: string | null;
  lastTransitionAt: string | null;
  focused: boolean;
  actions: EmployeeRelationsActionRow[];
};

export type EmployeeRelationsLifecycleData = {
  schemaReady: boolean;
  total: number;
  investigating: number;
  actionRequired: number;
  resolutionBlocked: number;
  readyToClose: number;
  focusCaseId: string | null;
  focusKind: "case" | "action" | "appeal" | null;
  focusResourceId: string | null;
  rows: EmployeeRelationsLifecycleRow[];
};

const emptyData = (schemaReady: boolean): EmployeeRelationsLifecycleData => ({
  schemaReady,
  total: 0,
  investigating: 0,
  actionRequired: 0,
  resolutionBlocked: 0,
  readyToClose: 0,
  focusCaseId: null,
  focusKind: null,
  focusResourceId: null,
  rows: []
});

export async function getEmployeeRelationsLifecycleLiveData(ctx: RequestContext, focus: EmployeeRelationsLifecycleFocus = {}): Promise<EmployeeRelationsLifecycleData> {
  try {
    return await withDb(async (db) => {
      const cases = await listCaseWallCases(ctx, db);
      const requestedCaseId = asIdentifier(focus.caseId);
      const requestedActionId = asIdentifier(focus.actionId);
      const requestedAppealId = asIdentifier(focus.appealId);
      const query = asText(focus.query, 160) ?? "";

      let focusCaseId: string | null = requestedCaseId;
      let focusKind: EmployeeRelationsLifecycleData["focusKind"] = requestedCaseId ? "case" : null;
      let focusResourceId: string | null = requestedCaseId;

      if (requestedActionId) {
        const action = await db.caseAction.findFirst({ where: { id: requestedActionId, tenantId: ctx.tenantId }, select: { caseId: true } });
        if (action && await getCaseWallCase(ctx, action.caseId, db)) {
          focusCaseId = action.caseId;
          focusKind = "action";
          focusResourceId = requestedActionId;
        }
      } else if (requestedAppealId) {
        const appeal = await db.caseAppeal.findFirst({ where: { id: requestedAppealId, tenantId: ctx.tenantId }, select: { caseId: true } });
        if (appeal && await getCaseWallCase(ctx, appeal.caseId, db)) {
          focusCaseId = appeal.caseId;
          focusKind = "appeal";
          focusResourceId = requestedAppealId;
        }
      }

      if (!focusCaseId && query) {
        const normalized = query.toLocaleLowerCase("en-US");
        const matched = cases.find((item) => item.caseNumber.toLocaleLowerCase("en-US") === normalized || item.id === query)
          ?? cases.find((item) => item.title.toLocaleLowerCase("en-US").includes(normalized));
        if (matched) {
          focusCaseId = matched.id;
          focusKind = "case";
          focusResourceId = matched.id;
        }
      }

      let focusedCase = focusCaseId ? cases.find((item) => item.id === focusCaseId) : undefined;
      if (focusCaseId && !focusedCase) focusedCase = await getCaseWallCase(ctx, focusCaseId, db) ?? undefined;
      if (requestedCaseId && !focusedCase && focusKind === "case") {
        focusCaseId = null;
        focusKind = null;
        focusResourceId = null;
      }

      const ordered = focusedCase
        ? [focusedCase, ...cases.filter((item) => item.id !== focusedCase!.id)]
        : cases;
      const visible = ordered.slice(0, 100);
      const caseIds = visible.map((item) => item.id);
      if (!caseIds.length) return emptyData(true);

      const [allegations, actions, appeals, findings, transitions] = await Promise.all([
        db.caseAllegation.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true, status: true }, take: 1000 }),
        db.caseAction.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], select: { id: true, caseId: true, actionType: true, status: true, ownerId: true, dueAt: true }, take: 1000 }),
        db.caseAppeal.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { id: true, caseId: true, status: true }, take: 500 }),
        db.caseFinding.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, select: { caseId: true }, take: 1000 }),
        db.employeeCaseStatusTransition.findMany({ where: { tenantId: ctx.tenantId, caseId: { in: caseIds } }, orderBy: { occurredAt: "desc" }, select: { caseId: true, fromStatus: true, toStatus: true, actorId: true, occurredAt: true }, take: 500 })
      ]);

      if (focusKind === "appeal" && focusResourceId && !appeals.some((item) => item.id === focusResourceId)) {
        focusCaseId = null;
        focusKind = null;
        focusResourceId = null;
      }
      if (focusKind === "action" && focusResourceId && !actions.some((item) => item.id === focusResourceId)) {
        focusCaseId = null;
        focusKind = null;
        focusResourceId = null;
      }

      const lastTransition = new Map<string, typeof transitions[number]>();
      for (const transition of transitions) if (!lastTransition.has(transition.caseId)) lastTransition.set(transition.caseId, transition);
      const rows = visible.map<EmployeeRelationsLifecycleRow>((caseRecord) => {
        const openAllegations = allegations.filter((item) => item.caseId === caseRecord.id && activeAllegations.has(item.status)).length;
        const caseActions = actions.filter((item) => item.caseId === caseRecord.id);
        const openActions = caseActions.filter((item) => activeActions.has(item.status)).length;
        const activeAppealCount = appeals.filter((item) => item.caseId === caseRecord.id && activeAppeals.has(item.status)).length;
        const findingCount = findings.filter((item) => item.caseId === caseRecord.id).length;
        const transition = lastTransition.get(caseRecord.id);
        const readyToResolve = [CaseStatus.INVESTIGATING, CaseStatus.ACTION_REQUIRED].includes(caseRecord.status) && openAllegations === 0 && openActions === 0;
        const readyToClose = caseRecord.status === CaseStatus.RESOLVED && openAllegations === 0 && openActions === 0 && activeAppealCount === 0;
        return {
          id: caseRecord.id,
          caseNumber: caseRecord.caseNumber,
          caseType: caseRecord.caseType,
          title: caseRecord.title,
          status: caseRecord.status,
          statusLabel: label(caseRecord.status),
          openedAt: caseRecord.openedAt.toISOString(),
          ownerUserId: caseRecord.ownerUserId,
          openAllegations,
          openActions,
          activeAppeals: activeAppealCount,
          findings: findingCount,
          readyToResolve,
          readyToClose,
          lastTransition: transition ? `${label(transition.fromStatus)} → ${label(transition.toStatus)}` : null,
          lastTransitionActorId: transition?.actorId ?? null,
          lastTransitionAt: transition?.occurredAt.toISOString() ?? null,
          focused: caseRecord.id === focusCaseId,
          actions: caseActions.slice(0, 12).map((action) => ({
            id: action.id,
            actionType: action.actionType,
            status: action.status,
            statusLabel: label(action.status),
            ownerId: action.ownerId,
            dueAt: action.dueAt?.toISOString() ?? null,
            focused: focusKind === "action" && focusResourceId === action.id
          }))
        };
      });

      return {
        schemaReady: true,
        total: rows.length,
        investigating: rows.filter((row) => row.status === CaseStatus.INVESTIGATING).length,
        actionRequired: rows.filter((row) => row.status === CaseStatus.ACTION_REQUIRED).length,
        resolutionBlocked: rows.filter((row) => [CaseStatus.INVESTIGATING, CaseStatus.ACTION_REQUIRED].includes(row.status) && !row.readyToResolve).length,
        readyToClose: rows.filter((row) => row.readyToClose).length,
        focusCaseId,
        focusKind,
        focusResourceId,
        rows
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022")) return emptyData(false);
    throw error;
  }
}
