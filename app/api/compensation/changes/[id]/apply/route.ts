import { CompensationChangeStatus, DataClassification, LifecycleEventType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canTransitionCompensation } from "@/lib/work-pay-state";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "compensation:write")) return forbidden();
  const { id } = await params;

  const result = await db.$transaction(async (tx) => {
    const change = await tx.compensationChange.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { employment: { select: { id: true, personId: true } } } });
    if (!change) throw new Error("NOT_FOUND");
    if (!canTransitionCompensation(change.status, CompensationChangeStatus.APPLIED)) throw new Error("INVALID_TRANSITION");

    await tx.compensationHistory.updateMany({
      where: { employmentId: change.employmentId, effectiveTo: null, effectiveFrom: { lt: change.effectiveAt } },
      data: { effectiveTo: change.effectiveAt }
    });
    const history = await tx.compensationHistory.create({ data: { employmentId: change.employmentId, currency: change.currency, annualBase: change.proposedAnnualBase, effectiveFrom: change.effectiveAt } });
    const updated = await tx.compensationChange.update({ where: { id }, data: { status: CompensationChangeStatus.APPLIED } });
    await tx.employeeLifecycleEvent.create({ data: { tenantId: ctx.tenantId, personId: change.employment.personId, employmentId: change.employmentId, type: LifecycleEventType.COMPENSATION_CHANGED, effectiveAt: change.effectiveAt, summary: "Approved compensation change applied.", actorId: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "compensation-change.applied", resourceType: "CompensationChange", resourceId: id, classification: DataClassification.RESTRICTED });
    return { change: updated, historyId: history.id };
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION"].includes(error.message) ? error.message : Promise.reject(error));
  if (result === "NOT_FOUND") return Response.json({ error: "Compensation change not found in tenant." }, { status: 404 });
  if (result === "INVALID_TRANSITION") return Response.json({ error: "Only an approved compensation change can be applied." }, { status: 409 });
  return Response.json({ data: result });
}
