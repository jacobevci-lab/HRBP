import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
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
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasProvider = Object.prototype.hasOwnProperty.call(body, "provider");
  const hasCountry = Object.prototype.hasOwnProperty.call(body, "countryCode");
  const hasCurrency = Object.prototype.hasOwnProperty.call(body, "currency");
  const hasEmployerContribution = Object.prototype.hasOwnProperty.call(body, "employerContribution");
  const hasEmployeeContribution = Object.prototype.hasOwnProperty.call(body, "employeeContribution");
  const hasEffectiveTo = Object.prototype.hasOwnProperty.call(body, "effectiveTo");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  if (!hasName && !hasProvider && !hasCountry && !hasCurrency && !hasEmployerContribution && !hasEmployeeContribution && !hasEffectiveTo && !hasActive) {
    return Response.json({ error: "A benefit plan field is required." }, { status: 400 });
  }

  const name = hasName ? String(body.name ?? "").trim().slice(0, 250) : undefined;
  if (hasName && !name) return Response.json({ error: "name cannot be blank." }, { status: 400 });
  const provider = hasProvider ? String(body.provider ?? "").trim().slice(0, 250) || null : undefined;
  const countryCode = hasCountry ? String(body.countryCode ?? "").trim().toUpperCase() || null : undefined;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return Response.json({ error: "countryCode must be a two-letter code or blank." }, { status: 400 });
  const currency = hasCurrency ? String(body.currency ?? "").trim().toUpperCase() || null : undefined;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "currency must be a three-letter code or blank." }, { status: 400 });
  const employerContribution = hasEmployerContribution ? parseAmount(body.employerContribution) : undefined;
  const employeeContribution = hasEmployeeContribution ? parseAmount(body.employeeContribution) : undefined;
  if (hasEmployerContribution && employerContribution === undefined) return Response.json({ error: "employerContribution must be a non-negative amount or blank." }, { status: 400 });
  if (hasEmployeeContribution && employeeContribution === undefined) return Response.json({ error: "employeeContribution must be a non-negative amount or blank." }, { status: 400 });
  const effectiveTo = hasEffectiveTo ? parseDate(body.effectiveTo) : undefined;
  if (hasEffectiveTo && effectiveTo === undefined) return Response.json({ error: "effectiveTo must be a valid date or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const plan = await tx.benefitPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, active: true, effectiveFrom: true }
      });
      if (!plan) throw new Error("NOT_FOUND");
      if (effectiveTo && effectiveTo < plan.effectiveFrom) throw new Error("INVALID_RANGE");

      const updated = await tx.benefitPlan.update({
        where: { id },
        data: {
          ...(hasName ? { name } : {}),
          ...(hasProvider ? { provider } : {}),
          ...(hasCountry ? { countryCode } : {}),
          ...(hasCurrency ? { currency } : {}),
          ...(hasEmployerContribution ? { employerContribution } : {}),
          ...(hasEmployeeContribution ? { employeeContribution } : {}),
          ...(hasEffectiveTo ? { effectiveTo } : {}),
          ...(hasActive ? { active: Boolean(body.active) } : {})
        }
      });
      await appendAudit(tx, ctx, {
        action: plan.active !== updated.active ? updated.active ? "benefit-plan.reactivated" : "benefit-plan.deactivated" : "benefit-plan.updated",
        resourceType: "BenefitPlan",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Benefit plan not found in tenant." }, { status: 404 });
    if (code === "INVALID_RANGE") return Response.json({ error: "effectiveTo cannot be earlier than effectiveFrom." }, { status: 400 });
    throw error;
  }
}
