import { EmploymentAccessEffect, EmploymentAccessScopeType, EmploymentStatus, PlatformRole } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { resolveEmploymentScopeTarget } from "@/lib/employment-scope-preview";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized, type RequestContext } from "@/lib/request-context";

function countryCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin request blocked.");
  if (!can(ctx, "settings:read") || !can(ctx, "people:read")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const userId = asIdentifier(body.userId);
  const scopeType = typeof body.scopeType === "string" && Object.values(EmploymentAccessScopeType).includes(body.scopeType as EmploymentAccessScopeType)
    ? body.scopeType as EmploymentAccessScopeType
    : null;
  const effect = typeof body.effect === "string" && Object.values(EmploymentAccessEffect).includes(body.effect as EmploymentAccessEffect)
    ? body.effect as EmploymentAccessEffect
    : EmploymentAccessEffect.INCLUDE;
  const scopeKey = scopeType === EmploymentAccessScopeType.COUNTRY ? countryCode(body.scopeKey) : asIdentifier(body.scopeKey);
  if (!userId || !scopeType || !scopeKey) return Response.json({ error: "userId, scopeType and scopeKey must be valid." }, { status: 400 });

  const user = await db.userAccount.findFirst({
    where: { id: userId, tenantId: ctx.tenantId, role: PlatformRole.HRBP, active: true },
    select: { id: true, email: true }
  });
  if (!user) return Response.json({ error: "An active HRBP user was not found in this tenant." }, { status: 404 });

  const selfEmployment = user.email ? await db.employment.findFirst({
    where: {
      tenantId: ctx.tenantId,
      status: { not: EmploymentStatus.TERMINATED },
      person: { is: { workEmail: { equals: user.email, mode: "insensitive" } } }
    },
    orderBy: { startDate: "desc" },
    select: { id: true }
  }) : null;

  const targetIds = await resolveEmploymentScopeTarget(db, ctx.tenantId, scopeType, scopeKey);
  const previewContext: RequestContext = {
    tenantId: ctx.tenantId,
    actorId: user.id,
    role: PlatformRole.HRBP,
    employmentId: selfEmployment?.id
  };
  const currentScope = await resolveEmploymentScope(db, previewContext) ?? [];
  const projected = new Set(currentScope);
  if (effect === EmploymentAccessEffect.INCLUDE) targetIds.forEach((id) => projected.add(id));
  else targetIds.forEach((id) => projected.delete(id));
  if (selfEmployment?.id) projected.add(selfEmployment.id);

  const samples = targetIds.length ? await db.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: targetIds } },
    orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
    take: 8,
    select: {
      id: true,
      person: { select: { employeeNumber: true, givenName: true, familyName: true } },
      position: { select: { title: true, orgUnit: { select: { name: true } } } }
    }
  }) : [];

  return Response.json({
    data: {
      targetCount: targetIds.length,
      currentCount: currentScope.length,
      projectedCount: projected.size,
      delta: projected.size - currentScope.length,
      effect,
      samples
    }
  });
}
