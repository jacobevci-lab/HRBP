import { DataClassification, LeaveRequestStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "leave:self-request")) return forbidden();
  if (!ctx.employmentId) return forbidden("An employment-bound identity is required to cancel leave.");

  const { id } = await params;
  try {
    const data = await db.$transaction(async (tx) => {
      const current = await tx.leaveRequest.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          leaveTypeId: true,
          startsAt: true,
          units: true,
          status: true,
          leaveType: { select: { annualAllowance: true } }
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.employmentId !== ctx.employmentId) throw new Error("NOT_SELF");
      if (current.status !== LeaveRequestStatus.PENDING && current.status !== LeaveRequestStatus.APPROVED) throw new Error("INVALID_STATE");

      const result = await tx.leaveRequest.updateMany({
        where: { id, tenantId: ctx.tenantId, employmentId: ctx.employmentId, status: current.status },
        data: { status: LeaveRequestStatus.CANCELLED, decidedAt: current.status === LeaveRequestStatus.PENDING ? new Date() : undefined }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");

      if (current.status === LeaveRequestStatus.APPROVED && current.leaveType.annualAllowance !== null) {
        const balance = await tx.leaveBalance.findUnique({
          where: {
            employmentId_leaveTypeId_periodYear: {
              employmentId: current.employmentId,
              leaveTypeId: current.leaveTypeId,
              periodYear: current.startsAt.getUTCFullYear()
            }
          },
          select: { id: true, used: true }
        });
        if (!balance) throw new Error("BALANCE_NOT_FOUND");
        if (Number(balance.used) < Number(current.units)) throw new Error("BALANCE_INTEGRITY");
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { decrement: current.units } } });
      }

      const updated = await tx.leaveRequest.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");
      await appendAudit(tx, ctx, {
        action: "leave-request.self-cancelled",
        resourceType: "LeaveRequest",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Leave request not found in tenant." }, { status: 404 });
    if (code === "NOT_SELF") return forbidden("You can only cancel leave belonging to your own employment record.");
    if (code === "INVALID_STATE" || code === "STALE_STATE") return Response.json({ error: "Only pending or approved leave can be cancelled through employee self-service." }, { status: 409 });
    if (code === "BALANCE_NOT_FOUND" || code === "BALANCE_INTEGRITY") return Response.json({ error: "The governed leave balance cannot be safely restored. HR operations review is required." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Leave state changed concurrently. Retry the cancellation." }, { status: 409 });
    throw error;
  }
}
