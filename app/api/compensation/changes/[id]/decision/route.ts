import { CompensationChangeStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { applyApprovedCompensationChange } from "@/lib/compensation-application";
import { enqueueCompensationDecisionNotification } from "@/lib/compensation-notifications";
import { withDb } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const decisions = ["APPROVE", "REJECT", "APPLY"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid compensation change id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const decision = asEnumValue(body.decision, decisions);
  if (!decision) return Response.json({ error: "decision must be APPROVE, REJECT or APPLY." }, { status: 400 });

  if (decision === "APPLY") {
    if (!can(ctx, "compensation:apply")) return forbidden("Applying compensation changes requires compensation:apply.");
  } else if (!can(ctx, "compensation:approve")) {
    return forbidden("Compensation approval decisions require compensation:approve.");
  }

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      if (decision === "APPLY") return applyApprovedCompensationChange(tx, ctx, id);

      const change = await tx.compensationChange.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          currency: true,
          proposedAnnualBase: true,
          effectiveAt: true,
          status: true,
          requestedById: true,
          employment: { select: { person: { select: { givenName: true, familyName: true } } } }
        }
      });
      if (!change) throw new Error("CHANGE_NOT_FOUND");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, change.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (change.requestedById === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");
      if (change.status !== CompensationChangeStatus.APPROVAL) throw new Error("INVALID_STATE");

      const next = decision === "APPROVE" ? CompensationChangeStatus.APPROVED : CompensationChangeStatus.REJECTED;
      const now = new Date();
      const state = await tx.compensationChange.updateMany({
        where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.APPROVAL },
        data: {
          status: next,
          ...(next === CompensationChangeStatus.APPROVED ? { approvedById: ctx.actorId, approvedAt: now } : {})
        }
      });
      if (state.count !== 1) throw new Error("STATE_CONFLICT");

      const employeeName = `${change.employment.person.givenName} ${change.employment.person.familyName}`;
      await appendAudit(tx, ctx, {
        action: next === CompensationChangeStatus.APPROVED ? "COMPENSATION_CHANGE_APPROVED" : "COMPENSATION_CHANGE_REJECTED",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Independent compensation approval decision"
      });
      await enqueueCompensationDecisionNotification(tx, {
        tenantId: ctx.tenantId,
        requesterUserId: change.requestedById,
        changeId: change.id,
        employeeName,
        currency: change.currency,
        proposedAnnualBase: change.proposedAnnualBase.toString(),
        effectiveAt: change.effectiveAt,
        decision: next === CompensationChangeStatus.APPROVED ? "APPROVED" : "REJECTED"
      });

      return { id: change.id, status: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CHANGE_NOT_FOUND") return Response.json({ error: "Compensation change was not found in this tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Compensation change is outside your authorized relationship scope.");
    if (code === "FOUR_EYES_REQUIRED") return forbidden("Four-eyes control: the requester cannot approve, reject or apply their own compensation change.");
    if (code === "INVALID_STATE") return Response.json({ error: "This decision is not valid for the current compensation-change state." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The compensation change was modified by another action. Refresh and try again." }, { status: 409 });
    if (code === "EFFECTIVE_DATE_CONFLICT") return Response.json({ error: "A compensation history record already exists for this effective date." }, { status: 409 });
    if (code === "BASELINE_CHANGED") return Response.json({ error: "The governed salary baseline changed after this proposal was created. Create a new proposal from the current salary state." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Compensation state changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Compensation decision failed", error);
    return Response.json({ error: "Compensation decision could not be completed." }, { status: 500 });
  }
}
