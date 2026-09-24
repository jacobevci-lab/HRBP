import { CompensationChangeStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { enqueueCompensationApprovalNotification } from "@/lib/compensation-notifications";
import { withDb } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:propose")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid compensation change id is required." }, { status: 400 });

  try {
    const data = await withDb((client) => client.$transaction(async (tx) => {
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
          employment: { select: { person: { select: { givenName: true, familyName: true } } } }
        }
      });
      if (!change) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, change.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (change.requestedById !== ctx.actorId) throw new Error("NOT_REQUESTER");
      if (change.status !== CompensationChangeStatus.DRAFT) throw new Error("INVALID_STATE");

      const state = await tx.compensationChange.updateMany({
        where: { id: change.id, tenantId: ctx.tenantId, status: CompensationChangeStatus.DRAFT },
        data: { status: CompensationChangeStatus.APPROVAL }
      });
      if (state.count !== 1) throw new Error("STATE_CONFLICT");

      const employeeName = `${change.employment.person.givenName} ${change.employment.person.familyName}`;
      await appendAudit(tx, ctx, {
        action: "COMPENSATION_CHANGE_SUBMITTED",
        resourceType: "CompensationChange",
        resourceId: change.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Compensation proposal submitted for independent approval"
      });
      await enqueueCompensationApprovalNotification(tx, {
        tenantId: ctx.tenantId,
        changeId: change.id,
        employeeName,
        currency: change.currency,
        currentAnnualBase: change.currentAnnualBase?.toString() ?? null,
        proposedAnnualBase: change.proposedAnnualBase.toString(),
        effectiveAt: change.effectiveAt
      });

      return { id: change.id, status: CompensationChangeStatus.APPROVAL };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Compensation change not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Compensation change is outside your authorized relationship scope.");
    if (code === "NOT_REQUESTER") return forbidden("Only the original requester can submit this compensation draft.");
    if (code === "INVALID_STATE" || code === "STATE_CONFLICT") return Response.json({ error: "Only an unchanged draft compensation proposal can be submitted." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Compensation state changed concurrently. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
