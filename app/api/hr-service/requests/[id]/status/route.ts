import { DataClassification, PlatformRole, ServiceRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canUseHRServiceQueue, hrServiceRequestWhere } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const staffOnly = new Set<PlatformRole>([PlatformRole.HRBP, PlatformRole.HR_OPERATIONS, PlatformRole.TENANT_ADMIN]);
const transitions: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  OPEN: [ServiceRequestStatus.TRIAGE, ServiceRequestStatus.CANCELLED],
  TRIAGE: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.WAITING_THIRD_PARTY, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  IN_PROGRESS: [ServiceRequestStatus.WAITING_EMPLOYEE, ServiceRequestStatus.WAITING_THIRD_PARTY, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  WAITING_EMPLOYEE: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  WAITING_THIRD_PARTY: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CANCELLED],
  RESOLVED: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.CLOSED],
  CLOSED: [], CANCELLED: []
};

function normalizeQueue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const key = value.trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,40}$/.test(key) ? key : undefined;
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
  if (!nextStatus) return Response.json({ error: "valid status is required." }, { status: 400 });
  const queueInput = normalizeQueue(body.queue);
  if (body.queue !== undefined && queueInput === undefined) return Response.json({ error: "queue must be null or a valid queue key." }, { status: 400 });
  const assigneeInput = body.assigneeId === undefined ? undefined : body.assigneeId === null || body.assigneeId === "" ? null : asIdentifier(body.assigneeId);
  if (body.assigneeId !== undefined && body.assigneeId !== null && body.assigneeId !== "" && !assigneeInput) return Response.json({ error: "assigneeId must be null or a valid identifier." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const access = await hrServiceRequestWhere(tx, ctx);
    const current = await tx.hRServiceRequest.findFirst({ where: { AND: [access, { id }] } });
    if (!current) throw new Error("NOT_FOUND");
    if (nextStatus !== current.status && !transitions[current.status].includes(nextStatus)) throw new Error("INVALID_TRANSITION");

    const desiredQueueKey = queueInput === undefined ? current.queue : queueInput;
    const queue = desiredQueueKey ? await canUseHRServiceQueue(tx, ctx, desiredQueueKey) : null;
    if (desiredQueueKey && !queue) throw new Error("QUEUE");
    const desiredAssigneeId = assigneeInput === undefined ? current.assigneeId : assigneeInput;

    if (desiredAssigneeId) {
      const assignee = await tx.userAccount.findFirst({ where: { id: desiredAssigneeId, tenantId: ctx.tenantId, active: true, role: { in: [...staffOnly] } }, select: { id: true } });
      if (!assignee) throw new Error("ASSIGNEE");
      if (queue) {
        const membership = await tx.hRServiceQueueMembership.findFirst({ where: { tenantId: ctx.tenantId, queueId: queue.id, userId: desiredAssigneeId }, select: { id: true } });
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
        resolvedAt: nextStatus === ServiceRequestStatus.RESOLVED ? now : (current.status === ServiceRequestStatus.RESOLVED && nextStatus === ServiceRequestStatus.IN_PROGRESS ? null : current.resolvedAt),
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
