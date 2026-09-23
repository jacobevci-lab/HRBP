import { DataClassification, PolicyExceptionStatus, PolicyStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:write") && !can(ctx, "policies:approve")) return forbidden();
  const { id } = await params;
  const policy = await db.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  if (!policy) return Response.json({ error: "Policy not found." }, { status: 404 });
  const now = new Date();
  const data = await db.policyException.findMany({ where: { tenantId: ctx.tenantId, policyId: id }, orderBy: { createdAt: "desc" } });
  return Response.json({ data: data.map((item) => ({ ...item, effectiveStatus: item.status === PolicyExceptionStatus.APPROVED && item.expiresAt && item.expiresAt <= now ? PolicyExceptionStatus.EXPIRED : item.status })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { employmentId?: string; reason?: string; compensatingControl?: string; expiresAt?: string };
  const reason = body.reason?.trim();
  const compensatingControl = body.compensatingControl?.trim();
  if (!reason || !compensatingControl || !body.expiresAt) return Response.json({ error: "reason, compensatingControl and expiresAt are required." }, { status: 400 });
  const expiresAt = new Date(body.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return Response.json({ error: "expiresAt must be a future date." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const policy = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED }, select: { id: true } });
    if (!policy) throw new Error("POLICY");
    if (body.employmentId) {
      const employment = await tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!employment) throw new Error("EMPLOYMENT");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, body.employmentId)) throw new Error("OUT_OF_SCOPE");
    }
    const exception = await tx.policyException.create({
      data: {
        tenantId: ctx.tenantId,
        policyId: id,
        employmentId: body.employmentId,
        reason,
        compensatingControl,
        requestedById: ctx.actorId,
        expiresAt,
        status: PolicyExceptionStatus.REQUESTED,
        active: false
      }
    });
    await appendAudit(tx, ctx, { action: "policy.exception-requested", resourceType: "PolicyException", resourceId: exception.id, classification: DataClassification.CONFIDENTIAL, purpose: "Time-bound policy exception review" });
    return exception;
  }).catch((error) => error instanceof Error && ["POLICY", "EMPLOYMENT", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "POLICY") return Response.json({ error: "Published policy not found." }, { status: 404 });
  if (result === "EMPLOYMENT") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  if (result === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  return Response.json({ data: result }, { status: 201 });
}
