import { CompensationChangeStatus, DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asDecimalInput, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
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

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const employmentId = asIdentifier(body.employmentId);
  const currency = asText(body.currency, 3)?.toUpperCase() ?? null;
  const proposedAnnualBase = asDecimalInput(body.proposedAnnualBase);
  const currentAnnualBase = body.currentAnnualBase === undefined || body.currentAnnualBase === null || body.currentAnnualBase === "" ? undefined : asDecimalInput(body.currentAnnualBase);
  const effectiveAt = asDate(body.effectiveAt);
  const reasonValue = asOptionalText(body.reason, 500);

  if (!employmentId || !currency || !/^[A-Z]{3}$/.test(currency) || !proposedAnnualBase || !effectiveAt) {
    return Response.json({ error: "employmentId, three-letter currency, proposedAnnualBase and effectiveAt are required as valid scalar values." }, { status: 400 });
  }
  if (Number(proposedAnnualBase) <= 0) return Response.json({ error: "proposedAnnualBase must be greater than zero." }, { status: 400 });
  if (currentAnnualBase === null) return Response.json({ error: "currentAnnualBase must be a decimal scalar when provided." }, { status: 400 });
  if (reasonValue === null) return Response.json({ error: "reason must be a string up to 500 characters." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
    const employment = await tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!employment) throw new Error("NOT_FOUND");
    const change = await tx.compensationChange.create({
      data: {
        tenantId: ctx.tenantId,
        employmentId,
        currency,
        proposedAnnualBase,
        currentAnnualBase,
        effectiveAt,
        reason: reasonValue,
        requestedById: ctx.actorId,
        status: CompensationChangeStatus.DRAFT
      }
    });
    await appendAudit(tx, ctx, { action: "compensation-change.created", resourceType: "CompensationChange", resourceId: change.id, classification: DataClassification.RESTRICTED });
    return change;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
