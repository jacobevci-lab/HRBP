import { EmploymentAccessGrantKind, EmploymentStatus, PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import type { RequestContext } from "@/lib/request-context";

const workforceWideRoles = new Set<PlatformRole>([
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TIME_ADMIN,
  PlatformRole.TALENT_ADMIN,
  PlatformRole.COMPENSATION_ADMIN,
  PlatformRole.PAYROLL_ADMIN,
  PlatformRole.TENANT_ADMIN
]);

const assignedCaseRoles = new Set<PlatformRole>([
  PlatformRole.ER_INVESTIGATOR,
  PlatformRole.LEGAL,
  PlatformRole.PRIVACY_OFFICER
]);

export function hasWorkforceWideAccess(ctx: RequestContext) {
  return workforceWideRoles.has(ctx.role);
}

export async function resolveEmploymentScope(
  client: PrismaClient | Prisma.TransactionClient,
  ctx: RequestContext
): Promise<string[] | null> {
  if (hasWorkforceWideAccess(ctx)) return null;

  const employmentIds = new Set<string>();
  if (ctx.employmentId) employmentIds.add(ctx.employmentId);

  if (ctx.role === PlatformRole.MANAGER && ctx.employmentId) {
    const rows = await client.employment.findMany({
      where: {
        tenantId: ctx.tenantId,
        managerEmploymentId: ctx.employmentId,
        status: { not: EmploymentStatus.TERMINATED }
      },
      select: { id: true }
    });
    rows.forEach((row) => employmentIds.add(row.id));
  }

  if (ctx.role === PlatformRole.HRBP) {
    const now = new Date();
    const grants = await client.employmentAccessGrant.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.actorId,
        kind: EmploymentAccessGrantKind.HRBP_POPULATION,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }]
      },
      select: { employmentId: true }
    });
    grants.forEach((grant) => employmentIds.add(grant.employmentId));
  }

  if (assignedCaseRoles.has(ctx.role)) {
    const cases = await client.employeeCase.findMany({
      where: {
        tenantId: ctx.tenantId,
        subjectPersonId: { not: null },
        OR: [
          { ownerUserId: ctx.actorId },
          { assignments: { some: { user: { is: { id: ctx.actorId, tenantId: ctx.tenantId, active: true } } } } }
        ]
      },
      select: { subjectPersonId: true }
    });
    const personIds = cases.flatMap((item) => item.subjectPersonId ? [item.subjectPersonId] : []);
    if (personIds.length) {
      const employments = await client.employment.findMany({
        where: {
          tenantId: ctx.tenantId,
          personId: { in: personIds },
          status: { not: EmploymentStatus.TERMINATED }
        },
        select: { id: true }
      });
      employments.forEach((employment) => employmentIds.add(employment.id));
    }
  }

  return [...employmentIds];
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
