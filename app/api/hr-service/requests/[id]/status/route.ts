import { DataClassification, PlatformRole, Prisma, ServiceRequestStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canUseHRServiceQueue, hrServiceRequestWhere } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffOnly = new Set<PlatformRole>([PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN]);
const waitingStatuses = new Set<ServiceRequestStatus>([ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.WAITING_THIRD_PARTY]);
const terminalStatuses = new Set<ServiceRequestStatus>([ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED]);
const fallbackSlaMinutes: Record<string, number> = { LOW: 4320, MEDIUM: 1440, HIGH: 480, CRITICAL: 240 };
const transitions: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  OPEN: [ServiceRequestStatus.TRIAGE, ServiceRequestStatus.CANCELLED],
  TRIAGE: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.WAITING_THIRD_PARTY, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  IN_PROGRESS: [ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.WAITING_THIRD_PARTY, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  WAITING_EMPLOYEE: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  WAITING_THIRD_PARTY: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  RESOLVED: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.CLOSED],
  CLOSED: [],
  CANCELLED: []
};

function normalizeQueue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const key = value.trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,40}$/.test(key) ? key : undefined;
}

function requiresReason(current: ServiceRequestStatus, next: ServiceRequestStatus) {
  return waitingStatuses.has(next) || terminalStatuses.has(next) || (current === ServiceRequestStatus.RESOLVED && next === ServiceRequestStatus.IN_PROGRESS);
}

