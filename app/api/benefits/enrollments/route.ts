import { BenefitEnrollmentStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
  const effectiveFrom = String(body.effectiveFrom ?? "");
  if (!employmentId || !benefitPlanId || !effectiveFrom) return Response.json({ error: "employmentId, benefitPlanId and effectiveFrom are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
    const [employment, plan] = await Promise.all([
      tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.benefitPlan.findFirst({ where: { id: benefitPlanId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !plan) throw new Error("NOT_FOUND");
    const enrollment = await tx.benefitEnrollment.create({ data: {
      tenantId: ctx.tenantId, employmentId, benefitPlanId,
      status: body.status && Object.values(BenefitEnrollmentStatus).includes(body.status as BenefitEnrollmentStatus) ? body.status as BenefitEnrollmentStatus : BenefitEnrollmentStatus.PENDING,
      coverageTier: body.coverageTier ? String(body.coverageTier) : undefined,
      employerContribution: body.employerContribution as string | number | undefined,
      employeeContribution: body.employeeContribution as string | number | undefined,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: body.effectiveTo ? new Date(String(body.effectiveTo)) : undefined
    }});
    await appendAudit(tx, ctx, { action: "benefit-enrollment.created", resourceType: "BenefitEnrollment", resourceId: enrollment.id, classification: DataClassification.RESTRICTED });
    return enrollment;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "NOT_FOUND") return Response.json({ error: "Employment or active benefit plan not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
