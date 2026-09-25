import { DataClassification, PlatformRole, ServiceVisibility } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
        select: { id: true, requestNumber: true, requestorId: true, assigneeId: true, firstResponseAt: true, status: true }
      });
      if (!ticket) throw new Error("NOT_FOUND");

      const selfService = isHRServiceSelfServiceRole(ctx.role);
      const visibility = selfService ? ServiceVisibility.REQUESTOR : requestedVisibility ?? ServiceVisibility.REQUESTOR;
      const comment = await tx.hRServiceComment.create({
        data: { tenantId: ctx.tenantId, requestId: id, authorId: ctx.actorId, body: text, visibility }
      });

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
          payload: { notificationState: "requestor-replied", requestNumber: ticket.requestNumber, status: ticket.status }
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
          payload: { notificationState: "staff-replied", requestNumber: ticket.requestNumber, status: ticket.status }
        });
      }

      return comment;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return Response.json({ error: "Request not found." }, { status: 404 });
    console.error("HR service comment creation failed", error);
    return Response.json({ error: "Comment could not be added." }, { status: 500 });
  }
}
