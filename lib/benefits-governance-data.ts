import { BenefitEnrollmentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type BenefitPlanGovernanceRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  provider: string | null;
  countryCode: string | null;
  currency: string | null;
  employerContribution: string | null;
  employeeContribution: string | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  enrollments: number;
  activeEnrollments: number;
  pendingEnrollments: number;
};

export async function getBenefitsGovernanceData(ctx: RequestContext): Promise<BenefitPlanGovernanceRow[]> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const plans = await db.benefitPlan.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ active: "desc" }, { type: "asc" }, { name: "asc" }],
      take: 300,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        provider: true,
        countryCode: true,
        currency: true,
        employerContribution: true,
        employeeContribution: true,
        active: true,
        effectiveFrom: true,
        effectiveTo: true,
        enrollments: {
          where: { ...employmentIdFilter(scope) },
          select: { status: true }
        }
      }
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      type: plan.type,
      provider: plan.provider,
      countryCode: plan.countryCode,
      currency: plan.currency,
      employerContribution: plan.employerContribution?.toString() ?? null,
      employeeContribution: plan.employeeContribution?.toString() ?? null,
      active: plan.active,
      effectiveFrom: plan.effectiveFrom.toISOString(),
      effectiveTo: plan.effectiveTo?.toISOString() ?? null,
      enrollments: plan.enrollments.length,
      activeEnrollments: plan.enrollments.filter((row) => row.status === BenefitEnrollmentStatus.ACTIVE).length,
      pendingEnrollments: plan.enrollments.filter((row) => row.status === BenefitEnrollmentStatus.PENDING).length
    }));
  });
}
