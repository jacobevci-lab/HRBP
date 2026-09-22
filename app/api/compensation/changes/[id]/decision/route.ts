import { CompensationChangeStatus, DataClassification, LifecycleEventType } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const decisions = ["APPROVE", "REJECT", "APPLY"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid compensation change id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const decision = asEnumValue(body.decision, decisions);
  if (!decision) return Response.json({ error: "decision must be APPROVE, REJECT or APPLY." }, { status: 400 });

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      const change = await tx.compensationChange.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true, tenantId: true, employmentId: true, currency: true, currentAnnualBase: true,
          proposedAnnualBase: true, effectiveAt: true, status: true, requestedById: true, approvedById: true,
          employment: { select: { personId: true, person: { select: { givenName: true, familyName: true } } } }
        }
      });
      if (!change) throw new Error("CHANGE_NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, change.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (change.requestedById === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");

      if (decision === "APPROVE") {
        if (change.status !== CompensationChangeStatus.APPROVAL) throw new Error("INVALID_STATE");
        const now = new Date();
        try {
          await tx.compensationChange.update({
            where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVAL },
            data: { status: CompensationChangeStatus.APPROVED, approvedById: ctx.actorId, approvedAt: now }
          });
        } catch (error) {
          if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
          throw error;
        }
        await appendAudit(tx, ctx, {
          action: "COMPENSATION_CHANGE_APPROVED",
          resourceType: "CompensationChange",
          resourceId: change.id,
          classification: DataClassification.RESTRICTED,
          purpose: "Compensation approval"
        });
        return { id: change.id, status: CompensationChangeStatus.APPROVED };
      }

      if (decision === "REJECT") {
        if (change.status !== CompensationChangeStatus.APPROVAL) throw new Error("INVALID_STATE");
        try {
          await tx.compensationChange.update({
            where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVAL },
            data: { status: CompensationChangeStatus.REJECTED }
          });
        } catch (error) {
          if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
          throw error;
        }
        await appendAudit(tx, ctx, {
          action: "COMPENSATION_CHANGE_REJECTED",
          resourceType: "CompensationChange",
          resourceId: change.id,
          classification: DataClassification.RESTRICTED,
          purpose: "Compensation approval"
        });
        return { id: change.id, status: CompensationChangeStatus.REJECTED };
      }

      if (change.status !== CompensationChangeStatus.APPROVED) throw new Error("INVALID_STATE");
      try {
        await tx.compensationChange.update({
          where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVED },
          data: { status: CompensationChangeStatus.APPLIED }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      const duplicateEffectiveDate = await tx.compensationHistory.findFirst({
        where: { employmentId: change.employmentId, effectiveFrom: change.effectiveAt },
        select: { id: true }
      });
      if (duplicateEffectiveDate) throw new Error("EFFECTIVE_DATE_CONFLICT");

      const previous = await tx.compensationHistory.findFirst({
        where: {
          employmentId: change.employmentId,
          effectiveFrom: { lt: change.effectiveAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: change.effectiveAt } }]
        },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true }
      });

      if (previous) {
        await tx.compensationHistory.update({
          where: { id: previous.id },
          data: { effectiveTo: new Date(change.effectiveAt.getTime() - 1) }
        });
      }

      await tx.compensationHistory.create({
        data: {
          employmentId: change.employmentId,
          currency: change.currency,
          annualBase: change.proposedAnnualBase,
          effectiveFrom: change.effectiveAt,
          effectiveTo: null
        }
      });

      await tx.employeeLifecycleEvent.create({
        data: {
          tenantId: ctx.tenantId,
          personId: change.employment.personId,
          employmentId: change.employmentId,
          type: LifecycleEventType.COMPENSATION_CHANGED,
          effectiveAt: change.effectiveAt,
          summary: `Compensation changed for ${change.employment.person.givenName} ${change.employment.person.familyName}`,
          actorId: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "COMPENSATION_CHANGE_APPLIED",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Approved compensation change"
      });

      return { id: change.id, status: CompensationChangeStatus.APPLIED, effectiveAt: change.effectiveAt };
    }));

    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CHANGE_NOT_FOUND") return Response.json({ error: "Compensation change was not found in this tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Compensation change is outside your authorized relationship scope.");
    if (code === "FOUR_EYES_REQUIRED") return Response.json({ error: "Four-eyes control: the requester cannot approve, reject or apply their own compensation change." }, { status: 403 });
    if (code === "INVALID_STATE") return Response.json({ error: "This decision is not valid for the current compensation-change state." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The compensation change was modified by another action. Refresh and try again." }, { status: 409 });
    if (code === "EFFECTIVE_DATE_CONFLICT") return Response.json({ error: "A compensation history record already exists for this effective date." }, { status: 409 });
    console.error("Compensation decision failed", error);
    return Response.json({ error: "Compensation decision could not be completed." }, { status: 500 });
  }
}
