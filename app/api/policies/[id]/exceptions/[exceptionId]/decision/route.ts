import { DataClassification, PolicyExceptionStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type Decision = "APPROVE" | "REJECT" | "REVOKE";
const decisionValues: Decision[] = ["APPROVE", "REJECT", "REVOKE"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string; exceptionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:approve")) return forbidden();
  const resolved = await params;
  const id = asIdentifier(resolved.id);
  const exceptionId = asIdentifier(resolved.exceptionId);
  if (!id || !exceptionId) return Response.json({ error: "Valid policy and exception ids are required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const decision = asEnumValue(body.decision, decisionValues);
  const note = asOptionalText(body.note, 500);
  if (!decision || note === null) return Response.json({ error: "decision must be APPROVE, REJECT or REVOKE; note must be plain text when supplied." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.policyException.findFirst({ where: { id: exceptionId, tenantId: ctx.tenantId, policyId: id } });
    if (!current) throw new Error("NOT_FOUND");
    const now = new Date();
    if ((decision === "APPROVE" || decision === "REJECT") && current.requestedById === ctx.actorId) throw new Error("FOUR_EYES");

    if (decision === "APPROVE") {
      if (current.status !== PolicyExceptionStatus.REQUESTED) throw new Error("STATE");
      if (current.expiresAt && current.expiresAt <= now) throw new Error("EXPIRED");
      const updated = await tx.policyException.update({ where: { id: current.id, status: PolicyExceptionStatus.REQUESTED }, data: { status: PolicyExceptionStatus.APPROVED, active: true, approvedById: ctx.actorId, decidedAt: now, decisionNote: note || null } });
      await appendAudit(tx, ctx, { action: "policy.exception-approved", resourceType: "PolicyException", resourceId: current.id, classification: DataClassification.CONFIDENTIAL, purpose: note || "Independent policy exception approval" });
      return updated;
    }
    if (decision === "REJECT") {
      if (current.status !== PolicyExceptionStatus.REQUESTED) throw new Error("STATE");
      const updated = await tx.policyException.update({ where: { id: current.id, status: PolicyExceptionStatus.REQUESTED }, data: { status: PolicyExceptionStatus.REJECTED, active: false, approvedById: ctx.actorId, decidedAt: now, decisionNote: note || null } });
      await appendAudit(tx, ctx, { action: "policy.exception-rejected", resourceType: "PolicyException", resourceId: current.id, classification: DataClassification.CONFIDENTIAL, purpose: note || "Independent policy exception rejection" });
      return updated;
    }
    if (current.status !== PolicyExceptionStatus.APPROVED || !current.active) throw new Error("STATE");
    const updated = await tx.policyException.update({ where: { id: current.id, status: PolicyExceptionStatus.APPROVED }, data: { status: PolicyExceptionStatus.REVOKED, active: false, decidedAt: now, decisionNote: note || current.decisionNote } });
    await appendAudit(tx, ctx, { action: "policy.exception-revoked", resourceType: "PolicyException", resourceId: current.id, classification: DataClassification.CONFIDENTIAL, purpose: note || "Policy exception revoked" });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES", "EXPIRED"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Policy exception not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested exception decision is not allowed from the current state." }, { status: 409 });
  if (result === "FOUR_EYES") return forbidden("Exception requestors cannot approve or reject their own request.");
  if (result === "EXPIRED") return Response.json({ error: "An already expired exception request cannot be approved." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Policy exception state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
