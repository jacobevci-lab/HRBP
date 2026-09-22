import { CompensationChangeStatus, DataClassification, EmploymentStatus, Prisma } from "@prisma/client";
import { withDb } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:write")) return forbidden();

  const { personId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const currency = String(body.currency ?? "").trim().toUpperCase();
  const proposedAnnualBaseValue = String(body.proposedAnnualBase ?? "").trim();
  const effectiveDateValue = String(body.effectiveDate ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 500) || null;

  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
  if (!proposedAnnualBaseValue || !effectiveDateValue) return Response.json({ error: "proposedAnnualBase and effectiveDate are required." }, { status: 400 });

  let proposedAnnualBase: Prisma.Decimal;
  try {
    proposedAnnualBase = new Prisma.Decimal(proposedAnnualBaseValue);
  } catch {
    return Response.json({ error: "proposedAnnualBase is invalid." }, { status: 400 });
  }
  if (proposedAnnualBase.lte(0)) return Response.json({ error: "proposedAnnualBase must be greater than zero." }, { status: 400 });

  const effectiveAt = new Date(`${effectiveDateValue}T00:00:00.000Z`);
  if (Number.isNaN(effectiveAt.getTime())) return Response.json({ error: "effectiveDate is invalid." }, { status: 400 });

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, personId, status: { not: EmploymentStatus.TERMINATED } },
        orderBy: { startDate: "desc" },
        select: { id: true }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employment.id)) throw new Error("OUT_OF_SCOPE");

      const pending = await tx.compensationChange.findFirst({
        where: {
          tenantId: ctx.tenantId,
          employmentId: employment.id,
          status: { in: [CompensationChangeStatus.DRAFT, CompensationChangeStatus.APPROVAL, CompensationChangeStatus.APPROVED] }
        },
        select: { id: true }
      });
      if (pending) throw new Error("PENDING_CHANGE_EXISTS");

      const current = await tx.compensationHistory.findFirst({
        where: {
          employmentId: employment.id,
          effectiveFrom: { lte: effectiveAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }]
        },
        orderBy: { effectiveFrom: "desc" },
        select: { annualBase: true }
      });

      const change = await tx.compensationChange.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: employment.id,
          currency,
          currentAnnualBase: current?.annualBase,
          proposedAnnualBase,
          effectiveAt,
          status: CompensationChangeStatus.APPROVAL,
          reason,
          requestedById: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "COMPENSATION_CHANGE_REQUESTED",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Compensation review"
      });

      return { id: change.id, status: change.status, effectiveAt: change.effectiveAt };
    }));

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Current employment record was not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "PENDING_CHANGE_EXISTS") return Response.json({ error: "A compensation change is already waiting for approval for this employment." }, { status: 409 });
    console.error("Compensation change request failed", error);
    return Response.json({ error: "Compensation change request could not be created." }, { status: 500 });
  }
}
