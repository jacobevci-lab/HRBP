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
  people: LivePersonRow[];
};

export async function getPeopleWorkspaceData(query = "", tenantId?: string): Promise<PeopleWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant) {
      return { tenantName: "Workspace", active: 0, preboarding: 0, onLeave: 0, dataQuality: 100, needsReview: 0, people: [] };
    }

    const scope = await resolvePeopleScope(db, tenant.id);
    const employmentScope = employmentPrimaryKeyFilter(scope);
    const personScope: Prisma.PersonWhereInput = scope === null
      ? {}
      : {
          employments: {
            some: {
              tenantId: tenant.id,
              status: { not: EmploymentStatus.TERMINATED },
              ...employmentScope
            }
          }
        };
    const normalized = query.trim();
    const where: Prisma.PersonWhereInput = { tenantId: tenant.id, ...personScope };
    if (normalized) {
      where.OR = [
        { givenName: { contains: normalized, mode: "insensitive" } },
        { familyName: { contains: normalized, mode: "insensitive" } },
        { employeeNumber: { contains: normalized, mode: "insensitive" } },
        { workEmail: { contains: normalized, mode: "insensitive" } }
      ];
    }

    const scopedEmploymentBase = { tenantId: tenant.id, ...employmentScope };
    const [people, active, preboarding, onLeave, qualityRows] = await Promise.all([
      db.person.findMany({
        where,
        orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
        take: 250,
        select: {
          id: true,
          employeeNumber: true,
          givenName: true,
          familyName: true,
          workEmail: true,
          employments: {
            where: { status: { not: EmploymentStatus.TERMINATED }, ...scopedEmploymentBase },
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
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.ACTIVE } }),
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.PREBOARDING } }),
      db.employment.count({ where: { ...scopedEmploymentBase, status: EmploymentStatus.LEAVE } }),
      db.person.findMany({
        where: { tenantId: tenant.id, ...personScope },
        select: {
          workEmail: true,
          employments: {
            where: { status: { not: EmploymentStatus.TERMINATED }, ...scopedEmploymentBase },
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
  rows: LivePositionRow[];
};

export async function getPositionsWorkspaceData(tenantId?: string): Promise<PositionsWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant) return { positions: 0, filled: 0, open: 0, planned: 0, critical: 0, rows: [] };
    const scope = await resolvePeopleScope(db, tenant.id);

    const positions = await db.position.findMany({
      where: { tenantId: tenant.id, validTo: null },
      orderBy: { positionCode: "asc" },
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
    });

    return {
      positions: positions.length,
      filled: positions.filter((position) => position.status === PositionStatus.FILLED).length,
      open: positions.filter((position) => position.status === PositionStatus.OPEN).length,
      planned: positions.filter((position) => position.status === PositionStatus.PLANNED).length,
      critical: positions.filter((position) => position.critical).length,
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
