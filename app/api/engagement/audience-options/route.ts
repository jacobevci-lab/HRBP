import { EmploymentStatus } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);

  if (scope === null) {
    const [orgUnits, positions] = await Promise.all([
      db.organizationUnit.findMany({
        where: { tenantId: ctx.tenantId, validTo: null },
        orderBy: { name: "asc" },
        take: 500,
        select: { id: true, name: true }
      }),
      db.position.findMany({
        where: { tenantId: ctx.tenantId, validTo: null },
        orderBy: [{ title: "asc" }, { positionCode: "asc" }],
        take: 1000,
        select: { id: true, positionCode: true, title: true, orgUnitId: true }
      })
    ]);
    return Response.json({ data: { relationshipScoped: false, orgUnits, positions } });
  }

  const employments = scope.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: scope }, status: { not: EmploymentStatus.TERMINATED } },
    select: { positionId: true, position: { select: { orgUnitId: true } } }
  }) : [];

  const orgUnitIds = [...new Set(employments.flatMap((employment) => employment.position?.orgUnitId ? [employment.position.orgUnitId] : []))];
  const positionIds = [...new Set(employments.flatMap((employment) => employment.positionId ? [employment.positionId] : []))];

  const [orgUnits, positions] = await Promise.all([
    orgUnitIds.length ? db.organizationUnit.findMany({
      where: { tenantId: ctx.tenantId, id: { in: orgUnitIds }, validTo: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }) : [],
    positionIds.length ? db.position.findMany({
      where: { tenantId: ctx.tenantId, id: { in: positionIds }, validTo: null },
      orderBy: [{ title: "asc" }, { positionCode: "asc" }],
      select: { id: true, positionCode: true, title: true, orgUnitId: true }
    }) : []
  ]);

  return Response.json({ data: { relationshipScoped: true, orgUnits, positions } });
}
