import { PolicyExceptionStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(value);
}

export async function getPolicyExceptionQueueData(ctx: RequestContext) {
  if (!can(ctx, "policies:approve")) return [];
  return withDb(async (db) => {
    const rows = await db.policyException.findMany({
      where: { tenantId: ctx.tenantId, status: PolicyExceptionStatus.REQUESTED },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        policyId: true,
        employmentId: true,
        reason: true,
        compensatingControl: true,
        requestedById: true,
        expiresAt: true,
        createdAt: true,
        policy: { select: { code: true, title: true } }
      }
    });
    const employmentIds = [...new Set(rows.map((row) => row.employmentId).filter((value): value is string => Boolean(value)))];
    const employments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
      select: { id: true, person: { select: { givenName: true, familyName: true } } }
    }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, `${employment.person.givenName} ${employment.person.familyName}`]));
    return rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      code: row.policy.code,
      title: row.policy.title,
      employmentId: row.employmentId,
      employee: row.employmentId ? employmentMap.get(row.employmentId) ?? row.employmentId : "Global",
      reason: row.reason,
      compensatingControl: row.compensatingControl ?? "—",
      requestedById: row.requestedById,
      expiresAt: formatDate(row.expiresAt),
      requestedAt: formatDate(row.createdAt)
    }));
  });
}
