import { DocumentStatus, EmploymentStatus, LifecycleEventType, PositionStatus, Prisma, type PrismaClient } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getServerRequestContext } from "@/lib/server-session";

const STAGING_TENANT_ID = "tenant-acme-global";

async function resolveTenant(db: PrismaClient, requestedTenantId?: string) {
  if (requestedTenantId) {
    return db.tenant.findUnique({ where: { id: requestedTenantId }, select: { id: true, name: true } });
  }
  return (
    (await db.tenant.findUnique({ where: { id: STAGING_TENANT_ID }, select: { id: true, name: true } })) ??
    (await db.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }))
  );
}

async function resolvePeopleScope(db: PrismaClient, tenantId: string) {
  const ctx = await getServerRequestContext();
  if (!ctx) return null;
  if (ctx.tenantId !== tenantId || !can(ctx, "people:read")) return [];
  return resolveEmploymentScope(db, ctx);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

function initials(givenName: string, familyName: string) {
  return `${givenName[0] ?? ""}${familyName[0] ?? ""}`.toUpperCase();
}

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function normalizedEmploymentStatus(value?: string): EmploymentStatus | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === EmploymentStatus.ACTIVE) return EmploymentStatus.ACTIVE;
  if (normalized === EmploymentStatus.PREBOARDING) return EmploymentStatus.PREBOARDING;
  if (normalized === EmploymentStatus.LEAVE) return EmploymentStatus.LEAVE;
  return null;
}

function normalizedPositionStatus(value?: string): PositionStatus | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === PositionStatus.OPEN) return PositionStatus.OPEN;
  if (normalized === PositionStatus.PLANNED) return PositionStatus.PLANNED;
  if (normalized === PositionStatus.FILLED) return PositionStatus.FILLED;
  if (normalized === PositionStatus.FROZEN) return PositionStatus.FROZEN;
  if (normalized === PositionStatus.CLOSED) return PositionStatus.CLOSED;
  return null;
}

type EnterpriseSortDirection = "asc" | "desc";

function peopleOrderBy(sortKey?: string, sortDirection: EnterpriseSortDirection = "asc"): Prisma.PersonOrderByWithRelationInput[] {
  const direction = sortDirection === "desc" ? "desc" as const : "asc" as const;
  if (sortKey === "employeeNumber") return [{ employeeNumber: direction }, { familyName: "asc" }, { givenName: "asc" }];
  return [{ familyName: direction }, { givenName: direction }, { employeeNumber: "asc" }];
}

function positionOrderBy(sortKey?: string, sortDirection: EnterpriseSortDirection = "asc"): Prisma.PositionOrderByWithRelationInput[] {
  const direction = sortDirection === "desc" ? "desc" as const : "asc" as const;
  if (sortKey === "title") return [{ title: direction }, { positionCode: "asc" }];
  if (sortKey === "status") return [{ status: direction }, { positionCode: "asc" }];
  if (sortKey === "critical") return [{ critical: direction }, { positionCode: "asc" }];
  return [{ positionCode: direction }, { title: "asc" }];
}

export type LivePersonRow = {
  id: string;
  employeeNumber: string;
  initials: string;
  name: string;
  workEmail: string;
  position: string;
  positionCode: string;
  department: string;
  location: string;
  status: string;
  startDate: string;
};

export type PeopleWorkspaceData = {
  tenantName: string;
  active: number;
  preboarding: number;
  onLeave: number;
  dataQuality: number;
  needsReview: number;
  filteredTotal: number;
  people: LivePersonRow[];
};

