import { DataClassification, EmploymentAccessGrantKind, EmploymentStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read") || !can(ctx, "people:read")) return forbidden();

  const [grants, users, employments] = await Promise.all([
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
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      },
      take: 500
    })
  ]);

  const userById = new Map(users.map((user) => [user.id, user]));
  const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
  return Response.json({
    data: grants.map((grant) => ({
      ...grant,
      user: userById.get(grant.userId) ?? null,
      employment: employmentById.get(grant.employmentId) ?? null
    })),
    options: { users, employments },
    permissions: { write: can(ctx, "settings:write") }
  });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await request.json() as { userId?: string; employmentId?: string; validFrom?: string; validTo?: string };
  if (!body.userId || !body.employmentId) return Response.json({ error: "userId and employmentId are required." }, { status: 400 });

  const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
  const validTo = body.validTo ? new Date(body.validTo) : null;
  if (Number.isNaN(validFrom.getTime()) || (validTo && Number.isNaN(validTo.getTime()))) {
    return Response.json({ error: "validFrom or validTo is invalid." }, { status: 400 });
  }
  if (validTo && validTo <= validFrom) return Response.json({ error: "validTo must be later than validFrom." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const [user, employment] = await Promise.all([
      tx.userAccount.findFirst({ where: { id: body.userId, tenantId: ctx.tenantId, role: PlatformRole.HRBP, active: true }, select: { id: true } }),
      tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } })
    ]);
    if (!user || !employment) throw new Error("TARGET_NOT_FOUND");

    const grant = await tx.employmentAccessGrant.upsert({
      where: {
        tenantId_userId_employmentId_kind: {
          tenantId: ctx.tenantId,
          userId: body.userId!,
          employmentId: body.employmentId!,
          kind: EmploymentAccessGrantKind.HRBP_POPULATION
        }
      },
      update: { validFrom, validTo },
      create: {
        tenantId: ctx.tenantId,
        userId: body.userId!,
        employmentId: body.employmentId!,
        kind: EmploymentAccessGrantKind.HRBP_POPULATION,
        validFrom,
        validTo,
        createdById: ctx.actorId
      }
    });
    await appendAudit(tx, ctx, {
      action: "HRBP_POPULATION_GRANT_UPSERTED",
      resourceType: "EmploymentAccessGrant",
      resourceId: grant.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Relationship-aware workforce authorization"
    });
    return grant;
  }).catch((error) => error instanceof Error && error.message === "TARGET_NOT_FOUND" ? null : Promise.reject(error));

  if (!result) return Response.json({ error: "HRBP user or active employment was not found in this tenant." }, { status: 404 });
  return Response.json({ data: result }, { status: 201 });
}
