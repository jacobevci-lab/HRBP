import { DataClassification, LeaveRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canTransitionLeave } from "@/lib/work-pay-state";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { decision?: "APPROVED" | "REJECTED" };
  const next = body.decision === "APPROVED" ? LeaveRequestStatus.APPROVED : body.decision === "REJECTED" ? LeaveRequestStatus.REJECTED : null;
  if (!next) return Response.json({ error: "decision must be APPROVED or REJECTED." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const current = await tx.leaveRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!canTransitionLeave(current.status, next)) throw new Error("INVALID_TRANSITION");
    const updated = await tx.leaveRequest.update({ where: { id }, data: { status: next, approverId: ctx.actorId, decidedAt: new Date() } });
    await appendAudit(tx, ctx, { action: `leave-request.${next.toLowerCase()}`, resourceType: "LeaveRequest", resourceId: id, classification: DataClassification.CONFIDENTIAL });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Leave request not found in tenant." }, { status: 404 });
  if (data === "INVALID_TRANSITION") return Response.json({ error: "Leave request cannot transition to that state." }, { status: 409 });
  return Response.json({ data });
}
