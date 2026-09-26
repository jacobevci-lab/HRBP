import { Prisma, ServiceRequestStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import type { RequestContext } from "@/lib/request-context";

const waitingStatuses = new Set<ServiceRequestStatus>([
  ServiceRequestStatus.WAITING_EMPLOYEE,
  ServiceRequestStatus.WAITING_THIRD_PARTY
]);
const completedStatuses = new Set<ServiceRequestStatus>([
  ServiceRequestStatus.RESOLVED,
  ServiceRequestStatus.CLOSED,
  ServiceRequestStatus.CANCELLED
]);

const requestSelect = {
  id: true,
  requestNumber: true,
  title: true,
  category: true,
  status: true,
  priority: true,
  queue: true,
  assigneeId: true,
  slaDueAt: true,
  escalationLevel: true,
  updatedAt: true
} satisfies Prisma.HRServiceRequestSelect;

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(value);
}

function sla(value: Date | null, status: ServiceRequestStatus, now: Date) {
  if (waitingStatuses.has(status)) return "Paused";
  if (completedStatuses.has(status)) return "Completed";
  if (!value) return "No SLA";
  const minutes = Math.floor((value.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) {
    const overdue = Math.abs(minutes);
    if (overdue < 60) return `${overdue}m overdue`;
    if (overdue < 2_880) return `${Math.floor(overdue / 60)}h overdue`;
    return `${Math.floor(overdue / 1_440)}d overdue`;
  }
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 2_880) return `${Math.floor(minutes / 60)}h left`;
  return `${Math.floor(minutes / 1_440)}d left`;
}

export type HRServiceLifecycleRow = {
  id: string;
  requestNumber: string;
  title: string;
  category: string;
  status: string;
  rawStatus: ServiceRequestStatus;
  priority: string;
  queue: string;
  assigneeId: string | null;
  sla: string;
  slaPaused: boolean;
  escalationLevel: number;
  lastTransition: string;
  lastTransitionReason: string | null;
  lastTransitionActorId: string | null;
  lastTransitionAt: string | null;
  openPauseReason: string | null;
  openPauseAt: string | null;
};

export type HRServiceLifecycleData = {
  schemaReady: boolean;
  selfService: boolean;
  active: number;
  waiting: number;
  resolved: number;
  transitions: number;
  focusedRequestId: string | null;
  rows: HRServiceLifecycleRow[];
};

function normalizeFocus(value?: string) {
  const focus = value?.trim();
  return focus && focus.length <= 160 ? focus : "";
}

export async function getHRServiceLifecycleLiveData(ctx: RequestContext, focus?: string): Promise<HRServiceLifecycleData> {
  const selfService = isHRServiceSelfServiceRole(ctx.role);
  const focusValue = normalizeFocus(focus);
  try {
    return await withDb(async (db) => {
      const scope = await hrServiceRequestWhere(db, ctx);
      const requests = await db.hRServiceRequest.findMany({
        where: scope,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: requestSelect
      });

      let focusedRequest = focusValue
        ? requests.find((request) => request.id === focusValue || request.requestNumber.toLowerCase() === focusValue.toLowerCase()) ?? null
        : null;
      if (focusValue && !focusedRequest) {
        focusedRequest = await db.hRServiceRequest.findFirst({
          where: {
            AND: [
              scope,
              { OR: [{ id: focusValue }, { requestNumber: { equals: focusValue, mode: "insensitive" } }] }
            ]
          },
          select: requestSelect
        });
      }

      const visibleRequests = focusedRequest
        ? [focusedRequest, ...requests.filter((request) => request.id !== focusedRequest?.id)]
        : requests;
      const requestIds = visibleRequests.map((request) => request.id);
      const [transitions, pauses] = requestIds.length ? await Promise.all([
        db.hRServiceStatusTransition.findMany({
          where: { tenantId: ctx.tenantId, requestId: { in: requestIds } },
          orderBy: { occurredAt: "desc" },
          take: 500,
          select: { requestId: true, fromStatus: true, toStatus: true, reason: true, actorId: true, occurredAt: true }
        }),
        db.hRServiceSlaPause.findMany({
          where: { tenantId: ctx.tenantId, requestId: { in: requestIds }, resumedAt: null },
          orderBy: { pausedAt: "desc" },
          take: 100,
          select: { requestId: true, reason: true, pausedAt: true }
        })
      ]) : [[], []];

      const lastTransition = new Map<string, typeof transitions[number]>();
      for (const transition of transitions) if (!lastTransition.has(transition.requestId)) lastTransition.set(transition.requestId, transition);
      const openPause = new Map<string, typeof pauses[number]>();
      for (const pause of pauses) if (!openPause.has(pause.requestId)) openPause.set(pause.requestId, pause);
      const now = new Date();

      return {
        schemaReady: true,
        selfService,
        active: requests.filter((request) => !completedStatuses.has(request.status)).length,
        waiting: requests.filter((request) => waitingStatuses.has(request.status)).length,
        resolved: requests.filter((request) => request.status === ServiceRequestStatus.RESOLVED).length,
        transitions: transitions.length,
        focusedRequestId: focusedRequest?.id ?? null,
        rows: visibleRequests.map((request) => {
          const transition = lastTransition.get(request.id);
          const pause = openPause.get(request.id);
          return {
            id: request.id,
            requestNumber: request.requestNumber,
            title: request.title,
            category: request.category,
            status: label(request.status),
            rawStatus: request.status,
            priority: label(request.priority),
            queue: request.queue ?? "Unassigned",
            assigneeId: request.assigneeId,
            sla: sla(request.slaDueAt, request.status, now),
            slaPaused: waitingStatuses.has(request.status),
            escalationLevel: request.escalationLevel,
            lastTransition: transition ? `${label(transition.fromStatus)} → ${label(transition.toStatus)}` : "Created",
            lastTransitionReason: transition?.reason ?? null,
            lastTransitionActorId: transition?.actorId ?? null,
            lastTransitionAt: transition?.occurredAt.toISOString() ?? null,
            openPauseReason: pause?.reason ?? null,
            openPauseAt: pause?.pausedAt.toISOString() ?? null
          };
        })
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022")) {
      return { schemaReady: false, selfService, active: 0, waiting: 0, resolved: 0, transitions: 0, focusedRequestId: null, rows: [] };
    }
    throw error;
  }
}

export function formatHRServiceLifecycleDate(value: string | null) {
  if (!value) return "—";
  return dateTime(new Date(value));
}