export async function getPeopleWorkspaceData(query = "", tenantId?: string, status?: string, sortKey?: string, sortDirection: EnterpriseSortDirection = "asc"): Promise<PeopleWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant) {
      return { tenantName: "Workspace", active: 0, preboarding: 0, onLeave: 0, dataQuality: 100, needsReview: 0, filteredTotal: 0, people: [] };
    }

    const scope = await resolvePeopleScope(db, tenant.id);
    const employmentScope = employmentPrimaryKeyFilter(scope);
    const statusFilter = normalizedEmploymentStatus(status);
    const normalized = query.trim().slice(0, 160);
    const listEmploymentWhere: Prisma.EmploymentWhereInput = {
      tenantId: tenant.id,
      ...employmentScope,
      status: statusFilter ?? { not: EmploymentStatus.TERMINATED }
    };
    const listPersonScope: Prisma.PersonWhereInput = scope === null && !statusFilter
      ? {}
      : { employments: { some: listEmploymentWhere } };
    const where: Prisma.PersonWhereInput = { tenantId: tenant.id, ...listPersonScope };
    if (normalized) {
      where.OR = [
        { givenName: { contains: normalized, mode: "insensitive" } },
        { familyName: { contains: normalized, mode: "insensitive" } },
        { employeeNumber: { contains: normalized, mode: "insensitive" } },
        { workEmail: { contains: normalized, mode: "insensitive" } }
      ];
    }

    const scopedEmploymentBase: Prisma.EmploymentWhereInput = { tenantId: tenant.id, ...employmentScope };
    const qualityEmploymentWhere: Prisma.EmploymentWhereInput = {
      ...scopedEmploymentBase,
      status: { not: EmploymentStatus.TERMINATED }
    };
    const qualityPersonScope: Prisma.PersonWhereInput = scope === null
      ? {}
      : { employments: { some: qualityEmploymentWhere } };

    const [people, filteredTotal, active, preboarding, onLeave, qualityRows] = await Promise.all([
      db.person.findMany({
        where,
        orderBy: peopleOrderBy(sortKey, sortDirection),
        take: 250,
        select: {
          id: true,
          employeeNumber: true,
          givenName: true,
          familyName: true,
          workEmail: true,
          employments: {
            where: listEmploymentWhere,
            orderBy: { startDate: "desc" },
            take: 1,
            select: {
              status: true,
              startDate: true,
              position: {
                select: {
                  positionCode: true,
                  title: true,
                  location: true,
                  orgUnit: { select: { name: true } }
                }
              }
            }
          }
        }
      }),
      db.person.count({ where }),
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.ACTIVE } }),
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.PREBOARDING } }),
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.LEAVE } }),
      db.person.findMany({
        where: { tenantId: tenant.id, ...qualityPersonScope },
        select: {
          workEmail: true,
          employments: {
            where: qualityEmploymentWhere,
            orderBy: { startDate: "desc" },
            take: 1,
            select: { positionId: true }
          }
        }
      })
    ]);

    const needsReview = qualityRows.filter((person) => !person.workEmail || !person.employments[0]?.positionId).length;
    const dataQuality = qualityRows.length ? Math.round(((qualityRows.length - needsReview) / qualityRows.length) * 1000) / 10 : 100;

    return {
      tenantName: tenant.name,
      active,
      preboarding,
      onLeave,
      dataQuality,
      needsReview,
      filteredTotal,
      people: people.map((person) => {
        const employment = person.employments[0];
        const position = employment?.position;
        return {
          id: person.id,
          employeeNumber: person.employeeNumber ?? "—",
          initials: initials(person.givenName, person.familyName),
          name: `${person.givenName} ${person.familyName}`,
          workEmail: person.workEmail ?? "—",
          position: position?.title ?? "Unassigned",
          positionCode: position?.positionCode ?? "—",
          department: position?.orgUnit.name ?? "Unassigned",
          location: position?.location ?? "—",
          status: employment ? enumLabel(employment.status) : "No employment",
          startDate: employment ? formatDate(employment.startDate) : "—"
        };
      })
    };
  });
}

export type OrganizationRow = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  type: string;
  people: number;
  positions: number;
  depth: number;
};

export type OrganizationWorkspaceData = {
  legalEntities: number;
  organizationUnits: number;
  filledPositions: number;
  vacantPositions: number;
  units: OrganizationRow[];
};

export async function getOrganizationWorkspaceData(tenantId?: string): Promise<OrganizationWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant) return { legalEntities: 0, organizationUnits: 0, filledPositions: 0, vacantPositions: 0, units: [] };

    const units = await db.organizationUnit.findMany({
      where: { tenantId: tenant.id, validTo: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        type: true,
        positions: {
          where: { validTo: null },
          select: {
            id: true,
            status: true,
            employments: {
              where: { status: { not: EmploymentStatus.TERMINATED } },
              select: { id: true }
            }
          }
        }
      }
    });

    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const depthOf = (unit: (typeof units)[number]) => {
      let depth = 0;
      let parentId = unit.parentId;
      const seen = new Set<string>();
      while (parentId && !seen.has(parentId) && depth < 6) {
        seen.add(parentId);
        depth += 1;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return depth;
    };

    const rows = units
      .map((unit) => ({
        id: unit.id,
        parentId: unit.parentId,
        code: unit.code,
        name: unit.name,
        type: enumLabel(unit.type),
        people: new Set(unit.positions.flatMap((position) => position.employments.map((employment) => employment.id))).size,
        positions: unit.positions.length,
        depth: depthOf(unit)
      }))
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

    const allPositions = units.flatMap((unit) => unit.positions);
    return {
      legalEntities: units.filter((unit) => unit.type === "LEGAL_ENTITY").length,
      organizationUnits: units.length,
      filledPositions: allPositions.filter((position) => position.status === PositionStatus.FILLED).length,
      vacantPositions: allPositions.filter((position) => position.status === PositionStatus.OPEN).length,
      units: rows
    };
  });
}

