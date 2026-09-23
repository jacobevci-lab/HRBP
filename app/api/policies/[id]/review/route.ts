import { DataClassification, PolicyStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type ReviewAction = "SUBMIT" | "APPROVE" | "REQUEST_CHANGES";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  const { id } = await params;
  const body = await request.json() as { action?: ReviewAction };
  if (!body.action || !["SUBMIT", "APPROVE", "REQUEST_CHANGES"].includes(body.action)) {
    return Response.json({ error: "action must be SUBMIT, APPROVE or REQUEST_CHANGES." }, { status: 400 });
  }

  if (body.action === "SUBMIT" && !can(ctx, "policies:write")) return forbidden();
  if ((body.action === "APPROVE" || body.action === "REQUEST_CHANGES") && !can(ctx, "policies:approve")) return forbidden();

  const result = await db.$transaction(async (tx) => {
    const current = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    const now = new Date();

    if (body.action === "SUBMIT") {
      if (current.status !== PolicyStatus.DRAFT) throw new Error("STATE");
      const updated = await tx.policyRecord.update({
        where: { id: current.id },
        data: { status: PolicyStatus.REVIEW, approvedById: null, approvedAt: null }
      });
      await appendAudit(tx, ctx, { action: "policy.review-submitted", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL, purpose: "Policy four-eyes review" });
      return updated;
    }

    if (body.action === "APPROVE") {
      if (current.status !== PolicyStatus.REVIEW) throw new Error("STATE");
      if (current.ownerId === ctx.actorId) throw new Error("FOUR_EYES");
      const updated = await tx.policyRecord.update({
        where: { id: current.id },
        data: { status: PolicyStatus.APPROVED, approvedById: ctx.actorId, approvedAt: now }
      });
      await appendAudit(tx, ctx, { action: "policy.approved", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL, purpose: "Independent policy approval" });
      return updated;
    }

    if (current.status !== PolicyStatus.REVIEW && current.status !== PolicyStatus.APPROVED) throw new Error("STATE");
    const updated = await tx.policyRecord.update({
      where: { id: current.id },
      data: { status: PolicyStatus.DRAFT, approvedById: null, approvedAt: null }
    });
    await appendAudit(tx, ctx, { action: "policy.changes-requested", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL, purpose: "Policy returned for controlled revision" });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Policy not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested policy review transition is not allowed from the current state." }, { status: 409 });
  if (result === "FOUR_EYES") return forbidden("Policy owners cannot approve their own policy version.");
  return Response.json({ data: result });
}
