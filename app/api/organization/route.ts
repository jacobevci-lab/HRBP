import { OrganizationUnitType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "organization:read")) return forbidden();
  const data = await db.organizationUnit.findMany({ where: { tenantId: ctx.tenantId, validTo: null }, orderBy: [{ type: "asc" }, { name: "asc" }], include: { _count: { select: { positions: true, children: true } } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "organization:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const code = String(body.code ?? "").trim();
  const type = String(body.type ?? "DEPARTMENT") as OrganizationUnitType;
  const parentId = String(body.parentId ?? "").trim() || null;
  if (!name || !code || !Object.values(OrganizationUnitType).includes(type)) return Response.json({ error: "Valid name, code and type are required." }, { status: 400 });
  const unit = await db.organizationUnit.create({ data: { tenantId: ctx.tenantId, name, code, type, parentId, validFrom: new Date() } });
  await recordAudit({ ctx, action: "ORG_UNIT_CREATED", resourceType: "OrganizationUnit", resourceId: unit.id });
  return Response.json({ data: unit }, { status: 201 });
}
