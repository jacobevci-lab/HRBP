import { DataClassification, EmploymentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function countryCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read") || !can(ctx, "people:read")) return forbidden();

  const [rows, employments] = await Promise.all([
    db.employmentJurisdiction.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ employmentId: "asc" }, { effectiveFrom: "desc" }],
      take: 1500
    }),
    db.employment.findMany({
      where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
      orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
      take: 1000,
      select: {
        id: true,
        person: { select: { employeeNumber: true, givenName: true, familyName: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    })
  ]);
  const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
  return Response.json({
    data: rows.map((row) => ({ ...row, employment: employmentById.get(row.employmentId) ?? null })),
    options: { employments },
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
  const employmentId = asIdentifier(body.employmentId);
  const country = countryCode(body.countryCode);
  const effectiveFrom = asDate(body.effectiveFrom);
  const effectiveTo = body.effectiveTo === undefined || body.effectiveTo === null || body.effectiveTo === "" ? null : asDate(body.effectiveTo);
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 120) || null : null;
  if (!employmentId || !country || !effectiveFrom) return Response.json({ error: "employmentId, ISO alpha-2 countryCode and effectiveFrom are required." }, { status: 400 });
  if (body.effectiveTo && !effectiveTo) return Response.json({ error: "effectiveTo is invalid." }, { status: 400 });
  if (effectiveTo && effectiveTo <= effectiveFrom) return Response.json({ error: "effectiveTo must be later than effectiveFrom." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const employment = await tx.employment.findFirst({
      where: { id: employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
      select: { id: true }
    });
    if (!employment) throw new Error("NOT_FOUND");

    const next = await tx.employmentJurisdiction.findFirst({
      where: { tenantId: ctx.tenantId, employmentId, effectiveFrom: { gt: effectiveFrom } },
      orderBy: { effectiveFrom: "asc" },
      select: { effectiveFrom: true }
    });
    if (effectiveTo && next && effectiveTo >= next.effectiveFrom) throw new Error("OVERLAP");
    const boundedEffectiveTo = effectiveTo ?? (next ? new Date(next.effectiveFrom.getTime() - 1) : null);

    const previous = await tx.employmentJurisdiction.findFirst({
      where: {
        tenantId: ctx.tenantId,
        employmentId,
        effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true }
    });
    if (previous) {
      await tx.employmentJurisdiction.update({
        where: { id: previous.id },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - 1) }
      });
    }

    const existing = await tx.employmentJurisdiction.findUnique({
      where: { employmentId_effectiveFrom: { employmentId, effectiveFrom } }
    });
    const row = existing
      ? await tx.employmentJurisdiction.update({ where: { id: existing.id }, data: { countryCode: country, effectiveTo: boundedEffectiveTo, source } })
      : await tx.employmentJurisdiction.create({ data: { tenantId: ctx.tenantId, employmentId, countryCode: country, effectiveFrom, effectiveTo: boundedEffectiveTo, source } });

    await appendAudit(tx, ctx, {
      action: existing ? "EMPLOYMENT_JURISDICTION_UPDATED" : "EMPLOYMENT_JURISDICTION_ASSIGNED",
      resourceType: "EmploymentJurisdiction",
      resourceId: row.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: `Effective-dated workforce jurisdiction ${country}`
    });
    return row;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OVERLAP"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Active employment was not found in this tenant." }, { status: 404 });
  if (result === "OVERLAP") return Response.json({ error: "The requested effective period overlaps a later jurisdiction record." }, { status: 409 });
  return Response.json({ data: result }, { status: 201 });
}
