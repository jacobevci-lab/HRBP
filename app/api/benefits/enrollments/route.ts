import { BenefitEnrollmentStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "benefits:read")) return forbidden();
  const data = await db.benefitEnrollment.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
    include: { benefitPlan: { select: { id: true, code: true, name: true, type: true, currency: true } } },
    take: 250
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "benefits:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "");
  const benefitPlanId = String(body.benefitPlanId ?? "");
  const effectiveFrom = String(body.effectiveFrom ?? "");
  if (!employmentId || !benefitPlanId || !effectiveFrom) return Response.json({ error: "employmentId, benefitPlanId and effectiveFrom are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
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
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Employment or active benefit plan not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
