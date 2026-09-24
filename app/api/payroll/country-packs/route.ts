import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "payroll:read")) return forbidden();
  const data = await db.payrollCountryPack.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ active: "desc" }, { countryCode: "asc" }, { effectiveFrom: "desc" }]
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
  const countryCode = asText(body.countryCode, 2)?.toUpperCase() ?? null;
  const name = asText(body.name, 120);
  const version = asText(body.version, 40);
  const currency = asText(body.currency, 3)?.toUpperCase() ?? null;
  const effectiveFrom = asDate(body.effectiveFrom);
  const effectiveToText = asOptionalText(body.effectiveTo, 64);
  const effectiveTo = effectiveToText === undefined ? null : effectiveToText === null ? undefined : asDate(effectiveToText);

  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode) || !name || !version || !currency || !/^[A-Z]{3}$/.test(currency) || !effectiveFrom || effectiveTo === undefined) {
    return Response.json({ error: "countryCode, name, version, currency and effectiveFrom are required; country/currency must use ISO-shaped codes." }, { status: 400 });
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) return Response.json({ error: "effectiveTo must be after effectiveFrom when provided." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const pack = await tx.payrollCountryPack.create({
        data: { tenantId: ctx.tenantId, countryCode, name, version, currency, effectiveFrom, effectiveTo: effectiveTo ?? null, active: true }
      });
      await appendAudit(tx, ctx, {
        action: "payroll-country-pack.created",
        resourceType: "PayrollCountryPack",
        resourceId: pack.id,
        classification: DataClassification.INTERNAL,
        purpose: "Payroll jurisdiction configuration"
      });
      return pack;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "This country pack version already exists for the tenant." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Payroll country-pack state changed concurrently. Retry the request." }, { status: 409 });
    throw error;
  }
}
