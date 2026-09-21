import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:read")) return forbidden();
  const data = await db.payrollCountryPack.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: "desc" }, { countryCode: "asc" }, { effectiveFrom: "desc" }] });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:write")) return forbidden();
  const body = await request.json() as { countryCode?: string; name?: string; version?: string; currency?: string; effectiveFrom?: string };
  if (!body.countryCode || !body.name || !body.version || !body.currency || !body.effectiveFrom) return Response.json({ error: "countryCode, name, version, currency and effectiveFrom are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const pack = await tx.payrollCountryPack.create({ data: { tenantId: ctx.tenantId, countryCode: body.countryCode!.toUpperCase(), name: body.name!.trim(), version: body.version!.trim(), currency: body.currency!.toUpperCase(), effectiveFrom: new Date(body.effectiveFrom!) } });
    await appendAudit(tx, ctx, { action: "payroll-country-pack.created", resourceType: "PayrollCountryPack", resourceId: pack.id, classification: DataClassification.INTERNAL });
    return pack;
  });
  return Response.json({ data }, { status: 201 });
}
