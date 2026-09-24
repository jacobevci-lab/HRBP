import { DataClassification, LeaveRequestStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueLeaveDecisionNotification } from "@/lib/leave-notifications";
import { canTransitionLeave } from "@/lib/work-pay-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "leave:approve")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { decision?: "APPROVED" | "REJECTED" };
  const next = body.decision === "APPROVED" ? LeaveRequestStatus.APPROVED : body.decision === "REJECTED" ? LeaveRequestStatus.REJECTED : null;
  if (!next) return Response.json({ error: "decision must be APPROVED or REJECTED." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      const current = await tx.leaveRequest.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          leaveTypeId: true,
          startsAt: true,
          endsAt: true,
          units: true,
          status: true,
          leaveType: { select: { name: true, annualAllowance: true } }
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (!canActOnEmployment(scope, current.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (ctx.employmentId && current.employmentId === ctx.employmentId) throw new Error("SELF_APPROVAL");
      if (!canTransitionLeave(current.status, next)) throw new Error("INVALID_TRANSITION");

      let balanceId: string | null = null;
      if (next === LeaveRequestStatus.APPROVED && current.leaveType.annualAllowance !== null) {
        if (current.startsAt.getUTCFullYear() !== current.endsAt.getUTCFullYear()) throw new Error("CROSS_YEAR_TRACKED");
        const balance = await tx.leaveBalance.findUnique({
          where: {
            employmentId_leaveTypeId_periodYear: {
              employmentId: current.employmentId,
              leaveTypeId: current.leaveTypeId,
              periodYear: current.startsAt.getUTCFullYear()
            }
          },
          select: { id: true, opening: true, accrued: true, used: true, adjustment: true }
        });
        if (!balance) throw new Error("BALANCE_NOT_FOUND");
        const available = Number(balance.opening) + Number(balance.accrued) + Number(balance.adjustment) - Number(balance.used);
        if (available < Number(current.units)) throw new Error("INSUFFICIENT_BALANCE");
        balanceId = balance.id;
      }

      const result = await tx.leaveRequest.updateMany({
        where: { id, tenantId: ctx.tenantId, status: current.status },
        data: { status: next, approverId: ctx.actorId, decidedAt: new Date() }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      if (balanceId) await tx.leaveBalance.update({ where: { id: balanceId }, data: { used: { increment: current.units } } });
      const updated = await tx.leaveRequest.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: `leave-request.${next.toLowerCase()}`,
        resourceType: "LeaveRequest",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      await enqueueLeaveDecisionNotification(tx, {
        tenantId: ctx.tenantId,
        employmentId: current.employmentId,
        requestId: id,
        decision: next,
        leaveType: current.leaveType.name,
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        units: current.units.toString()
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Leave request not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Leave request is outside your authorized relationship scope.");
    if (code === "SELF_APPROVAL") return forbidden("Self-approval is blocked by policy.");
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") return Response.json({ error: "Leave request cannot transition from its current state." }, { status: 409 });
    if (code === "CROSS_YEAR_TRACKED") return Response.json({ error: "Balance-tracked leave requests must stay within one balance year." }, { status: 409 });
    if (code === "BALANCE_NOT_FOUND") return Response.json({ error: "No governed leave balance exists for this employee, leave type and year." }, { status: 409 });
    if (code === "INSUFFICIENT_BALANCE") return Response.json({ error: "Available leave balance is lower than the requested units." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Leave state changed concurrently. Retry the decision." }, { status: 409 });
    throw error;
  }
}