function statusLabel(value: ServiceRequestStatus) {
  return value.toLowerCase().replace(/_/g, " ");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !staffOnly.has(ctx.role)) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid request id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const nextStatus = asEnumValue(body.status, Object.values(ServiceRequestStatus));
  if (!nextStatus) return Response.json({ error: "A valid status is required." }, { status: 400 });
  const reasonInput = asOptionalText(body.reason, 2000);
  if (reasonInput === null) return Response.json({ error: "reason must be at most 2000 characters." }, { status: 400 });
  const reason = reasonInput ?? null;
  const queueInput = normalizeQueue(body.queue);
  if (body.queue !== undefined && queueInput === undefined) return Response.json({ error: "queue must be null or a valid queue key." }, { status: 400 });
  const assigneeInput = body.assigneeId === undefined ? undefined : body.assigneeId === null || body.assigneeId === "" ? null : asIdentifier(body.assigneeId);
  if (body.assigneeId !== undefined && body.assigneeId !== null && body.assigneeId !== "" && !assigneeInput) return Response.json({ error: "assigneeId must be null or a valid identifier." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const access = await hrServiceRequestWhere(tx, ctx);
      const current = await tx.hRServiceRequest.findFirst({
        where: { AND: [access, { id }] },
        select: {
          id: true,
          requestNumber: true,
          requestorId: true,
          status: true,
          priority: true,
          queue: true,
          assigneeId: true,
          slaDueAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          closedAt: true,
          escalationLevel: true,
          updatedAt: true
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (nextStatus !== current.status && !transitions[current.status].includes(nextStatus)) throw new Error("INVALID_TRANSITION");
      if (nextStatus !== current.status && requiresReason(current.status, nextStatus) && (!reason || reason.length < 10)) throw new Error("REASON");

      const desiredQueueKey = queueInput === undefined ? current.queue : queueInput;
      const queue = desiredQueueKey ? await canUseHRServiceQueue(tx, ctx, desiredQueueKey) : null;
      if (desiredQueueKey && !queue) throw new Error("QUEUE");
      const desiredAssigneeId = assigneeInput === undefined ? current.assigneeId : assigneeInput;

      if (desiredAssigneeId) {
        const assignee = await tx.userAccount.findFirst({
          where: { id: desiredAssigneeId, tenantId: ctx.tenantId, active: true, role: { in: [...staffOnly] } },
          select: { id: true }
        });
        if (!assignee) throw new Error("ASSIGNEE");
        if (queue) {
          const membership = await tx.hRServiceQueueMembership.findFirst({
            where: { tenantId: ctx.tenantId, queueId: queue.id, userId: desiredAssigneeId },
            select: { id: true }
          });
          if (!membership) throw new Error("ASSIGNEE_QUEUE");
        }
      }

      const now = new Date();
      const statusChanged = nextStatus !== current.status;
      const routingChanged = desiredQueueKey !== current.queue || desiredAssigneeId !== current.assigneeId;
      if (!statusChanged && !routingChanged) throw new Error("NO_CHANGE");

      const enteringWait = statusChanged && !waitingStatuses.has(current.status) && waitingStatuses.has(nextStatus);
      const leavingWait = statusChanged && waitingStatuses.has(current.status) && !waitingStatuses.has(nextStatus);
      const reopening = current.status === ServiceRequestStatus.RESOLVED && nextStatus === ServiceRequestStatus.IN_PROGRESS;
      let slaDueAt = current.slaDueAt;
      let activePause: { id: string; remainingMinutes: number | null } | null = null;

      if (enteringWait) {
        const remainingMinutes = current.slaDueAt ? Math.max(0, Math.ceil((current.slaDueAt.getTime() - now.getTime()) / 60_000)) : null;
        await tx.hRServiceSlaPause.create({
          data: {
            tenantId: ctx.tenantId,
            requestId: current.id,
            pausedFromStatus: current.status,
            reason: reason!,
            pausedById: ctx.actorId,
            pausedAt: now,
            remainingMinutes
          }
        });
        slaDueAt = null;
      } else if (leavingWait) {
        activePause = await tx.hRServiceSlaPause.findFirst({
          where: { tenantId: ctx.tenantId, requestId: current.id, resumedAt: null },
          orderBy: { pausedAt: "desc" },
          select: { id: true, remainingMinutes: true }
        });
        const remainingMinutes = activePause?.remainingMinutes ?? queue?.defaultSlaMinutes ?? fallbackSlaMinutes[current.priority] ?? 1440;
        slaDueAt = new Date(now.getTime() + Math.max(0, remainingMinutes) * 60_000);
      }

      if (reopening) {
        const renewedMinutes = queue?.defaultSlaMinutes ?? fallbackSlaMinutes[current.priority] ?? 1440;
        slaDueAt = new Date(now.getTime() + renewedMinutes * 60_000);
      }

      const shouldResetEscalation = enteringWait || reopening || terminalStatuses.has(nextStatus);
      const establishesFirstResponse = [ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED].includes(nextStatus);
      const updated = await tx.hRServiceRequest.updateMany({
        where: { id: current.id, tenantId: ctx.tenantId, status: current.status, updatedAt: current.updatedAt },
        data: {
          status: nextStatus,
          assigneeId: desiredAssigneeId,
          queue: queue?.key ?? null,
          slaDueAt,
          firstResponseAt: current.firstResponseAt ?? (establishesFirstResponse ? now : null),
          resolvedAt: nextStatus === ServiceRequestStatus.RESOLVED ? now : (reopening ? null : current.resolvedAt),
          closedAt: nextStatus === ServiceRequestStatus.CLOSED ? now : current.closedAt,
          ...(shouldResetEscalation ? { escalationLevel: 0, escalatedAt: null, escalationReason: null } : {})
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      if (activePause) {
        await tx.hRServiceSlaPause.updateMany({
          where: { id: activePause.id, tenantId: ctx.tenantId, resumedAt: null },
          data: { resumedById: ctx.actorId, resumedAt: now }
        });
      }

      if (statusChanged) {
        await tx.hRServiceStatusTransition.create({
          data: {
            tenantId: ctx.tenantId,
            requestId: current.id,
            fromStatus: current.status,
            toStatus: nextStatus,
            reason,
            actorId: ctx.actorId,
            queue: queue?.key ?? null,
            assigneeId: desiredAssigneeId,
            occurredAt: now
          }
        });
        await appendAudit(tx, ctx, {
          action: `hr-service.${nextStatus.toLowerCase()}`,
          resourceType: "HRServiceRequest",
          resourceId: id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: `${statusLabel(current.status)} -> ${statusLabel(nextStatus)}${reason ? `; reason: ${reason}` : ""}${queue ? `; queue: ${queue.key}` : ""}`
        });
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "HR_SERVICE_STATUS_CHANGED",
          recipientUserId: current.requestorId,
          templateKey: "hr-service.status-changed",
          resourceType: "HRServiceRequest",
          resourceId: current.id,
          dedupeKey: `hr-service:${current.id}:status:${nextStatus}:${now.toISOString()}`,
          classification: DataClassification.CONFIDENTIAL,
          payload: {
            notificationState: "status-changed",
            requestNumber: current.requestNumber,
            fromStatus: current.status,
            toStatus: nextStatus,
            ...(reason ? { reason } : {}),
            ...(queue?.key ? { queue: queue.key } : {}),
            ...(slaDueAt ? { slaDueAt: slaDueAt.toISOString() } : {})
          }
        });
      } else {
        await appendAudit(tx, ctx, {
          action: "hr-service.routing-updated",
          resourceType: "HRServiceRequest",
          resourceId: id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: `Service routing updated${queue ? `; queue: ${queue.key}` : "; unqueued"}${desiredAssigneeId ? `; assignee: ${desiredAssigneeId}` : "; unassigned"}`
        });
      }

      if (desiredAssigneeId && desiredAssigneeId !== current.assigneeId) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "HR_SERVICE_ASSIGNED",
          recipientUserId: desiredAssigneeId,
          templateKey: "hr-service.assigned",
          resourceType: "HRServiceRequest",
          resourceId: current.id,
          dedupeKey: `hr-service:${current.id}:assigned:${desiredAssigneeId}:${now.toISOString()}`,
          classification: DataClassification.CONFIDENTIAL,
          payload: {
            notificationState: "assigned",
            requestNumber: current.requestNumber,
            status: nextStatus,
            ...(queue?.key ? { queue: queue.key } : {})
          }
        });
      }

      if (shouldResetEscalation) {
        await tx.notificationOutbox.updateMany({
          where: { tenantId: ctx.tenantId, resourceType: "HRServiceRequest", resourceId: current.id, eventType: "HR_SERVICE_ESCALATED", readAt: null },
          data: { readAt: now }
        });
      }

      const record = await tx.hRServiceRequest.findUnique({ where: { id: current.id } });
      if (!record) throw new Error("NOT_FOUND");
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Request not found in your authorized service scope." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested service status transition is not allowed." }, { status: 409 });
    if (code === "REASON") return Response.json({ error: "A reason of 10–2000 characters is required for waiting, resolution, closure, cancellation and reopen transitions." }, { status: 400 });
    if (code === "NO_CHANGE") return Response.json({ error: "No status or routing change was requested." }, { status: 409 });
    if (code === "QUEUE") return forbidden("The selected HR service queue is unavailable or not delegated to you.");
    if (code === "ASSIGNEE") return Response.json({ error: "Assignee must be an active HR service staff user in this tenant." }, { status: 400 });
    if (code === "ASSIGNEE_QUEUE") return Response.json({ error: "Assignee must be a member of the selected HR service queue." }, { status: 400 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return Response.json({ error: "The request changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("HR service status transition failed", error);
    return Response.json({ error: "HR service request could not be updated." }, { status: 500 });
  }
}
