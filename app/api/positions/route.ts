import { DataClassification, PositionStatus } from "@prisma/client";
import { db, withDb } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { appendAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "positions:read")) return forbidden();
  const data = await db.position.findMany({
    where: { tenantId: ctx.tenantId, validTo: null },
    orderBy: { positionCode: "asc" },
    include: { orgUnit: { select: { id: true, name: true } }, _count: { select: { employments: true } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "positions:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const positionCode = String(body.positionCode ?? "").trim().toUpperCase();
  const title = String(body.title ?? "").trim();
  const orgUnitId = String(body.orgUnitId ?? "").trim();
  const jobFamily = String(body.jobFamily ?? "").trim() || null;
  const grade = String(body.grade ?? "").trim() || null;
  const location = String(body.location ?? "").trim() || null;
  const statusValue = String(body.status ?? PositionStatus.OPEN).trim().toUpperCase();
  const critical = body.critical === true;

  if (!positionCode || !title || !orgUnitId) {
    return Response.json({ error: "positionCode, title and orgUnitId are required." }, { status: 400 });
  }
  if (![PositionStatus.OPEN, PositionStatus.PLANNED].includes(statusValue as PositionStatus)) {
    return Response.json({ error: "New positions must start as OPEN or PLANNED." }, { status: 400 });
  }

  try {
    const position = await withDb((client) => client.$transaction(async (tx) => {
      const orgUnit = await tx.organizationUnit.findFirst({
        where: { id: orgUnitId, tenantId: ctx.tenantId, validTo: null },
        select: { id: true }
      });
      if (!orgUnit) throw new Error("ORG_NOT_FOUND");

      const duplicate = await tx.position.findFirst({
        where: { tenantId: ctx.tenantId, positionCode, validTo: null },
        select: { id: true }
      });
      if (duplicate) throw new Error("POSITION_DUPLICATE");

      const created = await tx.position.create({
        data: {
          tenantId: ctx.tenantId,
          positionCode,
          title,
          orgUnitId,
          jobFamily,
          grade,
          location,
          status: statusValue as PositionStatus,
          critical,
          validFrom: new Date()
        }
      });

      await appendAudit(tx, ctx, {
        action: "POSITION_CREATED",
        resourceType: "Position",
        resourceId: created.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Workforce management"
      });

      return created;
    }));

    return Response.json({ data: position }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ORG_NOT_FOUND") return Response.json({ error: "The selected organization unit is not available." }, { status: 404 });
    if (code === "POSITION_DUPLICATE" || (error as { code?: string })?.code === "P2002") return Response.json({ error: "A current position with this code already exists." }, { status: 409 });
    console.error("Position creation failed", error);
    return Response.json({ error: "Position could not be created." }, { status: 500 });
  }
}
