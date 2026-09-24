import { CompensationChangeStatus, DataClassification, EmploymentStatus, Prisma } from "@prisma/client";
import { withDb } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { enqueueCompensationApprovalNotification } from "@/lib/compensation-notifications";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asDecimalInput, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:propose")) return forbidden();

  const { personId } = await params;
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const currency = asText(body.currency, 3)?.toUpperCase() ?? null;
  const proposedAnnualBase = asDecimalInput(body.proposedAnnualBase);
  const effectiveAt = asDate(body.effectiveDate);
  const reason = asText(body.reason, 500);

  if (!currency || !/^[A-Z]{3}$/.test(currency) || !proposedAnnualBase || !effectiveAt || !reason) {
    return Response.json({ error: "currency, proposedAnnualBase, effectiveDate and business reason are required as valid scalar values." }, { status: 400 });
  }
  if (Number(proposedAnnualBase) <= 0) return Response.json({ error: "proposedAnnualBase must be greater than zero." }, { status: 400 });
  if (reason.length < 3) return Response.json({ error: "reason must contain at least 3 characters." }, { status: 400 });

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, personId, status: { not: EmploymentStatus.TERMINATED } },
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          person: { select: { givenName: true, familyName: true } }
        }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employment.id)) throw new Error("OUT_OF_SCOPE");

      const [baseline, existingOpenChange] = await Promise.all([
        tx.compensationHistory.findFirst({
          where: {
            employmentId: employment.id,
            effectiveFrom: { lte: effectiveAt },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }]
          },
          orderBy: { effectiveFrom: "desc" },
          select: { annualBase: true, currency: true, effectiveFrom: true }
        }),
        tx.compensationChange.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId: employment.id,
            effectiveAt,
            status: { in: [CompensationChangeStatus.DRAFT, CompensationChangeStatus.APPROVAL, CompensationChangeStatus.APPROVED] }
          },
          select: { id: true }
        })
      ]);

      if (existingOpenChange) throw new Error("PENDING_CHANGE_EXISTS");
      if (baseline?.effectiveFrom.getTime() === effectiveAt.getTime()) throw new Error("EFFECTIVE_DATE_CONFLICT");
      if (baseline && baseline.currency === currency && baseline.annualBase.equals(proposedAnnualBase)) throw new Error("NO_OP_CHANGE");

      const change = await tx.compensationChange.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: employment.id,
          currency,
          currentAnnualBase: baseline?.annualBase ?? null,
          proposedAnnualBase,
          effectiveAt,
          status: CompensationChangeStatus.DRAFT,
          reason,
          requestedById: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "compensation-change.created",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Employee 360 compensation proposal"
      });

      const submitted = await tx.compensationChange.updateMany({
        where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.DRAFT },
        data: { status: CompensationChangeStatus.APPROVAL }
      });
      if (submitted.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "COMPENSATION_CHANGE_SUBMITTED",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Employee 360 compensation proposal submitted for independent approval"
      });

      await enqueueCompensationApprovalNotification(tx, {
        tenantId: ctx.tenantId,
        changeId: change.id,
        employeeName: `${employment.person.givenName} ${employment.person.familyName}`,
        currency,
        currentAnnualBase: baseline?.annualBase.toString() ?? null,
        proposedAnnualBase,
        effectiveAt
      });

      return { id: change.id, status: CompensationChangeStatus.APPROVAL, effectiveAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Current employment record was not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "PENDING_CHANGE_EXISTS") return Response.json({ error: "An open compensation change already exists for this employment and effective date." }, { status: 409 });
    if (code === "EFFECTIVE_DATE_CONFLICT") return Response.json({ error: "A governed compensation history record already starts on this effective date. Choose a new effective date." }, { status: 409 });
    if (code === "NO_OP_CHANGE") return Response.json({ error: "The proposed compensation matches the governed salary already effective on that date." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Compensation proposal state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Compensation state changed concurrently. Retry the request." }, { status: 409 });
    console.error("Compensation change request failed", error);
    return Response.json({ error: "Compensation change request could not be created." }, { status: 500 });
  }
}
