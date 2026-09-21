import { PositionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "positions:read")) return forbidden();
  const data = await db.position.findMany({ where: { tenantId: ctx.tenantId, validTo: null }, orderBy: { positionCode: "asc" }, include: { orgUnit: { select: { id: true, name: true } }, _count: { select: { employments: true } } } });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "positions:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const positionCode = String(body.positionCode ?? "").trim();
  const title = String(body.title ?? "").trim();
  const orgUnitId = String(body.orgUnitId ?? "").trim();
  if (!positionCode || !title || !orgUnitId) return Response.json({ error: "positionCode, title and orgUnitId are required." }, { status: 400 });
  const position = await db.position.create({ data: { tenantId: ctx.tenantId, positionCode, title, orgUnitId, status: PositionStatus.OPEN, validFrom: new Date(), critical: Boolean(body.critical) } });
  await recordAudit({ ctx, action: "POSITION_CREATED", resourceType: "Position", resourceId: position.id });
  return Response.json({ data: position }, { status: 201 });
}
