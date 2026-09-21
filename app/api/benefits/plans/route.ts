import { BenefitPlanType, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "benefits:read")) return forbidden();
  const data = await db.benefitPlan.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { enrollments: true } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "benefits:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();
  const type = String(body.type ?? "") as BenefitPlanType;
  const effectiveFrom = String(body.effectiveFrom ?? "");
  if (!code || !name || !Object.values(BenefitPlanType).includes(type) || !effectiveFrom) return Response.json({ error: "code, name, valid type and effectiveFrom are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const plan = await tx.benefitPlan.create({ data: {
      tenantId: ctx.tenantId, code, name, type,
      provider: body.provider ? String(body.provider) : undefined,
      countryCode: body.countryCode ? String(body.countryCode).toUpperCase() : undefined,
      currency: body.currency ? String(body.currency).toUpperCase() : undefined,
      employerContribution: body.employerContribution as string | number | undefined,
      employeeContribution: body.employeeContribution as string | number | undefined,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: body.effectiveTo ? new Date(String(body.effectiveTo)) : undefined
    }});
    await appendAudit(tx, ctx, { action: "benefit-plan.created", resourceType: "BenefitPlan", resourceId: plan.id, classification: DataClassification.CONFIDENTIAL });
    return plan;
  });
  return Response.json({ data }, { status: 201 });
}
