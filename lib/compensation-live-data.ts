import { CompensationChangeStatus, EmploymentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(date);
}

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export type CompensationQueueRow = {
  id: string;
  employee: string;
  employeeNumber: string;
  position: string;
  organization: string;
  currency: string;
  currentAnnualBase: string | null;
  proposedAnnualBase: string;
  effectiveAt: string;
  status: string;
  rawStatus: CompensationChangeStatus;
  reason: string;
  requestedById: string;
  approvedById: string | null;
  createdAt: string;
};

export async function getCompensationWorkspaceData(ctx: RequestContext) {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const now = new Date();
    const [currentHistory, changes] = await Promise.all([
      db.compensationHistory.findMany({
        where: {
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          employment: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
          ...employmentIdFilter(scope)
        },
        select: { currency: true, annualBase: true }
      }),
      db.compensationChange.findMany({
        where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
        orderBy: [{ createdAt: "desc" }, { effectiveAt: "desc" }],
        take: 150,
        select: {
          id: true, currency: true, currentAnnualBase: true, proposedAnnualBase: true, effectiveAt: true,
          status: true, reason: true, requestedById: true, approvedById: true, createdAt: true,
          employment: {
            select: {
              person: { select: { employeeNumber: true, givenName: true, familyName: true } },
              position: { select: { title: true, orgUnit: { select: { name: true } } } }
            }
          }
        }
      })
    ]);

    const totalsByCurrency = new Map<string, number>();
    for (const row of currentHistory) totalsByCurrency.set(row.currency, (totalsByCurrency.get(row.currency) ?? 0) + Number(row.annualBase));

    return {
      currentRecords: currentHistory.length,
      pending: changes.filter((change) => change.status === CompensationChangeStatus.APPROVAL).length,
      approved: changes.filter((change) => change.status === CompensationChangeStatus.APPROVED).length,
      applied: changes.filter((change) => change.status === CompensationChangeStatus.APPLIED).length,
      currencies: [...totalsByCurrency.entries()].map(([currency, total]) => ({ currency, total })),
      rows: changes.map<CompensationQueueRow>((change) => ({
        id: change.id,
        employee: `${change.employment.person.givenName} ${change.employment.person.familyName}`,
        employeeNumber: change.employment.person.employeeNumber ?? "—",
        position: change.employment.position?.title ?? "Unassigned",
        organization: change.employment.position?.orgUnit.name ?? "Unassigned",
        currency: change.currency,
        currentAnnualBase: change.currentAnnualBase?.toString() ?? null,
        proposedAnnualBase: change.proposedAnnualBase.toString(),
        effectiveAt: formatDate(change.effectiveAt),
        status: enumLabel(change.status),
        rawStatus: change.status,
        reason: change.reason ?? "—",
        requestedById: change.requestedById,
        approvedById: change.approvedById,
        createdAt: formatDate(change.createdAt)
      }))
    };
  });
}
