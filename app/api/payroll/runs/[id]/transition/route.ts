import { DataClassification, PayrollRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canTransitionPayroll } from "@/lib/work-pay-state";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { status?: PayrollRunStatus };
  if (!body.status || !Object.values(PayrollRunStatus).includes(body.status)) return Response.json({ error: "A valid payroll run status is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.payrollRun.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!canTransitionPayroll(current.status, body.status!)) throw new Error("INVALID_TRANSITION");
    const now = new Date();
    const updated = await tx.payrollRun.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.status === PayrollRunStatus.CALCULATED ? { calculatedAt: now } : {}),
        ...(body.status === PayrollRunStatus.APPROVED ? { approvedAt: now, approvedById: ctx.actorId } : {}),
        ...(body.status === PayrollRunStatus.PAID ? { paidAt: now } : {})
      }
    });
    await appendAudit(tx, ctx, { action: `payroll-run.${body.status!.toLowerCase()}`, resourceType: "PayrollRun", resourceId: id, classification: DataClassification.RESTRICTED });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "INVALID_TRANSITION"].includes(error.message) ? error.message : Promise.reject(error));
  if (result === "NOT_FOUND") return Response.json({ error: "Payroll run not found in tenant." }, { status: 404 });
  if (result === "INVALID_TRANSITION") return Response.json({ error: "Payroll run cannot transition to that state." }, { status: 409 });
  return Response.json({ data: result });
}
