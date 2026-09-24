import { CompensationChangeStatus, DataClassification, LifecycleEventType, type Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueCompensationPayrollHandoffNotification } from "@/lib/compensation-notifications";
import type { RequestContext } from "@/lib/request-context";

function sameDecimal(left: Prisma.Decimal | null, right: Prisma.Decimal | null) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

export async function applyApprovedCompensationChange(
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  id: string
) {
  const change = await tx.compensationChange.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: {
      id: true,
      employmentId: true,
      currency: true,
      currentAnnualBase: true,
      proposedAnnualBase: true,
      effectiveAt: true,
      status: true,
      requestedById: true,
      employment: {
        select: {
          personId: true,
          person: { select: { givenName: true, familyName: true } }
        }
      }
    }
  });
  if (!change) throw new Error("CHANGE_NOT_FOUND");

  const scope = await resolveEmploymentScope(tx, ctx);
  if (!canActOnEmployment(scope, change.employmentId)) throw new Error("OUT_OF_SCOPE");
  if (change.requestedById === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");
  if (change.status !== CompensationChangeStatus.APPROVED) throw new Error("INVALID_STATE");

  const baseline = await tx.compensationHistory.findFirst({
    where: {
      employmentId: change.employmentId,
      effectiveFrom: { lte: change.effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: change.effectiveAt } }]
    },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, annualBase: true, effectiveFrom: true, effectiveTo: true }
  });

  if (!sameDecimal(change.currentAnnualBase, baseline?.annualBase ?? null)) {
    throw new Error("BASELINE_CHANGED");
  }
  if (baseline?.effectiveFrom.getTime() === change.effectiveAt.getTime()) {
    throw new Error("EFFECTIVE_DATE_CONFLICT");
  }

  const nextHistory = await tx.compensationHistory.findFirst({
    where: { employmentId: change.employmentId, effectiveFrom: { gt: change.effectiveAt } },
    orderBy: { effectiveFrom: "asc" },
    select: { id: true, effectiveFrom: true }
  });

  const state = await tx.compensationChange.updateMany({
    where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVED },
    data: { status: CompensationChangeStatus.APPLIED }
  });
  if (state.count !== 1) throw new Error("STATE_CONFLICT");

  if (baseline) {
    await tx.compensationHistory.update({
      where: { id: baseline.id },
      data: { effectiveTo: new Date(change.effectiveAt.getTime() - 1) }
    });
  }

  const history = await tx.compensationHistory.create({
    data: {
      employmentId: change.employmentId,
      currency: change.currency,
      annualBase: change.proposedAnnualBase,
      effectiveFrom: change.effectiveAt,
      effectiveTo: nextHistory ? new Date(nextHistory.effectiveFrom.getTime() - 1) : null
    }
  });

  const employeeName = `${change.employment.person.givenName} ${change.employment.person.familyName}`;
  await tx.employeeLifecycleEvent.create({
    data: {
      tenantId: ctx.tenantId,
      personId: change.employment.personId,
      employmentId: change.employmentId,
      type: LifecycleEventType.COMPENSATION_CHANGED,
      effectiveAt: change.effectiveAt,
      summary: `Approved compensation change applied for ${employeeName}.`,
      actorId: ctx.actorId
    }
  });

  await appendAudit(tx, ctx, {
    action: "COMPENSATION_CHANGE_APPLIED",
    resourceType: "CompensationChange",
    resourceId: change.id,
    classification: DataClassification.RESTRICTED,
    purpose: "Approved compensation change and payroll handoff"
  });

  await enqueueCompensationPayrollHandoffNotification(tx, {
    tenantId: ctx.tenantId,
    changeId: change.id,
    employeeName,
    currency: change.currency,
    proposedAnnualBase: change.proposedAnnualBase.toString(),
    effectiveAt: change.effectiveAt
  });

  return {
    id: change.id,
    status: CompensationChangeStatus.APPLIED,
    historyId: history.id,
    effectiveAt: change.effectiveAt
  };
}
