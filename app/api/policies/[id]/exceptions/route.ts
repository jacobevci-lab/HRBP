import { DataClassification, EmploymentStatus, PolicyExceptionStatus, PolicyStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function effectiveStatus(status: PolicyExceptionStatus, expiresAt: Date | null, now = new Date()) {
  return status === PolicyExceptionStatus.APPROVED && expiresAt && expiresAt < now ? PolicyExceptionStatus.EXPIRED : status;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:read")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });
  const manage = can(ctx, "policies:write") || can(ctx, "policies:approve");
  const policy = await db.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  if (!policy) return Response.json({ error: "Policy not found." }, { status: 404 });
  if (!manage && !ctx.employmentId) return Response.json({ data: [] });
  const data = await db.policyException.findMany({ where: { tenantId: ctx.tenantId, policyId: id, ...(!manage ? { employmentId: ctx.employmentId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  const now = new Date();
  return Response.json({ data: data.map((item) => ({ ...item, effectiveStatus: effectiveStatus(item.status, item.expiresAt, now) })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:read")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const reason = asText(body.reason, 2000);
  const compensatingControl = asOptionalText(body.compensatingControl, 2000);
  if (!reason || compensatingControl === null) return Response.json({ error: "A valid reason and optional compensatingControl are required." }, { status: 400 });
  const manage = can(ctx, "policies:write") || can(ctx, "policies:approve");
  const employmentId = manage ? asIdentifier(body.employmentId) : ctx.employmentId;
  if (!employmentId) return Response.json({ error: "A valid employmentId is required for this policy exception." }, { status: 400 });
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt.trim() ? new Date(body.expiresAt) : null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "" && (typeof body.expiresAt !== "string" || !expiresAt || Number.isNaN(expiresAt.getTime()))) return Response.json({ error: "expiresAt must be a valid date or null." }, { status: 400 });
  if (expiresAt && expiresAt <= new Date()) return Response.json({ error: "expiresAt must be a future date." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const policy = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED }, select: { id: true } });
    if (!policy) throw new Error("POLICY");
    const employment = await tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } });
    if (!employment) throw new Error("EMPLOYMENT");
    if (!manage) {
      const assignment = await tx.policyAssignment.findFirst({ where: { tenantId: ctx.tenantId, policyId: id, employmentId }, select: { id: true } });
      if (!assignment) throw new Error("ASSIGNMENT");
    }
    const duplicate = await tx.policyException.findFirst({ where: { tenantId: ctx.tenantId, policyId: id, employmentId, status: { in: [PolicyExceptionStatus.REQUESTED, PolicyExceptionStatus.APPROVED] }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }, select: { id: true } });
    if (duplicate) throw new Error("DUPLICATE");
    const exception = await tx.policyException.create({ data: { tenantId: ctx.tenantId, policyId: id, employmentId, reason, compensatingControl: compensatingControl || undefined, requestedById: ctx.actorId, status: PolicyExceptionStatus.REQUESTED, active: false, expiresAt } });
    await appendAudit(tx, ctx, { action: "policy.exception-requested", resourceType: "PolicyException", resourceId: exception.id, classification: DataClassification.CONFIDENTIAL, purpose: "Governed policy exception request" });
    return exception;
  }).catch((error) => error instanceof Error && ["POLICY", "EMPLOYMENT", "ASSIGNMENT", "DUPLICATE"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "POLICY") return Response.json({ error: "Published policy not found." }, { status: 404 });
  if (result === "EMPLOYMENT") return Response.json({ error: "Employment is unavailable or terminated." }, { status: 400 });
  if (result === "ASSIGNMENT") return forbidden("You can request an exception only for a policy assigned to your employment.");
  if (result === "DUPLICATE") return Response.json({ error: "An active or pending exception already exists for this policy and employment." }, { status: 409 });
  return Response.json({ data: result }, { status: 201 });
}
