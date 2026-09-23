import { ServiceRequestStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import type { RequestContext } from "@/lib/request-context";

export type HRServiceEscalationFilter = "all" | "warning" | "breached" | "severe";

const terminalStatuses = [
  ServiceRequestStatus.RESOLVED,
  ServiceRequestStatus.CLOSED,
  ServiceRequestStatus.CANCELLED
];

export function normalizeHRServiceEscalationFilter(value: string | undefined): HRServiceEscalationFilter {
  return value === "warning" || value === "breached" || value === "severe" ? value : "all";
}

function priorityLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function slaLabel(value: Date | null, now: Date) {
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

function dateTimeLabel(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(value);
}

export async function getHRServiceEscalationLiveData(ctx: RequestContext, filter: HRServiceEscalationFilter) {
  if (isHRServiceSelfServiceRole(ctx.role)) return null;

  return withDb(async (db) => {
    const scope = await hrServiceRequestWhere(db, ctx);
    const requests = await db.hRServiceRequest.findMany({
      where: {
        AND: [
          scope,
          { status: { notIn: terminalStatuses } },
          { escalationLevel: { gte: 1 } }
        ]
      },
      orderBy: [{ escalationLevel: "desc" }, { slaDueAt: "asc" }, { createdAt: "asc" }],
      take: 250,
      select: {
        id: true,
        requestNumber: true,
        category: true,
        title: true,
        priority: true,
        status: true,
        queue: true,
        assigneeId: true,
        slaDueAt: true,
        escalationLevel: true,
        escalatedAt: true,
        escalationReason: true
      }
    });

    const now = new Date();
    const counts = {
      all: requests.length,
      warning: requests.filter((request) => request.escalationLevel === 1).length,
      breached: requests.filter((request) => request.escalationLevel >= 2).length,
      severe: requests.filter((request) => request.escalationLevel >= 3).length
    };

    const filtered = requests.filter((request) => {
      if (filter === "warning") return request.escalationLevel === 1;
      if (filter === "breached") return request.escalationLevel >= 2;
      if (filter === "severe") return request.escalationLevel >= 3;
      return true;
    });

    return {
      filter,
      counts,
      rows: filtered.map((request) => ({
        id: request.id,
        requestNumber: request.requestNumber,
        category: request.category,
        title: request.title,
        priority: priorityLabel(request.priority),
        queue: request.queue ?? "Unassigned",
        assigneeId: request.assigneeId ?? null,
        sla: slaLabel(request.slaDueAt, now),
        escalationLevel: request.escalationLevel,
        escalation: request.escalationLevel >= 3 ? "Severe" : request.escalationLevel >= 2 ? "Breached" : "Warning",
        escalationReason: request.escalationReason ?? "Escalation threshold reached",
        escalatedAt: dateTimeLabel(request.escalatedAt),
        status: priorityLabel(request.status)
      }))
    };
  });
}
