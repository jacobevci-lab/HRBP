import { DataClassification, PayrollLineType, PayrollRunStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDecimalInput, asEnumValue, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { calculatePayrollLedger, type PayrollLedgerLine } from "@/lib/payroll-governance";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const editableRunStatuses = new Set<PayrollRunStatus>([PayrollRunStatus.DRAFT, PayrollRunStatus.EXCEPTION]);

function normalizeLine(value: unknown): PayrollLedgerLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const type = asEnumValue(row.type, Object.values(PayrollLineType));
  const code = asText(row.code, 40);
  const label = asText(row.label, 120);
  const amount = asDecimalInput(row.amount, 18, 2);
  const quantity = row.quantity === undefined || row.quantity === null || row.quantity === "" ? undefined : asDecimalInput(row.quantity, 12, 4);
  const rate = row.rate === undefined || row.rate === null || row.rate === "" ? undefined : asDecimalInput(row.rate, 18, 4);
  if (!type || !code || !label || !amount || quantity === null || rate === null) return null;
  if (new Prisma.Decimal(amount).isNegative()) return null;
  if (quantity !== undefined && new Prisma.Decimal(quantity).isNegative()) return null;
  if (rate !== undefined && new Prisma.Decimal(rate).isNegative()) return null;
  return { type, code, label, amount, quantity, rate, taxable: row.taxable === true };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "payroll:prepare")) return forbidden();

  const runId = asIdentifier((await params).id);
  if (!runId) return Response.json({ error: "A valid payroll run id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const employmentId = asIdentifier(body.employmentId);
  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : null;
  if (!employmentId || !rawLines || !rawLines.length || rawLines.length > 250) {
    return Response.json({ error: "employmentId and between 1 and 250 payroll line items are required." }, { status: 400 });
  }
  const lines = rawLines.map(normalizeLine);
  if (lines.some((line) => !line)) return Response.json({ error: "Every payroll line requires a valid type, code, label and non-negative amount." }, { status: 400 });

  let ledger;
  try {
    ledger = calculatePayrollLedger(lines as PayrollLedgerLine[]);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NEGATIVE_NET_PAY") return Response.json({ error: "Payroll line items produce a negative net pay result." }, { status: 409 });
    throw error;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: runId, tenantId: ctx.tenantId },
        select: {
          id: true,
          status: true,
          payrollPeriod: {
            select: {
              startsAt: true,
              endsAt: true,
              countryPack: { select: { currency: true } }
            }
          }
        }
      });
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (!editableRunStatuses.has(run.status)) throw new Error("RUN_LOCKED");

      const employment = await tx.employment.findFirst({
        where: {
          id: employmentId,
          tenantId: ctx.tenantId,
          startDate: { lte: run.payrollPeriod.endsAt },
          OR: [{ endDate: null }, { endDate: { gte: run.payrollPeriod.startsAt } }]
        },
        select: { id: true }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");

      const existing = await tx.payrollResult.findUnique({
        where: { payrollRunId_employmentId: { payrollRunId: run.id, employmentId } },
        select: { id: true }
      });
      if (existing) await tx.payrollLineItem.deleteMany({ where: { tenantId: ctx.tenantId, payrollResultId: existing.id } });

      const payrollResult = await tx.payrollResult.upsert({
        where: { payrollRunId_employmentId: { payrollRunId: run.id, employmentId } },
        update: {
          currency: run.payrollPeriod.countryPack.currency,
          grossPay: ledger.grossPay,
          taxablePay: ledger.taxablePay,
          taxAmount: ledger.taxAmount,
          deductions: ledger.deductions,
          netPay: ledger.netPay,
          employerCost: ledger.employerCost,
          calculatedAt: new Date()
        },
        create: {
          tenantId: ctx.tenantId,
          payrollRunId: run.id,
          employmentId,
          currency: run.payrollPeriod.countryPack.currency,
          grossPay: ledger.grossPay,
          taxablePay: ledger.taxablePay,
          taxAmount: ledger.taxAmount,
          deductions: ledger.deductions,
          netPay: ledger.netPay,
          employerCost: ledger.employerCost,
          classification: DataClassification.RESTRICTED
        }
      });

      await tx.payrollLineItem.createMany({
        data: (lines as PayrollLedgerLine[]).map((line) => ({
          tenantId: ctx.tenantId,
          payrollResultId: payrollResult.id,
          type: line.type,
          code: line.code,
          label: line.label,
          quantity: line.quantity ?? null,
          rate: line.rate ?? null,
          amount: line.amount,
          taxable: line.taxable
        }))
      });

      await appendAudit(tx, ctx, {
        action: "payroll-result.loaded",
        resourceType: "PayrollResult",
        resourceId: payrollResult.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Payroll run ${run.id} governed result ledger`
      });
      return payrollResult;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RUN_NOT_FOUND") return Response.json({ error: "Payroll run not found in tenant." }, { status: 404 });
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment is not active within the payroll period." }, { status: 404 });
    if (code === "RUN_LOCKED") return Response.json({ error: "Payroll result lines can only be loaded while the run is DRAFT or EXCEPTION." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Payroll result state changed concurrently. Retry the load." }, { status: 409 });
    throw error;
  }
}
