import { BenefitEnrollmentStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<BenefitEnrollmentStatus, BenefitEnrollmentStatus[]> = {
  PENDING: [BenefitEnrollmentStatus.ACTIVE, BenefitEnrollmentStatus.WAIVED, BenefitEnrollmentStatus.ENDED],
  ACTIVE: [BenefitEnrollmentStatus.SUSPENDED, BenefitEnrollmentStatus.ENDED],
  WAIVED: [],
  SUSPENDED: [BenefitEnrollmentStatus.ACTIVE, BenefitEnrollmentStatus.ENDED],
  ENDED: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "benefits:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { status?: string; effectiveTo?: string };
  const next = String(body.status ?? "") as BenefitEnrollmentStatus;
  if (!Object.values(BenefitEnrollmentStatus).includes(next)) return Response.json({ error: "A valid enrollment status is required." }, { status: 400 });
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : undefined;
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) return Response.json({ error: "effectiveTo must be a valid date." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const enrollment = await tx.benefitEnrollment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          benefitPlan: { select: { active: true, effectiveFrom: true, effectiveTo: true } }
        }
      });
      if (!enrollment) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, enrollment.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!(transitions[enrollment.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");

      if (next === BenefitEnrollmentStatus.ACTIVE) {
        if (!enrollment.benefitPlan.active) throw new Error("PLAN_INACTIVE");
        if (enrollment.effectiveFrom < enrollment.benefitPlan.effectiveFrom || (enrollment.benefitPlan.effectiveTo && enrollment.effectiveFrom > enrollment.benefitPlan.effectiveTo)) throw new Error("OUTSIDE_PLAN_PERIOD");
      }

      const ending = next === BenefitEnrollmentStatus.ENDED;
      const endDate = ending ? (effectiveTo ?? new Date()) : enrollment.effectiveTo;
      if (endDate && endDate < enrollment.effectiveFrom) throw new Error("INVALID_END_DATE");
      if (endDate && enrollment.benefitPlan.effectiveTo && endDate > enrollment.benefitPlan.effectiveTo) throw new Error("OUTSIDE_PLAN_PERIOD");

      const result = await tx.benefitEnrollment.updateMany({
        where: { id, tenantId: ctx.tenantId, status: enrollment.status },
        data: {
          status: next,
          effectiveTo: ending ? endDate : next === BenefitEnrollmentStatus.ACTIVE ? null : enrollment.effectiveTo
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.benefitEnrollment.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");
      await appendAudit(tx, ctx, {
        action: `benefit-enrollment.transition.${enrollment.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "BenefitEnrollment",
        resourceId: id,
        classification: DataClassification.RESTRICTED
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Benefit enrollment not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") return Response.json({ error: "Benefit enrollment transition is not allowed from the current state." }, { status: 409 });
    if (code === "INVALID_END_DATE") return Response.json({ error: "Enrollment end date cannot be before its effective start date." }, { status: 400 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Inactive benefit plans cannot activate new coverage." }, { status: 409 });
    if (code === "OUTSIDE_PLAN_PERIOD") return Response.json({ error: "Enrollment dates must remain inside the benefit plan effective period." }, { status: 400 });
    throw error;
  }
}
