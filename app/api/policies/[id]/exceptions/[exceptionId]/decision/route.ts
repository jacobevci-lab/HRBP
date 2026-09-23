import { DataClassification, PolicyExceptionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type Decision = "APPROVE" | "REJECT" | "REVOKE";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; exceptionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:approve")) return forbidden();

  const { id, exceptionId } = await params;
  const body = await request.json() as { decision?: Decision; note?: string };
  if (!body.decision || !["APPROVE", "REJECT", "REVOKE"].includes(body.decision)) {
    return Response.json({ error: "decision must be APPROVE, REJECT or REVOKE." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const exception = await tx.policyException.findFirst({ where: { id: exceptionId, tenantId: ctx.tenantId, policyId: id } });
    if (!exception) throw new Error("NOT_FOUND");
    const now = new Date();

    if (body.decision === "APPROVE") {
      if (exception.status !== PolicyExceptionStatus.REQUESTED) throw new Error("STATE");
      if (exception.requestedById === ctx.actorId) throw new Error("FOUR_EYES");
      if (exception.expiresAt && exception.expiresAt <= now) throw new Error("EXPIRED");
      const updated = await tx.policyException.update({
        where: { id: exception.id },
        data: { status: PolicyExceptionStatus.APPROVED, active: true, approvedById: ctx.actorId, decidedAt: now, decisionNote: body.note?.trim() || null }
      });
      await appendAudit(tx, ctx, { action: "policy.exception-approved", resourceType: "PolicyException", resourceId: exception.id, classification: DataClassification.CONFIDENTIAL, purpose: "Independent policy exception approval" });
      return updated;
    }

    if (body.decision === "REJECT") {
      if (exception.status !== PolicyExceptionStatus.REQUESTED) throw new Error("STATE");
      if (exception.requestedById === ctx.actorId) throw new Error("FOUR_EYES");
      const updated = await tx.policyException.update({
        where: { id: exception.id },
        data: { status: PolicyExceptionStatus.REJECTED, active: false, approvedById: ctx.actorId, decidedAt: now, decisionNote: body.note?.trim() || null }
      });
      await appendAudit(tx, ctx, { action: "policy.exception-rejected", resourceType: "PolicyException", resourceId: exception.id, classification: DataClassification.CONFIDENTIAL, purpose: "Independent policy exception decision" });
      return updated;
    }

    if (exception.status !== PolicyExceptionStatus.APPROVED || !exception.active) throw new Error("STATE");
    const updated = await tx.policyException.update({
      where: { id: exception.id },
      data: { status: PolicyExceptionStatus.REVOKED, active: false, decidedAt: now, decisionNote: body.note?.trim() || exception.decisionNote }
    });
    await appendAudit(tx, ctx, { action: "policy.exception-revoked", resourceType: "PolicyException", resourceId: exception.id, classification: DataClassification.CONFIDENTIAL, purpose: "Policy exception revoked" });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES", "EXPIRED"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Policy exception not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested exception decision is not allowed from the current state." }, { status: 409 });
  if (result === "FOUR_EYES") return forbidden("Exception requestors cannot approve or reject their own request.");
  if (result === "EXPIRED") return Response.json({ error: "An already expired exception request cannot be approved." }, { status: 409 });
  return Response.json({ data: result });
}
