import { DataClassification, PayrollPeriodStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:read")) return forbidden();
  const data = await db.payrollPeriod.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { payDate: "desc" },
    include: { countryPack: true, _count: { select: { runs: true } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "payroll:configure")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const countryPackId = asIdentifier(body.countryPackId);
  const code = asText(body.code, 50);
  const startsAt = asDate(body.startsAt);
  const endsAt = asDate(body.endsAt);
  const payDate = asDate(body.payDate);
  if (!countryPackId || !code || !startsAt || !endsAt || !payDate) {
    return Response.json({ error: "countryPackId, code, startsAt, endsAt and payDate are required as valid scalar values." }, { status: 400 });
  }
  if (startsAt >= endsAt) return Response.json({ error: "Payroll period startsAt must be before endsAt." }, { status: 400 });
  if (payDate < endsAt) return Response.json({ error: "Payroll payDate cannot be before the period endsAt date." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const pack = await tx.payrollCountryPack.findFirst({
        where: {
          id: countryPackId,
          tenantId: ctx.tenantId,
          active: true,
          effectiveFrom: { lte: startsAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: endsAt } }]
        },
        select: { id: true }
      });
      if (!pack) throw new Error("PACK_NOT_EFFECTIVE");

      const overlap = await tx.payrollPeriod.findFirst({
        where: {
          tenantId: ctx.tenantId,
          countryPackId,
          startsAt: { lte: endsAt },
          endsAt: { gte: startsAt }
        },
        select: { id: true, code: true }
      });
      if (overlap) throw new Error("PERIOD_OVERLAP");

      const period = await tx.payrollPeriod.create({
        data: { tenantId: ctx.tenantId, countryPackId, code, startsAt, endsAt, payDate, status: PayrollPeriodStatus.OPEN }
      });
      await appendAudit(tx, ctx, {
        action: "payroll-period.created",
        resourceType: "PayrollPeriod",
        resourceId: period.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Payroll period configuration"
      });
      return period;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const codeValue = error instanceof Error ? error.message : "";
    if (codeValue === "PACK_NOT_EFFECTIVE") return Response.json({ error: "An active country pack covering the full payroll period was not found." }, { status: 409 });
    if (codeValue === "PERIOD_OVERLAP") return Response.json({ error: "This country pack already has a payroll period overlapping the requested date range." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return Response.json({ error: "Payroll period creation conflicted with another operation." }, { status: 409 });
    throw error;
  }
}
