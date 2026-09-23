import { DataClassification, PlatformRole, ServiceRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canUseHRServiceQueue, hrServiceRequestWhere } from "@/lib/hr-service-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffOnly = new Set<PlatformRole>([PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN]);
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
function queueKey(value: string) { return value.trim().toUpperCase().replace(/\s+/g, "_"); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !staffOnly.has(ctx.role)) return forbidden();
  const { id } = await params;
  const body = await request.json() as { status?: ServiceRequestStatus; assigneeId?: string | null; queue?: string | null };
  if (!body.status || !Object.values(ServiceRequestStatus).includes(body.status)) return Response.json({ error: "valid status is required." }, { status: 400 });
  const nextStatus: ServiceRequestStatus = body.status;

  const data = await db.$transaction(async (tx) => {
    const access = await hrServiceRequestWhere(tx, ctx);
    const current = await tx.hRServiceRequest.findFirst({ where: { AND: [access, { id }] } });
    if (!current) throw new Error("NOT_FOUND");
    if (nextStatus !== current.status && !transitions[current.status].includes(nextStatus)) throw new Error("INVALID_TRANSITION");

    const desiredQueueKey = body.queue === null ? null : body.queue !== undefined ? queueKey(body.queue) : current.queue;
    const queue = desiredQueueKey ? await canUseHRServiceQueue(tx, ctx, desiredQueueKey) : null;
    if (desiredQueueKey && !queue) throw new Error("QUEUE");

    const desiredAssigneeId = body.assigneeId === null ? null : body.assigneeId ?? current.assigneeId;
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
    const record = await tx.hRServiceRequest.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        assigneeId: desiredAssigneeId,
        queue: queue?.key ?? null,
        firstResponseAt: current.firstResponseAt ?? now,
        resolvedAt: nextStatus === ServiceRequestStatus.RESOLVED
          ? now
          : (current.status === ServiceRequestStatus.RESOLVED && nextStatus === ServiceRequestStatus.IN_PROGRESS ? null : current.resolvedAt),
        closedAt: nextStatus === ServiceRequestStatus.CLOSED ? now : current.closedAt
      }
    });
    await appendAudit(tx, ctx, { action: `hr-service.${nextStatus.toLowerCase()}`, resourceType: "HRServiceRequest", resourceId: id, classification: DataClassification.CONFIDENTIAL, purpose: queue ? `Service transition in ${queue.key} queue` : "Service status transition" });
    return record;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION", "QUEUE", "ASSIGNEE", "ASSIGNEE_QUEUE"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Request not found in your authorized service scope." }, { status: 404 });
  if (data === "INVALID_TRANSITION") return Response.json({ error: "The requested service status transition is not allowed." }, { status: 409 });
  if (data === "QUEUE") return forbidden("The selected HR service queue is unavailable or not delegated to you.");
  if (data === "ASSIGNEE") return Response.json({ error: "Assignee must be an active HR service staff user in this tenant." }, { status: 400 });
  if (data === "ASSIGNEE_QUEUE") return Response.json({ error: "Assignee must be a member of the selected HR service queue." }, { status: 400 });
  return Response.json({ data });
}
