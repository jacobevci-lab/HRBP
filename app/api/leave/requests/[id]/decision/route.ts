import { DataClassification, LeaveRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { canTransitionLeave } from "@/lib/work-pay-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "leave:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { decision?: "APPROVED" | "REJECTED" };
  const next = body.decision === "APPROVED" ? LeaveRequestStatus.APPROVED : body.decision === "REJECTED" ? LeaveRequestStatus.REJECTED : null;
  if (!next) return Response.json({ error: "decision must be APPROVED or REJECTED." }, { status: 400 });

  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.$transaction(async (tx) => {
    const current = await tx.leaveRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!canActOnEmployment(scope, current.employmentId)) throw new Error("OUT_OF_SCOPE");
    if (ctx.employmentId && current.employmentId === ctx.employmentId) throw new Error("SELF_APPROVAL");
    if (!canTransitionLeave(current.status, next)) throw new Error("INVALID_TRANSITION");

    const updated = await tx.leaveRequest.update({
      where: { id },
      data: { status: next, approverId: ctx.actorId, decidedAt: new Date() }
    });
    await appendAudit(tx, ctx, { action: `leave-request.${next.toLowerCase()}`, resourceType: "LeaveRequest", resourceId: id, classification: DataClassification.CONFIDENTIAL });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "SELF_APPROVAL", "INVALID_TRANSITION"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Leave request not found in tenant." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("Leave request is outside your authorized relationship scope.");
  if (data === "SELF_APPROVAL") return forbidden("Self-approval is blocked by policy.");
  if (data === "INVALID_TRANSITION") return Response.json({ error: "Leave request cannot transition to that state." }, { status: 409 });
  return Response.json({ data });
}
