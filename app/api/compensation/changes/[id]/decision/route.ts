import { CompensationChangeStatus, DataClassification } from "@prisma/client";
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
  const body = await request.json() as { decision?: "APPROVED" | "REJECTED" | "APPROVAL" };
  const next = body.decision === "APPROVED" ? CompensationChangeStatus.APPROVED : body.decision === "REJECTED" ? CompensationChangeStatus.REJECTED : body.decision === "APPROVAL" ? CompensationChangeStatus.APPROVAL : null;
  if (!next) return Response.json({ error: "decision must be APPROVAL, APPROVED or REJECTED." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const current = await tx.compensationChange.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!canTransitionCompensation(current.status, next)) throw new Error("INVALID_TRANSITION");
    const updated = await tx.compensationChange.update({ where: { id }, data: { status: next, ...(next === CompensationChangeStatus.APPROVED ? { approvedById: ctx.actorId, approvedAt: new Date() } : {}) } });
    await appendAudit(tx, ctx, { action: `compensation-change.${next.toLowerCase()}`, resourceType: "CompensationChange", resourceId: id, classification: DataClassification.RESTRICTED });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Compensation change not found in tenant." }, { status: 404 });
  if (data === "INVALID_TRANSITION") return Response.json({ error: "Compensation change cannot transition to that state." }, { status: 409 });
  return Response.json({ data });
}
