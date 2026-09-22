import { PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import type { RequestContext } from "@/lib/request-context";

const workforceWideRoles = new Set<PlatformRole>([
  PlatformRole.HRBP,
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TIME_ADMIN,
  PlatformRole.PAYROLL_ADMIN,
  PlatformRole.TENANT_ADMIN
]);

export function hasWorkforceWideAccess(ctx: RequestContext) {
  return workforceWideRoles.has(ctx.role);
}

export async function resolveEmploymentScope(
  client: PrismaClient | Prisma.TransactionClient,
  ctx: RequestContext
): Promise<string[] | null> {
  if (hasWorkforceWideAccess(ctx)) return null;
  if (!ctx.employmentId) return [];

  if (ctx.role === PlatformRole.MANAGER) {
    const rows = await client.employment.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [
          { id: ctx.employmentId },
          { managerEmploymentId: ctx.employmentId }
        ]
      },
      select: { id: true }
    });
    return rows.map((row) => row.id);
  }

  return [ctx.employmentId];
}

export function employmentIdFilter(scope: string[] | null) {
  return scope === null ? {} : { employmentId: { in: scope } };
}

export function employmentPrimaryKeyFilter(scope: string[] | null) {
  return scope === null ? {} : { id: { in: scope } };
}

export function canActOnEmployment(scope: string[] | null, employmentId: string) {
  return scope === null || scope.includes(employmentId);
}
