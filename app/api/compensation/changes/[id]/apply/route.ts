import { CompensationChangeStatus, DataClassification, LifecycleEventType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { canTransitionCompensation } from "@/lib/work-pay-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:write")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid compensation change id is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const change = await tx.compensationChange.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { employment: { select: { id: true, personId: true } } } });
    if (!change) throw new Error("NOT_FOUND");
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, change.employmentId)) throw new Error("OUT_OF_SCOPE");
    if (change.requestedById === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");
    if (!canTransitionCompensation(change.status, CompensationChangeStatus.APPLIED)) throw new Error("INVALID_TRANSITION");

    const duplicateEffectiveDate = await tx.compensationHistory.findFirst({
      where: { employmentId: change.employmentId, effectiveFrom: change.effectiveAt },
      select: { id: true }
    });
    if (duplicateEffectiveDate) throw new Error("EFFECTIVE_DATE_CONFLICT");

    const openHistory = await tx.compensationHistory.findMany({
      where: { employmentId: change.employmentId, effectiveTo: null, effectiveFrom: { lt: change.effectiveAt } },
      select: { id: true }
    });
    for (const row of openHistory) {
      await tx.compensationHistory.update({
        where: { id: row.id },
        data: { effectiveTo: new Date(change.effectiveAt.getTime() - 1) }
      });
    }

    const history = await tx.compensationHistory.create({ data: { employmentId: change.employmentId, currency: change.currency, annualBase: change.proposedAnnualBase, effectiveFrom: change.effectiveAt } });
    let updated;
    try {
      updated = await tx.compensationChange.update({
        where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVED },
        data: { status: CompensationChangeStatus.APPLIED }
      });
    } catch (error) {
      if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
      throw error;
    }
    await tx.employeeLifecycleEvent.create({ data: { tenantId: ctx.tenantId, personId: change.employment.personId, employmentId: change.employmentId, type: LifecycleEventType.COMPENSATION_CHANGED, effectiveAt: change.effectiveAt, summary: "Approved compensation change applied.", actorId: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "compensation-change.applied", resourceType: "CompensationChange", resourceId: id, classification: DataClassification.RESTRICTED });
    return { change: updated, historyId: history.id };
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "FOUR_EYES_REQUIRED", "INVALID_TRANSITION", "EFFECTIVE_DATE_CONFLICT", "STATE_CONFLICT"].includes(error.message) ? error.message : Promise.reject(error));
  if (result === "NOT_FOUND") return Response.json({ error: "Compensation change not found in tenant." }, { status: 404 });
  if (result === "OUT_OF_SCOPE") return forbidden("Compensation change is outside your authorized relationship scope.");
  if (result === "FOUR_EYES_REQUIRED") return forbidden("Four-eyes control: the requester cannot apply their own compensation change.");
  if (result === "INVALID_TRANSITION") return Response.json({ error: "Only an approved compensation change can be applied." }, { status: 409 });
  if (result === "EFFECTIVE_DATE_CONFLICT") return Response.json({ error: "A compensation history record already exists for this effective date." }, { status: 409 });
  if (result === "STATE_CONFLICT") return Response.json({ error: "The compensation change was modified concurrently. Refresh and try again." }, { status: 409 });
  return Response.json({ data: result });
}
