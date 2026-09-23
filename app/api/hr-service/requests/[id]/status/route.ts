import { DataClassification, PlatformRole, ServiceRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { hrServiceRequestWhere } from "@/lib/hr-service-access";
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !staffOnly.has(ctx.role)) return forbidden();
  const { id } = await params;
  const body = await request.json() as { status?: ServiceRequestStatus; assigneeId?: string; queue?: string };
  if (!body.status || !Object.values(ServiceRequestStatus).includes(body.status)) return Response.json({ error: "valid status is required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const access = await hrServiceRequestWhere(tx, ctx);
    const current = await tx.hRServiceRequest.findFirst({ where: { ...access, id } });
    if (!current) throw new Error("NOT_FOUND");
    if (body.status !== current.status && !transitions[current.status].includes(body.status)) throw new Error("INVALID_TRANSITION");

    if (body.assigneeId) {
      const assignee = await tx.userAccount.findFirst({
        where: { id: body.assigneeId, tenantId: ctx.tenantId, active: true, role: { in: [...staffOnly] } },
        select: { id: true }
      });
      if (!assignee) throw new Error("ASSIGNEE");
    }

    const now = new Date();
    const record = await tx.hRServiceRequest.update({
      where: { id: current.id },
      data: {
        status: body.status,
        assigneeId: body.assigneeId ?? current.assigneeId,
        queue: body.queue?.trim() || current.queue,
        firstResponseAt: current.firstResponseAt ?? now,
        resolvedAt: body.status === ServiceRequestStatus.RESOLVED
          ? now
          : (current.status === ServiceRequestStatus.RESOLVED && body.status === ServiceRequestStatus.IN_PROGRESS ? null : current.resolvedAt),
        closedAt: body.status === ServiceRequestStatus.CLOSED ? now : current.closedAt
      }
    });
    await appendAudit(tx, ctx, { action: `hr-service.${body.status.toLowerCase()}`, resourceType: "HRServiceRequest", resourceId: id, classification: DataClassification.CONFIDENTIAL });
    return record;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION", "ASSIGNEE"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Request not found in your authorized service scope." }, { status: 404 });
  if (data === "INVALID_TRANSITION") return Response.json({ error: "The requested service status transition is not allowed." }, { status: 409 });
  if (data === "ASSIGNEE") return Response.json({ error: "Assignee must be an active HR service staff user in this tenant." }, { status: 400 });
  return Response.json({ data });
}
