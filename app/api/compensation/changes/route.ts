import { CompensationChangeStatus, DataClassification, EmploymentStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asDecimalInput, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "compensation:read")) return forbidden();

  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const data = await db.compensationChange.findMany({
      where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      include: {
        employment: {
          select: {
            id: true,
            person: { select: { employeeNumber: true, givenName: true, familyName: true } },
            position: { select: { title: true, grade: true } }
          }
        }
      }
    });
    return Response.json({ data });
  });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:propose")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const employmentId = asIdentifier(body.employmentId);
  const currency = asText(body.currency, 3)?.toUpperCase() ?? null;
  const proposedAnnualBase = asDecimalInput(body.proposedAnnualBase);
  const effectiveAt = asDate(body.effectiveAt);
  const reason = asText(body.reason, 500);

  if (!employmentId || !currency || !/^[A-Z]{3}$/.test(currency) || !proposedAnnualBase || !effectiveAt || !reason) {
    return Response.json({ error: "employmentId, three-letter currency, proposedAnnualBase, effectiveAt and reason are required as valid scalar values." }, { status: 400 });
  }
  if (Number(proposedAnnualBase) <= 0) return Response.json({ error: "proposedAnnualBase must be greater than zero." }, { status: 400 });
  if (reason.length < 3) return Response.json({ error: "reason must contain at least 3 characters." }, { status: 400 });

  try {
    const data = await withDb((client) => client.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

      const employment = await tx.employment.findFirst({
        where: { id: employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
        select: { id: true }
      });
      if (!employment) throw new Error("NOT_FOUND");

      const [baseline, existingOpenChange] = await Promise.all([
        tx.compensationHistory.findFirst({
          where: {
            employmentId,
            effectiveFrom: { lte: effectiveAt },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }]
          },
          orderBy: { effectiveFrom: "desc" },
          select: { annualBase: true, currency: true }
        }),
        tx.compensationChange.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId,
            effectiveAt,
            status: { in: [CompensationChangeStatus.DRAFT, CompensationChangeStatus.APPROVAL, CompensationChangeStatus.APPROVED] }
          },
          select: { id: true }
        })
      ]);

      if (existingOpenChange) throw new Error("OPEN_CHANGE_CONFLICT");
      if (baseline && baseline.currency === currency && baseline.annualBase.equals(proposedAnnualBase)) throw new Error("NO_OP_CHANGE");

      const change = await tx.compensationChange.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          currency,
          proposedAnnualBase,
          currentAnnualBase: baseline?.annualBase ?? null,
          effectiveAt,
          reason,
          requestedById: ctx.actorId,
          status: CompensationChangeStatus.DRAFT
        }
      });

      await appendAudit(tx, ctx, {
        action: "compensation-change.created",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Compensation proposal draft"
      });
      return change;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Active employment not found in tenant." }, { status: 404 });
    if (code === "OPEN_CHANGE_CONFLICT") return Response.json({ error: "An open compensation change already exists for this employment and effective date." }, { status: 409 });
    if (code === "NO_OP_CHANGE") return Response.json({ error: "The proposed compensation matches the governed salary already effective on that date." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Compensation state changed concurrently. Retry the proposal." }, { status: 409 });
    throw error;
  }
}
