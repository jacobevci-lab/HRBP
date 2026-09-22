import { CompensationChangeStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "compensation:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.compensationChange.findMany({ where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], include: { employment: { select: { id: true, person: { select: { employeeNumber: true, givenName: true, familyName: true } }, position: { select: { title: true, grade: true } } } } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:write")) return forbidden();
  const body = await request.json() as { employmentId?: string; currency?: string; proposedAnnualBase?: string | number; effectiveAt?: string; reason?: string; currentAnnualBase?: string | number };
  if (!body.employmentId || !body.currency || body.proposedAnnualBase === undefined || !body.effectiveAt) return Response.json({ error: "employmentId, currency, proposedAnnualBase and effectiveAt are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, body.employmentId!)) throw new Error("OUT_OF_SCOPE");
    const employment = await tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!employment) throw new Error("NOT_FOUND");
    const change = await tx.compensationChange.create({ data: { tenantId: ctx.tenantId, employmentId: body.employmentId!, currency: body.currency!.toUpperCase(), proposedAnnualBase: body.proposedAnnualBase!, currentAnnualBase: body.currentAnnualBase, effectiveAt: new Date(body.effectiveAt!), reason: body.reason, requestedById: ctx.actorId, status: CompensationChangeStatus.DRAFT } });
    await appendAudit(tx, ctx, { action: "compensation-change.created", resourceType: "CompensationChange", resourceId: change.id, classification: DataClassification.RESTRICTED });
    return change;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
