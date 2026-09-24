import { BenefitEnrollmentStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
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
  const data = await db.benefitEnrollment.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: { createdAt: "desc" },
    include: { benefitPlan: { select: { id: true, code: true, name: true, type: true, currency: true } } },
    take: 250
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "benefits:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "");
  const benefitPlanId = String(body.benefitPlanId ?? "");
  const effectiveFrom = parseDate(body.effectiveFrom);
  const effectiveTo = parseOptionalDate(body.effectiveTo);
  const employerContribution = parseAmount(body.employerContribution);
  const employeeContribution = parseAmount(body.employeeContribution);
  const coverageTier = String(body.coverageTier ?? "").trim().slice(0, 120) || null;

  if (!employmentId || !benefitPlanId || !effectiveFrom) return Response.json({ error: "employmentId, benefitPlanId and valid effectiveFrom are required." }, { status: 400 });
  if (effectiveTo === undefined) return Response.json({ error: "effectiveTo must be a valid date or blank." }, { status: 400 });
  if (effectiveTo && effectiveTo < effectiveFrom) return Response.json({ error: "effectiveTo cannot be earlier than effectiveFrom." }, { status: 400 });
  if (employerContribution === undefined || employeeContribution === undefined) return Response.json({ error: "Contributions must be non-negative amounts or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
      const [employment, plan] = await Promise.all([
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        tx.benefitPlan.findFirst({ where: { id: benefitPlanId, tenantId: ctx.tenantId, active: true }, select: { id: true, effectiveFrom: true, effectiveTo: true } })
      ]);
      if (!employment || !plan) throw new Error("NOT_FOUND");
      if (effectiveFrom < plan.effectiveFrom || (plan.effectiveTo && effectiveFrom > plan.effectiveTo)) throw new Error("OUTSIDE_PLAN_PERIOD");
      if (effectiveTo && plan.effectiveTo && effectiveTo > plan.effectiveTo) throw new Error("OUTSIDE_PLAN_PERIOD");

      const enrollment = await tx.benefitEnrollment.create({ data: {
        tenantId: ctx.tenantId,
        employmentId,
        benefitPlanId,
        status: BenefitEnrollmentStatus.PENDING,
        coverageTier,
        employerContribution,
        employeeContribution,
        effectiveFrom,
        effectiveTo
      }});
      await appendAudit(tx, ctx, { action: "benefit-enrollment.created-pending", resourceType: "BenefitEnrollment", resourceId: enrollment.id, classification: DataClassification.RESTRICTED });
      return enrollment;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment or active benefit plan not found in tenant." }, { status: 404 });
    if (code === "OUTSIDE_PLAN_PERIOD") return Response.json({ error: "Enrollment effective dates must stay inside the benefit plan effective period." }, { status: 400 });
    throw error;
  }
}
