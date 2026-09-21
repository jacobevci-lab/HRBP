import { PayrollRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";

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
  if (!can(ctx, "payroll:write")) return forbidden();

  const body = await request.json() as { payrollPeriodId?: string; runNumber?: number };
  if (!body.payrollPeriodId) return Response.json({ error: "payrollPeriodId is required." }, { status: 400 });
  const period = await db.payrollPeriod.findFirst({ where: { id: body.payrollPeriodId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!period) return Response.json({ error: "Payroll period not found in tenant." }, { status: 404 });

  const data = await db.payrollRun.create({ data: { tenantId: ctx.tenantId, payrollPeriodId: body.payrollPeriodId, runNumber: body.runNumber ?? 1, status: PayrollRunStatus.DRAFT } });
  return Response.json({ data }, { status: 201 });
}
