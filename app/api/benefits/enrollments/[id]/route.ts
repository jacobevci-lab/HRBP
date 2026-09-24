import { BenefitEnrollmentStatus, DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseAmount(value: unknown) {
  if (value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) return undefined;
  return amount;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "benefits:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasCoverageTier = Object.prototype.hasOwnProperty.call(body, "coverageTier");
  const hasEmployerContribution = Object.prototype.hasOwnProperty.call(body, "employerContribution");
  const hasEmployeeContribution = Object.prototype.hasOwnProperty.call(body, "employeeContribution");
  const hasEffectiveFrom = Object.prototype.hasOwnProperty.call(body, "effectiveFrom");
  const hasEffectiveTo = Object.prototype.hasOwnProperty.call(body, "effectiveTo");
  if (!hasCoverageTier && !hasEmployerContribution && !hasEmployeeContribution && !hasEffectiveFrom && !hasEffectiveTo) {
    return Response.json({ error: "A pending benefit election field is required." }, { status: 400 });
  }

  const coverageTier = hasCoverageTier ? String(body.coverageTier ?? "").trim().slice(0, 120) || null : undefined;
  const employerContribution = hasEmployerContribution ? parseAmount(body.employerContribution) : undefined;
  const employeeContribution = hasEmployeeContribution ? parseAmount(body.employeeContribution) : undefined;
  const effectiveFrom = hasEffectiveFrom ? parseDate(body.effectiveFrom) : undefined;
  const effectiveTo = hasEffectiveTo ? parseDate(body.effectiveTo) : undefined;
  if (hasEmployerContribution && employerContribution === undefined) return Response.json({ error: "employerContribution must be a non-negative amount or blank." }, { status: 400 });
  if (hasEmployeeContribution && employeeContribution === undefined) return Response.json({ error: "employeeContribution must be a non-negative amount or blank." }, { status: 400 });
  if (hasEffectiveFrom && !effectiveFrom) return Response.json({ error: "effectiveFrom must be a valid date." }, { status: 400 });
  if (hasEffectiveTo && effectiveTo === undefined) return Response.json({ error: "effectiveTo must be a valid date or blank." }, { status: 400 });

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
      if (enrollment.status !== BenefitEnrollmentStatus.PENDING) throw new Error("LOCKED_STATE");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, enrollment.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!enrollment.benefitPlan.active) throw new Error("PLAN_INACTIVE");

      const nextFrom = hasEffectiveFrom ? effectiveFrom! : enrollment.effectiveFrom;
      const nextTo = hasEffectiveTo ? effectiveTo : enrollment.effectiveTo;
      if (nextTo && nextTo < nextFrom) throw new Error("INVALID_RANGE");
      if (nextFrom < enrollment.benefitPlan.effectiveFrom || (enrollment.benefitPlan.effectiveTo && nextFrom > enrollment.benefitPlan.effectiveTo)) throw new Error("OUTSIDE_PLAN_PERIOD");
      if (nextTo && enrollment.benefitPlan.effectiveTo && nextTo > enrollment.benefitPlan.effectiveTo) throw new Error("OUTSIDE_PLAN_PERIOD");

      const result = await tx.benefitEnrollment.updateMany({
        where: { id, tenantId: ctx.tenantId, status: BenefitEnrollmentStatus.PENDING },
        data: {
          ...(hasCoverageTier ? { coverageTier } : {}),
          ...(hasEmployerContribution ? { employerContribution } : {}),
          ...(hasEmployeeContribution ? { employeeContribution } : {}),
          ...(hasEffectiveFrom ? { effectiveFrom: nextFrom } : {}),
          ...(hasEffectiveTo ? { effectiveTo: nextTo } : {})
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.benefitEnrollment.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");
      await appendAudit(tx, ctx, {
        action: "benefit-enrollment.pending-amended",
        resourceType: "BenefitEnrollment",
        resourceId: id,
        classification: DataClassification.RESTRICTED
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Benefit enrollment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "LOCKED_STATE" || code === "STALE_STATE") return Response.json({ error: "Only a current pending benefit election can be amended." }, { status: 409 });
    if (code === "PLAN_INACTIVE") return Response.json({ error: "Pending elections on an inactive benefit plan cannot be amended." }, { status: 409 });
    if (code === "INVALID_RANGE") return Response.json({ error: "effectiveTo cannot be earlier than effectiveFrom." }, { status: 400 });
    if (code === "OUTSIDE_PLAN_PERIOD") return Response.json({ error: "Enrollment dates must remain inside the benefit plan effective period." }, { status: 400 });
    throw error;
  }
}
