import {
  DataClassification,
  EmploymentAccessEffect,
  EmploymentAccessGrantKind,
  EmploymentAccessScopeType,
  EmploymentStatus,
  OrganizationUnitType,
  PlatformRole
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function normalizedCountry(value: unknown) {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read") || !can(ctx, "people:read")) return forbidden();

  const now = new Date();
  const [grants, users, employments, orgUnits, positions, jurisdictionRows] = await Promise.all([
    db.employmentAccessGrant.findMany({
      where: { tenantId: ctx.tenantId, kind: EmploymentAccessGrantKind.HRBP_POPULATION },
      orderBy: [{ userId: "asc" }, { createdAt: "desc" }]
    }),
    db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, role: PlatformRole.HRBP, active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, email: true }
    }),
    db.employment.findMany({
      where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
      orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
      select: {
        id: true,
        person: { select: { employeeNumber: true, givenName: true, familyName: true } },
        position: { select: { id: true, positionCode: true, title: true, orgUnit: { select: { id: true, name: true } } } }
      },
      take: 1000
    }),
    db.organizationUnit.findMany({
      where: { tenantId: ctx.tenantId, validTo: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, parentId: true, code: true, name: true, type: true }
    }),
    db.position.findMany({
      where: { tenantId: ctx.tenantId, validTo: null },
      orderBy: { positionCode: "asc" },
      select: { id: true, positionCode: true, title: true, orgUnit: { select: { name: true } } }
    }),
    db.employmentJurisdiction.findMany({
      where: {
        tenantId: ctx.tenantId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      },
      orderBy: { countryCode: "asc" },
      select: { countryCode: true }
    })
  ]);

  const userById = new Map(users.map((user) => [user.id, user]));
  const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
  const countries = [...new Set(jurisdictionRows.map((row) => row.countryCode.toUpperCase()))].map((code) => ({ code }));

  return Response.json({
    data: grants.map((grant) => ({
      ...grant,
      scopeType: grant.scopeType ?? EmploymentAccessScopeType.EMPLOYMENT,
      scopeKey: grant.scopeKey ?? grant.employmentId,
      effect: grant.effect ?? EmploymentAccessEffect.INCLUDE,
      user: userById.get(grant.userId) ?? null,
      employment: grant.employmentId ? employmentById.get(grant.employmentId) ?? null : null
    })),
    options: { users, employments, orgUnits, positions, countries },
    permissions: { write: can(ctx, "settings:write") }
  });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const userId = asIdentifier(body.userId);
  const scopeType = typeof body.scopeType === "string" && Object.values(EmploymentAccessScopeType).includes(body.scopeType as EmploymentAccessScopeType)
    ? body.scopeType as EmploymentAccessScopeType
    : null;
  const effect = typeof body.effect === "string" && Object.values(EmploymentAccessEffect).includes(body.effect as EmploymentAccessEffect)
    ? body.effect as EmploymentAccessEffect
    : EmploymentAccessEffect.INCLUDE;
  const scopeKey = scopeType === EmploymentAccessScopeType.COUNTRY ? normalizedCountry(body.scopeKey) : asIdentifier(body.scopeKey);
  if (!userId || !scopeType || !scopeKey) return Response.json({ error: "userId, scopeType and scopeKey must be valid." }, { status: 400 });

  const validFrom = body.validFrom === undefined || body.validFrom === null || body.validFrom === "" ? new Date() : asDate(body.validFrom);
  const validTo = body.validTo === undefined || body.validTo === null || body.validTo === "" ? null : asDate(body.validTo);
  if (!validFrom || (body.validTo !== undefined && body.validTo !== null && body.validTo !== "" && !validTo)) {
    return Response.json({ error: "validFrom or validTo is invalid." }, { status: 400 });
  }
  if (validTo && validTo <= validFrom) return Response.json({ error: "validTo must be later than validFrom." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const user = await tx.userAccount.findFirst({
      where: { id: userId, tenantId: ctx.tenantId, role: PlatformRole.HRBP, active: true },
      select: { id: true }
    });
    if (!user) throw new Error("USER_NOT_FOUND");

    if (scopeType === EmploymentAccessScopeType.EMPLOYMENT) {
      const target = await tx.employment.findFirst({ where: { id: scopeKey, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } });
      if (!target) throw new Error("TARGET_NOT_FOUND");
    } else if (scopeType === EmploymentAccessScopeType.ORG_UNIT) {
      const target = await tx.organizationUnit.findFirst({ where: { id: scopeKey, tenantId: ctx.tenantId, validTo: null, type: { not: OrganizationUnitType.LEGAL_ENTITY } }, select: { id: true } });
      if (!target) throw new Error("TARGET_NOT_FOUND");
    } else if (scopeType === EmploymentAccessScopeType.LEGAL_ENTITY) {
      const target = await tx.organizationUnit.findFirst({ where: { id: scopeKey, tenantId: ctx.tenantId, validTo: null, type: OrganizationUnitType.LEGAL_ENTITY }, select: { id: true } });
      if (!target) throw new Error("TARGET_NOT_FOUND");
    } else if (scopeType === EmploymentAccessScopeType.COUNTRY) {
      const target = await tx.employmentJurisdiction.findFirst({
        where: {
          tenantId: ctx.tenantId,
          countryCode: scopeKey,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }]
        },
        select: { id: true }
      });
      if (!target) throw new Error("TARGET_NOT_FOUND");
    } else if (scopeType === EmploymentAccessScopeType.POSITION_TREE) {
      const target = await tx.position.findFirst({ where: { id: scopeKey, tenantId: ctx.tenantId, validTo: null }, select: { id: true } });
      if (!target) throw new Error("TARGET_NOT_FOUND");
    }

    const employmentId = scopeType === EmploymentAccessScopeType.EMPLOYMENT ? scopeKey : null;
    const existing = await tx.employmentAccessGrant.findFirst({
      where: {
        tenantId: ctx.tenantId,
        userId,
        kind: EmploymentAccessGrantKind.HRBP_POPULATION,
        effect,
        OR: [
          { scopeType, scopeKey },
          ...(scopeType === EmploymentAccessScopeType.EMPLOYMENT ? [{ employmentId: scopeKey, scopeKey: null }] : [])
        ]
      }
    });

    const grant = existing
      ? await tx.employmentAccessGrant.update({
          where: { id: existing.id },
          data: { employmentId, scopeType, scopeKey, effect, validFrom, validTo }
        })
      : await tx.employmentAccessGrant.create({
          data: {
            tenantId: ctx.tenantId,
            userId,
            employmentId,
            kind: EmploymentAccessGrantKind.HRBP_POPULATION,
            scopeType,
            scopeKey,
            effect,
            validFrom,
            validTo,
            createdById: ctx.actorId
          }
        });

    await appendAudit(tx, ctx, {
      action: "HRBP_SCOPE_GRANT_UPSERTED",
      resourceType: "EmploymentAccessGrant",
      resourceId: grant.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: `Workforce authorization ${effect}:${scopeType}:${scopeKey}`
    });
    return grant;
  }).catch((error) => error instanceof Error && ["USER_NOT_FOUND", "TARGET_NOT_FOUND"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "USER_NOT_FOUND") return Response.json({ error: "An active HRBP user was not found in this tenant." }, { status: 404 });
  if (result === "TARGET_NOT_FOUND") return Response.json({ error: "The requested workforce scope target is not available in this tenant." }, { status: 404 });
  return Response.json({ data: result }, { status: 201 });
}