export type LivePositionRow = {
  id: string;
  code: string;
  title: string;
  org: string;
  grade: string;
  location: string;
  incumbent: string;
  status: string;
  critical: boolean;
};

export type PositionsWorkspaceData = {
  positions: number;
  filled: number;
  open: number;
  planned: number;
  critical: number;
  filteredTotal: number;
  rows: LivePositionRow[];
};

export async function getPositionsWorkspaceData(query = "", tenantId?: string, status?: string, sortKey?: string, sortDirection: EnterpriseSortDirection = "asc"): Promise<PositionsWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant) return { positions: 0, filled: 0, open: 0, planned: 0, critical: 0, filteredTotal: 0, rows: [] };
    const scope = await resolvePeopleScope(db, tenant.id);
    const normalized = query.trim().slice(0, 160);
    const statusFilter = normalizedPositionStatus(status);
    const baseWhere: Prisma.PositionWhereInput = { tenantId: tenant.id, validTo: null };
    const where: Prisma.PositionWhereInput = { ...baseWhere };
    if (statusFilter) where.status = statusFilter;
    if (normalized) {
      where.OR = [
        { positionCode: { contains: normalized, mode: "insensitive" } },
        { title: { contains: normalized, mode: "insensitive" } },
        { location: { contains: normalized, mode: "insensitive" } },
        { orgUnit: { name: { contains: normalized, mode: "insensitive" } } }
      ];
    }

    const [positions, filteredTotal, allPositions] = await Promise.all([
      db.position.findMany({
        where,
        orderBy: positionOrderBy(sortKey, sortDirection),
        take: 500,
        select: {
          id: true,
          positionCode: true,
          title: true,
          grade: true,
          location: true,
          status: true,
          critical: true,
          orgUnit: { select: { name: true } },
          employments: {
            where: { status: { not: EmploymentStatus.TERMINATED }, ...employmentPrimaryKeyFilter(scope) },
            orderBy: { startDate: "desc" },
            take: 1,
            select: { person: { select: { givenName: true, familyName: true } } }
          }
        }
      }),
      db.position.count({ where }),
      db.position.findMany({ where: baseWhere, select: { status: true, critical: true } })
    ]);

    return {
      positions: allPositions.length,
      filled: allPositions.filter((position) => position.status === PositionStatus.FILLED).length,
      open: allPositions.filter((position) => position.status === PositionStatus.OPEN).length,
      planned: allPositions.filter((position) => position.status === PositionStatus.PLANNED).length,
      critical: allPositions.filter((position) => position.critical).length,
      filteredTotal,
      rows: positions.map((position) => ({
        id: position.id,
        code: position.positionCode,
        title: position.title,
        org: position.orgUnit.name,
        grade: position.grade ?? "—",
        location: position.location ?? "—",
        incumbent: position.employments[0]
          ? `${position.employments[0].person.givenName} ${position.employments[0].person.familyName}`
          : "—",
        status: enumLabel(position.status),
        critical: position.critical
      }))
    };
  });
}

const employee360Select = {
  id: true,
  employeeNumber: true,
  givenName: true,
  familyName: true,
  workEmail: true,
  personalEmail: true,
  classification: true,
  createdAt: true,
  updatedAt: true,
  employments: {
    where: { status: { not: EmploymentStatus.TERMINATED } },
    orderBy: { startDate: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      managerEmploymentId: true,
      position: {
        select: {
          id: true,
          positionCode: true,
          title: true,
          jobFamily: true,
          grade: true,
          location: true,
          critical: true,
          orgUnit: { select: { id: true, name: true, type: true } }
        }
      },
      manager: { select: { id: true, person: { select: { givenName: true, familyName: true } }, position: { select: { title: true } } } },
      scheduleAssignments: {
        where: { effectiveTo: null },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { effectiveFrom: true, schedule: { select: { code: true, name: true, timezone: true, weeklyMinutes: true } } }
      },
      _count: { select: { directReports: true } }
    }
  },
  lifecycle: {
    orderBy: { effectiveAt: "desc" },
    take: 30,
    select: { id: true, type: true, effectiveAt: true, summary: true }
  }
} satisfies Prisma.PersonSelect;

