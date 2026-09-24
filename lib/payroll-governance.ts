import { createHash } from "node:crypto";
import {
  CompensationChangeStatus,
  LeaveRequestStatus,
  PayrollLineType,
  PayrollRunStatus,
  Prisma,
  TimeEntryStatus,
  type PayrollPeriodStatus
} from "@prisma/client";

export type PayrollLedgerLine = {
  type: PayrollLineType;
  code: string;
  label: string;
  quantity?: string | null;
  rate?: string | null;
  amount: string;
  taxable: boolean;
};

export function calculatePayrollLedger(lines: PayrollLedgerLine[]) {
  let grossPay = new Prisma.Decimal(0);
  let taxablePay = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);
  let deductions = new Prisma.Decimal(0);
  let reimbursements = new Prisma.Decimal(0);
  let employerAdditions = new Prisma.Decimal(0);

  for (const line of lines) {
    const amount = new Prisma.Decimal(line.amount);
    if (amount.isNegative()) throw new Error("NEGATIVE_LINE_AMOUNT");
    if (line.type === PayrollLineType.EARNING) {
      grossPay = grossPay.add(amount);
      if (line.taxable) taxablePay = taxablePay.add(amount);
    } else if (line.type === PayrollLineType.TAX) {
      taxAmount = taxAmount.add(amount);
    } else if (line.type === PayrollLineType.DEDUCTION) {
      deductions = deductions.add(amount);
    } else if (line.type === PayrollLineType.REIMBURSEMENT) {
      reimbursements = reimbursements.add(amount);
    } else if (line.type === PayrollLineType.EMPLOYER_COST) {
      employerAdditions = employerAdditions.add(amount);
    }
  }

  const netPay = grossPay.add(reimbursements).sub(taxAmount).sub(deductions);
  if (netPay.isNegative()) throw new Error("NEGATIVE_NET_PAY");
  const employerCost = grossPay.add(employerAdditions);

  return { grossPay, taxablePay, taxAmount, deductions, netPay, employerCost };
}

type PayrollTx = Prisma.TransactionClient;

type ReadinessRun = {
  id: string;
  status: PayrollRunStatus;
  payrollPeriod: {
    id: string;
    status: PayrollPeriodStatus;
    startsAt: Date;
    endsAt: Date;
    payDate: Date;
    countryPack: { countryCode: string; version: string; currency: string };
  };
  results: Array<{
    id: string;
    employmentId: string;
    currency: string;
    grossPay: Prisma.Decimal;
    taxablePay: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    deductions: Prisma.Decimal;
    netPay: Prisma.Decimal;
    employerCost: Prisma.Decimal | null;
    lineItems: Array<{
      id: string;
      type: PayrollLineType;
      code: string;
      label: string;
      quantity: Prisma.Decimal | null;
      rate: Prisma.Decimal | null;
      amount: Prisma.Decimal;
      taxable: boolean;
    }>;
  }>;
};

function ledgerMismatch(run: ReadinessRun) {
  let mismatches = 0;
  for (const result of run.results) {
    if (!result.lineItems.length) {
      mismatches += 1;
      continue;
    }
    const calculated = calculatePayrollLedger(result.lineItems.map((line) => ({
      type: line.type,
      code: line.code,
      label: line.label,
      quantity: line.quantity?.toString() ?? null,
      rate: line.rate?.toString() ?? null,
      amount: line.amount.toString(),
      taxable: line.taxable
    })));
    if (
      !result.grossPay.equals(calculated.grossPay) ||
      !result.taxablePay.equals(calculated.taxablePay) ||
      !result.taxAmount.equals(calculated.taxAmount) ||
      !result.deductions.equals(calculated.deductions) ||
      !result.netPay.equals(calculated.netPay) ||
      !(result.employerCost ?? new Prisma.Decimal(0)).equals(calculated.employerCost)
    ) mismatches += 1;
  }
  return mismatches;
}

async function loadRun(tx: PayrollTx, tenantId: string, runId: string): Promise<ReadinessRun | null> {
  return tx.payrollRun.findFirst({
    where: { id: runId, tenantId },
    select: {
      id: true,
      status: true,
      payrollPeriod: {
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          payDate: true,
          countryPack: { select: { countryCode: true, version: true, currency: true } }
        }
      },
      results: {
        orderBy: { employmentId: "asc" },
        select: {
          id: true,
          employmentId: true,
          currency: true,
          grossPay: true,
          taxablePay: true,
          taxAmount: true,
          deductions: true,
          netPay: true,
          employerCost: true,
          lineItems: {
            orderBy: [{ type: "asc" }, { code: "asc" }, { id: "asc" }],
            select: {
              id: true,
              type: true,
              code: true,
              label: true,
              quantity: true,
              rate: true,
              amount: true,
              taxable: true
            }
          }
        }
      }
    }
  }) as Promise<ReadinessRun | null>;
}

