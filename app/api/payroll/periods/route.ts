import { DataClassification, PayrollPeriodStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:read")) return forbidden();
  const data = await db.payrollPeriod.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { payDate: "desc" }, include: { countryPack: true, _count: { select: { runs: true } } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:write")) return forbidden();
  const body = await request.json() as { countryPackId?: string; code?: string; startsAt?: string; endsAt?: string; payDate?: string };
  if (!body.countryPackId || !body.code || !body.startsAt || !body.endsAt || !body.payDate) return Response.json({ error: "countryPackId, code, startsAt, endsAt and payDate are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const pack = await tx.payrollCountryPack.findFirst({ where: { id: body.countryPackId, tenantId: ctx.tenantId, active: true }, select: { id: true } });
    if (!pack) throw new Error("NOT_FOUND");
    const period = await tx.payrollPeriod.create({ data: { tenantId: ctx.tenantId, countryPackId: body.countryPackId!, code: body.code!.trim(), startsAt: new Date(body.startsAt!), endsAt: new Date(body.endsAt!), payDate: new Date(body.payDate!), status: PayrollPeriodStatus.OPEN } });
    await appendAudit(tx, ctx, { action: "payroll-period.created", resourceType: "PayrollPeriod", resourceId: period.id, classification: DataClassification.RESTRICTED });
    return period;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Active payroll country pack not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
