import { EmploymentAccessScopeType, EmploymentStatus, OrganizationUnitType, Prisma, PrismaClient } from "@prisma/client";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

type EmploymentGraphRow = {
  id: string;
  managerEmploymentId: string | null;
  positionId: string | null;
  position: { orgUnitId: string } | null;
};

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

function positionTreeIds(rootPositionId: string, employments: EmploymentGraphRow[]) {
  const children = new Map<string, string[]>();
  for (const employment of employments) {
    if (!employment.managerEmploymentId) continue;
    const current = children.get(employment.managerEmploymentId) ?? [];
    current.push(employment.id);
    children.set(employment.managerEmploymentId, current);
  }
  const result = new Set<string>();
  const queue = employments.filter((employment) => employment.positionId === rootPositionId).map((employment) => employment.id);
  while (queue.length) {
    const employmentId = queue.shift();
    if (!employmentId || result.has(employmentId)) continue;
    result.add(employmentId);
    for (const child of children.get(employmentId) ?? []) queue.push(child);
  }
  return [...result];
}

export async function resolveEmploymentScopeTarget(
  client: ScopeClient,
  tenantId: string,
  scopeType: EmploymentAccessScopeType,
  scopeKey: string,
  at = new Date()
) {
  if (scopeType === EmploymentAccessScopeType.EMPLOYMENT) {
    const employment = await client.employment.findFirst({
      where: { id: scopeKey, tenantId, status: { not: EmploymentStatus.TERMINATED } },
      select: { id: true }
    });
    return employment ? [employment.id] : [];
  }

  if (scopeType === EmploymentAccessScopeType.COUNTRY) {
    const rows = await client.employmentJurisdiction.findMany({
      where: {
        tenantId,
        countryCode: scopeKey.toUpperCase(),
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        employment: { is: { tenantId, status: { not: EmploymentStatus.TERMINATED } } }
      },
      select: { employmentId: true }
    });
    return [...new Set(rows.map((row) => row.employmentId))];
  }

  const employments = await client.employment.findMany({
    where: { tenantId, status: { not: EmploymentStatus.TERMINATED } },
    select: {
      id: true,
      managerEmploymentId: true,
      positionId: true,
      position: { select: { orgUnitId: true } }
    }
  });

  if (scopeType === EmploymentAccessScopeType.POSITION_TREE) return positionTreeIds(scopeKey, employments);

  const orgUnits = await client.organizationUnit.findMany({
    where: { tenantId, validTo: null },
    select: { id: true, parentId: true, type: true }
  });
  const root = orgUnits.find((unit) => unit.id === scopeKey);
  if (!root) return [];
  if (scopeType === EmploymentAccessScopeType.LEGAL_ENTITY && root.type !== OrganizationUnitType.LEGAL_ENTITY) return [];
  if (scopeType === EmploymentAccessScopeType.ORG_UNIT && root.type === OrganizationUnitType.LEGAL_ENTITY) return [];

  const orgIds = collectOrgDescendants(scopeKey, orgUnits);
  return employments.filter((employment) => employment.position?.orgUnitId && orgIds.has(employment.position.orgUnitId)).map((employment) => employment.id);
}
