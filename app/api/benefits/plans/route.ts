import { BenefitPlanType, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOptionalDate(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  return parseDate(value);
}

function parseAmount(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) return undefined;
  return amount;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "benefits:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.benefitPlan.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { enrollments: { where: { ...employmentIdFilter(scope) } } } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "benefits:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const code = String(body.code ?? "").trim().toUpperCase().slice(0, 64);
  const name = String(body.name ?? "").trim().slice(0, 250);
  const type = String(body.type ?? "") as BenefitPlanType;
  const effectiveFrom = parseDate(body.effectiveFrom);
  const effectiveTo = parseOptionalDate(body.effectiveTo);
  const employerContribution = parseAmount(body.employerContribution);
  const employeeContribution = parseAmount(body.employeeContribution);
  const countryCode = String(body.countryCode ?? "").trim().toUpperCase() || null;
  const currency = String(body.currency ?? "").trim().toUpperCase() || null;

  if (!code || !name || !Object.values(BenefitPlanType).includes(type) || !effectiveFrom) return Response.json({ error: "code, name, valid type and valid effectiveFrom are required." }, { status: 400 });
  if (effectiveTo === undefined) return Response.json({ error: "effectiveTo must be a valid date or blank." }, { status: 400 });
  if (effectiveTo && effectiveTo < effectiveFrom) return Response.json({ error: "effectiveTo cannot be earlier than effectiveFrom." }, { status: 400 });
  if (employerContribution === undefined || employeeContribution === undefined) return Response.json({ error: "Contributions must be non-negative amounts or blank." }, { status: 400 });
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return Response.json({ error: "countryCode must be a two-letter code or blank." }, { status: 400 });
  if (currency && !/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "currency must be a three-letter code or blank." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const plan = await tx.benefitPlan.create({ data: {
      tenantId: ctx.tenantId,
      code,
      name,
      type,
      provider: String(body.provider ?? "").trim().slice(0, 250) || undefined,
      countryCode: countryCode ?? undefined,
      currency: currency ?? undefined,
      employerContribution,
      employeeContribution,
      effectiveFrom,
      effectiveTo
    }});
    await appendAudit(tx, ctx, { action: "benefit-plan.created", resourceType: "BenefitPlan", resourceId: plan.id, classification: DataClassification.CONFIDENTIAL });
    return plan;
  });
  return Response.json({ data }, { status: 201 });
}
