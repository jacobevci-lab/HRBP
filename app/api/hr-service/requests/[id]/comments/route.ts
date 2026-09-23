import { DataClassification, ServiceVisibility } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  const { id } = await params;
  const access = await hrServiceRequestWhere(db, ctx);
  const ticket = await db.hRServiceRequest.findFirst({ where: { ...access, id }, select: { id: true } });
  if (!ticket) return Response.json({ error: "Request not found." }, { status: 404 });
  const data = await db.hRServiceComment.findMany({
    where: {
      tenantId: ctx.tenantId,
      requestId: id,
      ...(isHRServiceSelfServiceRole(ctx.role) ? { visibility: ServiceVisibility.REQUESTOR } : {})
    },
    orderBy: { createdAt: "asc" }
  });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { body?: string; visibility?: ServiceVisibility };
  const text = body.body?.trim();
  if (!text) return Response.json({ error: "body is required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const access = await hrServiceRequestWhere(tx, ctx);
    const ticket = await tx.hRServiceRequest.findFirst({ where: { ...access, id }, select: { id: true } });
    if (!ticket) throw new Error("NOT_FOUND");
    const visibility = isHRServiceSelfServiceRole(ctx.role)
      ? ServiceVisibility.REQUESTOR
      : (body.visibility && Object.values(ServiceVisibility).includes(body.visibility) ? body.visibility : ServiceVisibility.REQUESTOR);
    const comment = await tx.hRServiceComment.create({ data: { tenantId: ctx.tenantId, requestId: id, authorId: ctx.actorId, body: text, visibility } });
    await appendAudit(tx, ctx, { action: "hr-service.comment-added", resourceType: "HRServiceComment", resourceId: comment.id, classification: DataClassification.CONFIDENTIAL });
    return comment;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!data) return Response.json({ error: "Request not found." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
