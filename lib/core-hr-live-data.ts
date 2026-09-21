import { EmploymentStatus, LifecycleEventType, PositionStatus, Prisma, type PrismaClient } from "@prisma/client";
import { withDb } from "@/lib/db";

const STAGING_TENANT_ID = "tenant-acme-global";

async function resolveTenant(db: PrismaClient) {
  return (
    (await db.tenant.findUnique({ where: { id: STAGING_TENANT_ID }, select: { id: true, name: true } })) ??
    (await db.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }))
  );
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

export async function getPeopleWorkspaceData(query = ""): Promise<PeopleWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db);
    if (!tenant) {
      return { tenantName: "Workspace", active: 0, preboarding: 0, onLeave: 0, dataQuality: 100, needsReview: 0, people: [] };
    }

    const normalized = query.trim();
    const where: Prisma.PersonWhereInput = { tenantId: tenant.id };
    if (normalized) {
      where.OR = [
        { givenName: { contains: normalized, mode: "insensitive" } },
        { familyName: { contains: normalized, mode: "insensitive" } },
        { employeeNumber: { contains: normalized, mode: "insensitive" } },
        { workEmail: { contains: normalized, mode: "insensitive" } }
      ];
    }

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
            where: { status: { not: EmploymentStatus.TERMINATED } },
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
      db.employment.count({ where: { tenantId: tenant.id, status: EmploymentStatus.ACTIVE } }),
      db.employment.count({ where: { tenantId: tenant.id, status: EmploymentStatus.PREBOARDING } }),
      db.employment.count({ where: { tenantId: tenant.id, status: EmploymentStatus.LEAVE } }),
      db.person.findMany({
        where: { tenantId: tenant.id },
        select: {
          workEmail: true,
          employments: {
            where: { status: { not: EmploymentStatus.TERMINATED } },
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

export async function getOrganizationWorkspaceData(): Promise<OrganizationWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db);
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

export async function getPositionsWorkspaceData(): Promise<PositionsWorkspaceData> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db);
    if (!tenant) return { positions: 0, filled: 0, open: 0, planned: 0, critical: 0, rows: [] };

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
          where: { status: { not: EmploymentStatus.TERMINATED } },
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
  classification: true,
  employments: {
    where: { status: { not: EmploymentStatus.TERMINATED } },
    orderBy: { startDate: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      startDate: true,
      position: {
        select: {
          positionCode: true,
          title: true,
          grade: true,
          location: true,
          orgUnit: { select: { name: true } }
        }
      },
      manager: { select: { person: { select: { givenName: true, familyName: true } } } }
    }
  },
  lifecycle: {
    orderBy: { effectiveAt: "desc" },
    take: 10,
    select: { id: true, type: true, effectiveAt: true, summary: true }
  }
} satisfies Prisma.PersonSelect;

export type Employee360Data = {
  id: string;
  employeeNumber: string;
  initials: string;
  name: string;
  workEmail: string;
  classification: string;
  status: string;
  startDate: string;
  position: string;
  positionCode: string;
  department: string;
  grade: string;
  location: string;
  manager: string;
  lifecycle: Array<{ id: string; type: string; date: string; summary: string; scheduled: boolean }>;
};

export async function getEmployee360Data(personId?: string): Promise<Employee360Data | null> {
  return withDb(async (db) => {
    const tenant = await resolveTenant(db);
    if (!tenant) return null;

    const person = personId
      ? await db.person.findFirst({ where: { id: personId, tenantId: tenant.id }, select: employee360Select })
      : await db.person.findFirst({ where: { tenantId: tenant.id }, orderBy: { employeeNumber: "asc" }, select: employee360Select });

    if (!person) return null;
    const employment = person.employments[0];
    const position = employment?.position;
    const manager = employment?.manager?.person;
    const now = new Date();

    return {
      id: person.id,
      employeeNumber: person.employeeNumber ?? "—",
      initials: initials(person.givenName, person.familyName),
      name: `${person.givenName} ${person.familyName}`,
      workEmail: person.workEmail ?? "—",
      classification: enumLabel(person.classification),
      status: employment ? enumLabel(employment.status) : "No employment",
      startDate: employment ? formatDate(employment.startDate) : "—",
      position: position?.title ?? "Unassigned",
      positionCode: position?.positionCode ?? "—",
      department: position?.orgUnit.name ?? "Unassigned",
      grade: position?.grade ?? "—",
      location: position?.location ?? "—",
      manager: manager ? `${manager.givenName} ${manager.familyName}` : "Not assigned",
      lifecycle: person.lifecycle.map((event) => ({
        id: event.id,
        type: enumLabel(event.type as LifecycleEventType),
        date: formatDate(event.effectiveAt),
        summary: event.summary,
        scheduled: event.effectiveAt > now
      }))
    };
  });
}
