import { DataClassification, PlatformRole, Prisma, ServicePriority, ServiceRequestStatus, ServiceVisibility } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const commentTerminalStatuses = new Set<ServiceRequestStatus>([ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED]);
const fallbackSlaMinutes: Record<ServicePriority, number> = { LOW: 4320, MEDIUM: 1440, HIGH: 480, CRITICAL: 240 };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid request id is required." }, { status: 400 });
  const access = await hrServiceRequestWhere(db, ctx);
  const ticket = await db.hRServiceRequest.findFirst({ where: { AND: [access, { id }] }, select: { id: true } });
  if (!ticket) return Response.json({ error: "Request not found." }, { status: 404 });
  const data = await db.hRServiceComment.findMany({
    where: {
      tenantId: ctx.tenantId,
      requestId: id,
      ...(isHRServiceSelfServiceRole(ctx.role) ? { visibility: ServiceVisibility.REQUESTOR } : {})
    },
    orderBy: { createdAt: "asc" },
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid request id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const text = asText(body.body, 4000);
  if (!text) return Response.json({ error: "body must be between 1 and 4000 characters." }, { status: 400 });
  const requestedVisibility = body.visibility === undefined ? null : asEnumValue(body.visibility, Object.values(ServiceVisibility));
  if (body.visibility !== undefined && !requestedVisibility) return Response.json({ error: "visibility is invalid." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const access = await hrServiceRequestWhere(tx, ctx);
      const ticket = await tx.hRServiceRequest.findFirst({
        where: { AND: [access, { id }] },
        select: { id: true, requestNumber: true, requestorId: true, assigneeId: true, firstResponseAt: true, status: true, priority: true, queue: true, updatedAt: true }
      });
      if (!ticket) throw new Error("NOT_FOUND");
      if (commentTerminalStatuses.has(ticket.status)) throw new Error("TERMINAL");

      const selfService = isHRServiceSelfServiceRole(ctx.role);
      const visibility = selfService ? ServiceVisibility.REQUESTOR : requestedVisibility ?? ServiceVisibility.REQUESTOR;
      const comment = await tx.hRServiceComment.create({
        data: { tenantId: ctx.tenantId, requestId: id, authorId: ctx.actorId, body: text, visibility }
      });

      let effectiveStatus = ticket.status;
      if (selfService && ticket.status === ServiceRequestStatus.RESOLVED) {
        const queue = ticket.queue ? await tx.hRServiceQueue.findFirst({
          where: { tenantId: ctx.tenantId, key: ticket.queue, active: true },
          select: { defaultSlaMinutes: true }
        }) : null;
        const renewedMinutes = queue?.defaultSlaMinutes ?? fallbackSlaMinutes[ticket.priority];
        const reopened = await tx.hRServiceRequest.updateMany({
          where: { id: ticket.id, tenantId: ctx.tenantId, status: ServiceRequestStatus.RESOLVED, updatedAt: ticket.updatedAt },
          data: {
            status: ServiceRequestStatus.IN_PROGRESS,
            resolvedAt: null,
            slaDueAt: new Date(comment.createdAt.getTime() + renewedMinutes * 60_000),
            escalationLevel: 0,
            escalatedAt: null,
            escalationReason: null
          }
        });
        if (reopened.count !== 1) throw new Error("STATE_CONFLICT");
        effectiveStatus = ServiceRequestStatus.IN_PROGRESS;
        await tx.hRServiceStatusTransition.create({
          data: {
            tenantId: ctx.tenantId,
            requestId: ticket.id,
            fromStatus: ServiceRequestStatus.RESOLVED,
            toStatus: ServiceRequestStatus.IN_PROGRESS,
            reason: "Requestor reply reopened a resolved request",
            actorId: ctx.actorId,
            queue: ticket.queue,
            assigneeId: ticket.assigneeId,
            occurredAt: comment.createdAt
          }
        });
        await appendAudit(tx, ctx, {
          action: "hr-service.requestor-reopened",
          resourceType: "HRServiceRequest",
          resourceId: ticket.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: "Requestor reply reopened a previously resolved service request with a fresh SLA window"
        });
        await tx.notificationOutbox.updateMany({
          where: { tenantId: ctx.tenantId, resourceType: "HRServiceRequest", resourceId: ticket.id, eventType: "HR_SERVICE_ESCALATED", readAt: null },
          data: { readAt: comment.createdAt }
        });
      }

      const staffResponse = !selfService && visibility === ServiceVisibility.REQUESTOR;
      if (staffResponse && !ticket.firstResponseAt) {
        await tx.hRServiceRequest.updateMany({
          where: { id: ticket.id, tenantId: ctx.tenantId, firstResponseAt: null },
          data: { firstResponseAt: comment.createdAt }
        });
      }

      await appendAudit(tx, ctx, {
        action: visibility === ServiceVisibility.PRIVATE_NOTE ? "hr-service.private-note-added" : "hr-service.comment-added",
        resourceType: "HRServiceComment",
        resourceId: comment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: visibility === ServiceVisibility.REQUESTOR ? "Requestor-visible HR service conversation" : "Restricted HR service handling note"
      });

      if (selfService) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "HR_SERVICE_REQUESTOR_REPLIED",
          ...(ticket.assigneeId ? { recipientUserId: ticket.assigneeId } : { recipientRole: PlatformRole.HR_OPERATIONS }),
          templateKey: "hr-service.requestor-replied",
          resourceType: "HRServiceRequest",
          resourceId: ticket.id,
          dedupeKey: `hr-service:${ticket.id}:requestor-reply:${comment.id}`,
          classification: DataClassification.CONFIDENTIAL,
          payload: { notificationState: "requestor-replied", requestNumber: ticket.requestNumber, status: effectiveStatus }
        });
      } else if (visibility === ServiceVisibility.REQUESTOR) {
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "HR_SERVICE_STAFF_REPLIED",
          recipientUserId: ticket.requestorId,
          templateKey: "hr-service.staff-replied",
          resourceType: "HRServiceRequest",
          resourceId: ticket.id,
          dedupeKey: `hr-service:${ticket.id}:staff-reply:${comment.id}`,
          classification: DataClassification.CONFIDENTIAL,
          payload: { notificationState: "staff-replied", requestNumber: ticket.requestNumber, status: effectiveStatus }
        });
      }

      return comment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Request not found." }, { status: 404 });
    if (code === "TERMINAL") return Response.json({ error: "Closed or cancelled requests are read-only. Reopen a resolved request before continuing work." }, { status: 409 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return Response.json({ error: "The request changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("HR service comment creation failed", error);
    return Response.json({ error: "Comment could not be added." }, { status: 500 });
  }
}
