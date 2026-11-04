import { asEnumValue, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, PositionStatus } from "@prisma/client";
import { db, withDb } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { appendAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
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
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "positions:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const rawCode = asIdentifier(body.positionCode, 64);
  const positionCode = rawCode?.toUpperCase() ?? null;
  const title = asText(body.title, 160);
  const orgUnitId = asIdentifier(body.orgUnitId);
  const jobFamilyValue = asOptionalText(body.jobFamily, 100);
  const gradeValue = asOptionalText(body.grade, 64);
  const locationValue = asOptionalText(body.location, 160);
  const statusValue = asEnumValue(body.status ?? PositionStatus.OPEN, [PositionStatus.OPEN, PositionStatus.PLANNED] as const);
  const critical = body.critical === true;

  if (!positionCode || !title || !orgUnitId || jobFamilyValue === null || gradeValue === null || locationValue === null || !statusValue) {
    return Response.json({
      error: "A valid positionCode, title, orgUnitId and OPEN/PLANNED status are required; optional fields must stay within allowed lengths."
    }, { status: 400 });
  }
  const jobFamily = jobFamilyValue ?? null;
  const grade = gradeValue ?? null;
  const location = locationValue ?? null;

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
          status: statusValue,
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
