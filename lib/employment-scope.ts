import {
  EmploymentAccessEffect,
  EmploymentAccessGrantKind,
  EmploymentAccessScopeType,
  EmploymentStatus,
  OrganizationUnitType,
  PlatformRole,
  Prisma,
  PrismaClient
} from "@prisma/client";
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

type ScopeClient = PrismaClient | Prisma.TransactionClient;
type EmploymentGraphRow = {
  id: string;
  managerEmploymentId: string | null;
  positionId: string | null;
  position: { orgUnitId: string } | null;
};

function addPositionTree(target: Set<string>, rootPositionId: string, employments: EmploymentGraphRow[]) {
  const children = new Map<string, string[]>();
  for (const employment of employments) {
    if (!employment.managerEmploymentId) continue;
    const current = children.get(employment.managerEmploymentId) ?? [];
    current.push(employment.id);
    children.set(employment.managerEmploymentId, current);
  }

  const queue = employments.filter((employment) => employment.positionId === rootPositionId).map((employment) => employment.id);
  const seen = new Set<string>();
  while (queue.length) {
    const employmentId = queue.shift();
    if (!employmentId || seen.has(employmentId)) continue;
    seen.add(employmentId);
    target.add(employmentId);
    for (const child of children.get(employmentId) ?? []) queue.push(child);
  }
}

function collectOrgDescendants(rootId: string, units: Array<{ id: string; parentId: string | null }>) {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (unit.parentId && result.has(unit.parentId) && !result.has(unit.id)) {
        result.add(unit.id);
        changed = true;
      }
    }
  }
  return result;
}

async function resolveHrbpGrantScope(client: ScopeClient, ctx: RequestContext, base: Set<string>) {
  const now = new Date();
  const grants = await client.employmentAccessGrant.findMany({
    where: {
      tenantId: ctx.tenantId,
      userId: ctx.actorId,
      kind: EmploymentAccessGrantKind.HRBP_POPULATION,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }]
    },
    select: {
      employmentId: true,
      scopeType: true,
      scopeKey: true,
      effect: true
    }
  });
  if (!grants.length) return base;

  const [employments, orgUnits, jurisdictions] = await Promise.all([
    client.employment.findMany({
      where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
      select: {
        id: true,
        managerEmploymentId: true,
        positionId: true,
        position: { select: { orgUnitId: true } }
      }
    }),
    client.organizationUnit.findMany({
      where: { tenantId: ctx.tenantId, validTo: null },
      select: { id: true, parentId: true, type: true }
    }),
    client.employmentJurisdiction.findMany({
      where: {
        tenantId: ctx.tenantId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      },
      select: { employmentId: true, countryCode: true }
    })
  ]);

  const employmentIds = new Set(employments.map((employment) => employment.id));
  const includes = new Set<string>();
  const excludes = new Set<string>();
  const orgById = new Map(orgUnits.map((unit) => [unit.id, unit]));
  const countryByEmployment = new Map(jurisdictions.map((item) => [item.employmentId, item.countryCode.toUpperCase()]));

  for (const grant of grants) {
    const type = grant.scopeType ?? EmploymentAccessScopeType.EMPLOYMENT;
    const key = grant.scopeKey ?? grant.employmentId;
    if (!key) continue;
    const target = grant.effect === EmploymentAccessEffect.EXCLUDE ? excludes : includes;

    if (type === EmploymentAccessScopeType.EMPLOYMENT) {
      if (employmentIds.has(key)) target.add(key);
      continue;
    }

    if (type === EmploymentAccessScopeType.ORG_UNIT || type === EmploymentAccessScopeType.LEGAL_ENTITY) {
      const root = orgById.get(key);
      if (!root) continue;
      if (type === EmploymentAccessScopeType.LEGAL_ENTITY && root.type !== OrganizationUnitType.LEGAL_ENTITY) continue;
      const descendantIds = collectOrgDescendants(key, orgUnits);
      for (const employment of employments) {
        if (employment.position?.orgUnitId && descendantIds.has(employment.position.orgUnitId)) target.add(employment.id);
      }
      continue;
    }

    if (type === EmploymentAccessScopeType.COUNTRY) {
      const country = key.toUpperCase();
      for (const employment of employments) {
        if (countryByEmployment.get(employment.id) === country) target.add(employment.id);
      }
      continue;
    }

    if (type === EmploymentAccessScopeType.POSITION_TREE) {
      addPositionTree(target, key, employments);
    }
  }

  for (const employmentId of includes) base.add(employmentId);
  for (const employmentId of excludes) base.delete(employmentId);
  if (ctx.employmentId) base.add(ctx.employmentId);
  return base;
}

export async function resolveEmploymentScope(
  client: ScopeClient,
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
    await resolveHrbpGrantScope(client, ctx, employmentIds);
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