export async function getPayrollRunReadiness(tx: PayrollTx, tenantId: string, runId: string) {
  const run = await loadRun(tx, tenantId, runId);
  if (!run) return null;

  const employmentIds = run.results.map((result) => result.employmentId);
  const noResults = run.results.length ? 0 : 1;
  const currencyMismatch = run.results.filter((result) => result.currency !== run.payrollPeriod.countryPack.currency).length;
  const ledgerMismatches = ledgerMismatch(run);

  const [unlockedTimeEntries, pendingLeaveRequests, pendingCompensationChanges] = employmentIds.length ? await Promise.all([
    tx.timeEntry.count({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        workDate: { gte: run.payrollPeriod.startsAt, lte: run.payrollPeriod.endsAt },
        status: { not: TimeEntryStatus.LOCKED }
      }
    }),
    tx.leaveRequest.count({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        startsAt: { lte: run.payrollPeriod.endsAt },
        endsAt: { gte: run.payrollPeriod.startsAt },
        status: { in: [LeaveRequestStatus.DRAFT, LeaveRequestStatus.PENDING] }
      }
    }),
    tx.compensationChange.count({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        effectiveAt: { lte: run.payrollPeriod.endsAt },
        status: { in: [CompensationChangeStatus.DRAFT, CompensationChangeStatus.APPROVAL, CompensationChangeStatus.APPROVED] }
      }
    })
  ]) : [0, 0, 0];

  const blockers = {
    noResults,
    currencyMismatch,
    ledgerMismatches,
    unlockedTimeEntries,
    pendingLeaveRequests,
    pendingCompensationChanges
  };
  const blockerCount = Object.values(blockers).reduce((sum, value) => sum + value, 0);

  return { run, blockers, blockerCount };
}

export async function computePayrollInputFingerprint(tx: PayrollTx, tenantId: string, runId: string) {
  const readiness = await getPayrollRunReadiness(tx, tenantId, runId);
  if (!readiness) return null;
  const { run } = readiness;
  const employmentIds = run.results.map((result) => result.employmentId);

  const [timeEntries, leaveRequests, compensationChanges, compensationHistory] = employmentIds.length ? await Promise.all([
    tx.timeEntry.findMany({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        workDate: { gte: run.payrollPeriod.startsAt, lte: run.payrollPeriod.endsAt }
      },
      orderBy: [{ employmentId: "asc" }, { workDate: "asc" }, { id: "asc" }],
      select: { id: true, employmentId: true, workDate: true, minutes: true, overtimeMinutes: true, status: true, updatedAt: true }
    }),
    tx.leaveRequest.findMany({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        startsAt: { lte: run.payrollPeriod.endsAt },
        endsAt: { gte: run.payrollPeriod.startsAt }
      },
      orderBy: [{ employmentId: "asc" }, { startsAt: "asc" }, { id: "asc" }],
      select: { id: true, employmentId: true, startsAt: true, endsAt: true, units: true, status: true, updatedAt: true }
    }),
    tx.compensationChange.findMany({
      where: { tenantId, employmentId: { in: employmentIds }, effectiveAt: { lte: run.payrollPeriod.endsAt } },
      orderBy: [{ employmentId: "asc" }, { effectiveAt: "asc" }, { id: "asc" }],
      select: { id: true, employmentId: true, currency: true, proposedAnnualBase: true, effectiveAt: true, status: true }
    }),
    tx.compensationHistory.findMany({
      where: {
        employmentId: { in: employmentIds },
        effectiveFrom: { lte: run.payrollPeriod.endsAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.payrollPeriod.startsAt } }]
      },
      orderBy: [{ employmentId: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
      select: { id: true, employmentId: true, currency: true, annualBase: true, effectiveFrom: true, effectiveTo: true }
    })
  ]) : [[], [], [], []];

  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Prisma.Decimal) return value.toString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalize(item)]));
    return value;
  };

  const payload = normalize({
    period: run.payrollPeriod,
    results: run.results,
    timeEntries,
    leaveRequests,
    compensationChanges,
    compensationHistory
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function getLockedPayrollInputFingerprint(tx: PayrollTx, tenantId: string, runId: string) {
  const audit = await tx.auditEvent.findFirst({
    where: { tenantId, resourceType: "PayrollRun", resourceId: runId, action: "payroll-run.inputs-locked" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { purpose: true }
  });
  const match = audit?.purpose?.match(/sha256:([a-f0-9]{64})/i);
  return match?.[1]?.toLowerCase() ?? null;
}
