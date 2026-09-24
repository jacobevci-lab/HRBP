import { DataClassification, PayrollPeriodStatus, PayrollRunStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:read")) return forbidden();
  const data = await db.payrollRun.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { startedAt: "desc" },
    include: {
      payrollPeriod: { include: { countryPack: { select: { countryCode: true, name: true, version: true, currency: true } } } },
      _count: { select: { results: true } }
    }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "payroll:prepare")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const payrollPeriodId = asIdentifier(body.payrollPeriodId);
  if (!payrollPeriodId) return Response.json({ error: "payrollPeriodId is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.findFirst({
        where: { id: payrollPeriodId, tenantId: ctx.tenantId },
        select: { id: true, status: true }
      });
      if (!period) throw new Error("NOT_FOUND");
      if (period.status !== PayrollPeriodStatus.OPEN) throw new Error("PERIOD_NOT_OPEN");

      const activeRun = await tx.payrollRun.findFirst({
        where: {
          tenantId: ctx.tenantId,
          payrollPeriodId,
          status: { notIn: [PayrollRunStatus.PAID, PayrollRunStatus.CANCELLED] }
        },
        select: { id: true }
      });
      if (activeRun) throw new Error("ACTIVE_RUN_EXISTS");

      const latest = await tx.payrollRun.findFirst({
        where: { tenantId: ctx.tenantId, payrollPeriodId },
        orderBy: { runNumber: "desc" },
        select: { runNumber: true }
      });
      const run = await tx.payrollRun.create({
        data: {
          tenantId: ctx.tenantId,
          payrollPeriodId,
          runNumber: (latest?.runNumber ?? 0) + 1,
          status: PayrollRunStatus.DRAFT
        }
      });
      await appendAudit(tx, ctx, {
        action: "payroll-run.created",
        resourceType: "PayrollRun",
        resourceId: run.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Payroll run preparation owner"
      });
      return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Payroll period not found in tenant." }, { status: 404 });
    if (code === "PERIOD_NOT_OPEN") return Response.json({ error: "A new payroll run can only be created while the payroll period is OPEN." }, { status: 409 });
    if (code === "ACTIVE_RUN_EXISTS") return Response.json({ error: "An active payroll run already exists for this period." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return Response.json({ error: "Payroll run creation conflicted with another operation. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