export type EmploymentHistoryRow = {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  position: string;
  positionCode: string;
  department: string;
  manager: string;
};

export type CompensationHistoryRow = {
  id: string;
  currency: string;
  annualBase: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export type CompensationRequestRow = {
  id: string;
  currency: string;
  currentAnnualBase: string | null;
  proposedAnnualBase: string;
  effectiveAt: string;
  status: string;
  reason: string;
  createdAt: string;
};

export type EmployeeDocumentRow = {
  id: string;
  fileName: string;
  contentType: string;
  purpose: string;
  classification: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  retentionUntil: string;
};

export type ManagerOptionRow = {
  employmentId: string;
  name: string;
  position: string;
};

export type Employee360Data = {
  id: string;
  employmentId?: string;
  employeeNumber: string;
  initials: string;
  name: string;
  workEmail: string;
  personalEmail: string;
  classification: string;
  status: string;
  startDate: string;
  endDate: string;
  position: string;
  positionCode: string;
  jobFamily: string;
  department: string;
  organizationType: string;
  grade: string;
  location: string;
  criticalPosition: boolean;
  manager: string;
  currentManagerEmploymentId?: string;
  directReports: number;
  workSchedule: { name: string; code: string; timezone: string; weeklyHours: string } | null;
  lifecycle: Array<{ id: string; type: string; date: string; summary: string; scheduled: boolean }>;
  employmentHistory: EmploymentHistoryRow[];
  compensationHistory: CompensationHistoryRow[];
  compensationRequests: CompensationRequestRow[];
  documents: EmployeeDocumentRow[];
  managerOptions: ManagerOptionRow[];
  createdAt: string;
  updatedAt: string;
};

export type Employee360Options = {
  tenantId?: string;
  includeCompensation?: boolean;
  includeDocuments?: boolean;
  includeManagerOptions?: boolean;
};

export async function getEmployee360Data(personId?: string, options: Employee360Options = {}): Promise<Employee360Data | null> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, options.tenantId);
    if (!tenant) return null;
    const scope = await resolvePeopleScope(db, tenant.id);
    const scopedEmploymentWhere = {
      tenantId: tenant.id,
      status: { not: EmploymentStatus.TERMINATED },
      ...employmentPrimaryKeyFilter(scope)
    };
    const scopedSelect = {
      ...employee360Select,
      employments: {
        ...employee360Select.employments,
        where: scopedEmploymentWhere
      }
    } satisfies Prisma.PersonSelect;
    const personScope: Prisma.PersonWhereInput = scope === null
      ? {}
      : { employments: { some: scopedEmploymentWhere } };
    const personWhere: Prisma.PersonWhereInput = {
      tenantId: tenant.id,
      ...personScope,
      ...(personId ? { id: personId } : {})
    };

    const person = await db.person.findFirst({
      where: personWhere,
      ...(personId ? {} : { orderBy: { employeeNumber: "asc" as const } }),
      select: scopedSelect
    });

    if (!person) return null;
    const employment = person.employments[0];
    const position = employment?.position;
    const manager = employment?.manager?.person;
    const now = new Date();
    const managerIdFilter = scope === null
      ? (employment ? { id: { not: employment.id } } : {})
      : { id: { in: scope, ...(employment ? { not: employment.id } : {}) } };

    const [employmentHistory, compensationHistory, compensationRequests, documents, managerOptions] = await Promise.all([
      db.employment.findMany({
        where: { tenantId: tenant.id, personId: person.id, ...employmentPrimaryKeyFilter(scope) },
        orderBy: { startDate: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          position: { select: { positionCode: true, title: true, orgUnit: { select: { name: true } } } },
          manager: { select: { person: { select: { givenName: true, familyName: true } } } }
        }
      }),
      options.includeCompensation && employment
        ? db.compensationHistory.findMany({ where: { employmentId: employment.id }, orderBy: { effectiveFrom: "desc" }, take: 20 })
        : Promise.resolve([]),
      options.includeCompensation && employment
        ? db.compensationChange.findMany({
            where: { tenantId: tenant.id, employmentId: employment.id },
            orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
            take: 20,
            select: { id: true, currency: true, currentAnnualBase: true, proposedAnnualBase: true, effectiveAt: true, status: true, reason: true, createdAt: true }
          })
        : Promise.resolve([]),
      options.includeDocuments
        ? db.documentRecord.findMany({
            where: { tenantId: tenant.id, personId: person.id, status: { not: DocumentStatus.DELETED } },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { id: true, fileName: true, contentType: true, purpose: true, classification: true, status: true, createdAt: true, expiresAt: true, retentionUntil: true }
          })
        : Promise.resolve([]),
      options.includeManagerOptions
        ? db.employment.findMany({
            where: {
              tenantId: tenant.id,
              status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] },
              ...managerIdFilter
            },
            orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
            take: 250,
            select: { id: true, person: { select: { givenName: true, familyName: true } }, position: { select: { title: true } } }
          })
        : Promise.resolve([])
    ]);

    return {
      id: person.id,
      employmentId: employment?.id,
      employeeNumber: person.employeeNumber ?? "—",
      initials: initials(person.givenName, person.familyName),
      name: `${person.givenName} ${person.familyName}`,
      workEmail: person.workEmail ?? "—",
      personalEmail: person.personalEmail ?? "—",
      classification: enumLabel(person.classification),
      status: employment ? enumLabel(employment.status) : "No employment",
      startDate: employment ? formatDate(employment.startDate) : "—",
      endDate: employment?.endDate ? formatDate(employment.endDate) : "Open-ended",
      position: position?.title ?? "Unassigned",
      positionCode: position?.positionCode ?? "—",
      jobFamily: position?.jobFamily ?? "Not configured",
      department: position?.orgUnit.name ?? "Unassigned",
      organizationType: position?.orgUnit.type ? enumLabel(position.orgUnit.type) : "—",
      grade: position?.grade ?? "—",
      location: position?.location ?? "—",
      criticalPosition: position?.critical ?? false,
      manager: manager ? `${manager.givenName} ${manager.familyName}` : "Not assigned",
      currentManagerEmploymentId: employment?.managerEmploymentId ?? undefined,
      directReports: employment?._count.directReports ?? 0,
      workSchedule: employment?.scheduleAssignments[0]
        ? {
            name: employment.scheduleAssignments[0].schedule.name,
            code: employment.scheduleAssignments[0].schedule.code,
            timezone: employment.scheduleAssignments[0].schedule.timezone,
            weeklyHours: (employment.scheduleAssignments[0].schedule.weeklyMinutes / 60).toFixed(1)
          }
        : null,
      lifecycle: person.lifecycle.map((event) => ({
        id: event.id,
        type: enumLabel(event.type as LifecycleEventType),
        date: formatDate(event.effectiveAt),
        summary: event.summary,
        scheduled: event.effectiveAt > now
      })),
      employmentHistory: employmentHistory.map((row) => ({
        id: row.id,
        status: enumLabel(row.status),
        startDate: formatDate(row.startDate),
        endDate: row.endDate ? formatDate(row.endDate) : "Current",
        position: row.position?.title ?? "Unassigned",
        positionCode: row.position?.positionCode ?? "—",
        department: row.position?.orgUnit.name ?? "Unassigned",
        manager: row.manager ? `${row.manager.person.givenName} ${row.manager.person.familyName}` : "Not assigned"
      })),
      compensationHistory: compensationHistory.map((row) => ({
        id: row.id,
        currency: row.currency,
        annualBase: row.annualBase.toString(),
        effectiveFrom: formatDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? formatDate(row.effectiveTo) : "Current"
      })),
      compensationRequests: compensationRequests.map((row) => ({
        id: row.id,
        currency: row.currency,
        currentAnnualBase: row.currentAnnualBase?.toString() ?? null,
        proposedAnnualBase: row.proposedAnnualBase.toString(),
        effectiveAt: formatDate(row.effectiveAt),
        status: enumLabel(row.status),
        reason: row.reason ?? "—",
        createdAt: formatDate(row.createdAt)
      })),
      documents: documents.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        purpose: row.purpose,
        classification: enumLabel(row.classification),
        status: enumLabel(row.status),
        createdAt: formatDate(row.createdAt),
        expiresAt: row.expiresAt ? formatDate(row.expiresAt) : "—",
        retentionUntil: row.retentionUntil ? formatDate(row.retentionUntil) : "Policy managed"
      })),
      managerOptions: managerOptions.map((row) => ({
        employmentId: row.id,
        name: `${row.person.givenName} ${row.person.familyName}`,
        position: row.position?.title ?? "Unassigned"
      })),
      createdAt: formatDate(person.createdAt),
      updatedAt: formatDate(person.updatedAt)
    };
  });
}
