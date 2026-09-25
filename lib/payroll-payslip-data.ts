import { DataClassification, PayrollRunStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

const visibleSelfServiceStatuses = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] as const;

export type PayrollPayslipData = Awaited<ReturnType<typeof getPayrollSelfServiceData>>;

export async function getPayrollSelfServiceData(ctx: RequestContext) {
  const employmentId = ctx.employmentId;
  if (!employmentId) throw new Error("EMPLOYMENT_CONTEXT_REQUIRED");

  return withDb((client) => client.$transaction(async (tx) => {
    const employment = await tx.employment.findFirst({
      where: { id: employmentId, tenantId: ctx.tenantId },
      select: {
        id: true,
        person: { select: { employeeNumber: true, givenName: true, familyName: true } },
        position: { select: { title: true, orgUnit: { select: { name: true } } } }
      }
    });
    if (!employment) throw new Error("EMPLOYMENT_CONTEXT_REQUIRED");

    const rows = await tx.payrollResult.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId,
        payrollRun: { status: { in: [...visibleSelfServiceStatuses] } }
      },
      orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
      take: 24,
      select: {
        id: true,
        currency: true,
        grossPay: true,
        taxablePay: true,
        taxAmount: true,
        deductions: true,
        netPay: true,
        employerCost: true,
        calculatedAt: true,
        payrollRun: {
          select: {
            status: true,
            approvedAt: true,
            paidAt: true,
            payrollPeriod: {
              select: {
                code: true,
                startsAt: true,
                endsAt: true,
                payDate: true,
                countryPack: { select: { countryCode: true, name: true, version: true } }
              }
            }
          }
        },
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
    });

    await appendAudit(tx, ctx, {
      action: "payroll-payslip.self-viewed",
      resourceType: "Employment",
      resourceId: employmentId,
      classification: DataClassification.RESTRICTED,
      purpose: "Employee payroll statement self-service"
    });

    const payslips = rows.map((row) => ({
      id: row.id,
      periodCode: row.payrollRun.payrollPeriod.code,
      periodStart: row.payrollRun.payrollPeriod.startsAt.toISOString(),
      periodEnd: row.payrollRun.payrollPeriod.endsAt.toISOString(),
      payDate: row.payrollRun.payrollPeriod.payDate.toISOString(),
      countryCode: row.payrollRun.payrollPeriod.countryPack.countryCode,
      country: row.payrollRun.payrollPeriod.countryPack.name,
      packVersion: row.payrollRun.payrollPeriod.countryPack.version,
      status: row.payrollRun.status,
      approvedAt: row.payrollRun.approvedAt?.toISOString() ?? null,
      paidAt: row.payrollRun.paidAt?.toISOString() ?? null,
      calculatedAt: row.calculatedAt.toISOString(),
      currency: row.currency,
      grossPay: row.grossPay.toString(),
      taxablePay: row.taxablePay.toString(),
      taxAmount: row.taxAmount.toString(),
      deductions: row.deductions.toString(),
      netPay: row.netPay.toString(),
      employerCost: row.employerCost?.toString() ?? null,
      lineItems: row.lineItems.map((line) => ({
        id: line.id,
        type: line.type,
        code: line.code,
        label: line.label,
        quantity: line.quantity?.toString() ?? null,
        rate: line.rate?.toString() ?? null,
        amount: line.amount.toString(),
        taxable: line.taxable
      }))
    })).sort((a, b) => b.payDate.localeCompare(a.payDate));

    return {
      employee: {
        employmentId: employment.id,
        employeeNumber: employment.person.employeeNumber ?? "—",
        name: `${employment.person.givenName} ${employment.person.familyName}`,
        position: employment.position?.title ?? "—",
        organization: employment.position?.orgUnit.name ?? "—"
      },
      payslips
    };
  }));
}
