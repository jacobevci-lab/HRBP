import { DataClassification, EmploymentStatus, PositionStatus, Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, unauthorized } from "@/lib/request-context";

const EXPORT_LIMIT = 5000;
const peopleColumns = ["position", "department", "location", "status", "start"] as const;
const positionColumns = ["organization", "grade", "location", "incumbent", "status", "critical"] as const;

type Direction = "asc" | "desc";

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function csvResponse(lines: unknown[][], filename: string) {
  const body = `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function tooLarge(moduleKey: string) {
  return Response.json({
    error: `The filtered ${moduleKey} export exceeds ${EXPORT_LIMIT} rows. Narrow the filters before exporting.`
  }, {
    status: 422,
    headers: { "cache-control": "no-store" }
  });
}

function textParam(params: URLSearchParams, name: string, max: number) {
  return (params.get(name) ?? "").trim().slice(0, max);
}

function direction(params: URLSearchParams): Direction | null {
  const raw = params.get("dir");
  if (!raw || raw === "asc") return "asc";
  if (raw === "desc") return "desc";
  return null;
}

function badRequest(message: string) {
  return Response.json({ error: message }, {
    status: 400,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

function validPeopleSort(value: string) {
  return !value || value === "name" || value === "employeeNumber";
}

function validPositionSort(value: string) {
  return !value || value === "code" || value === "title" || value === "status" || value === "critical";
}

function peopleStatus(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === EmploymentStatus.ACTIVE) return EmploymentStatus.ACTIVE;
  if (normalized === EmploymentStatus.PREBOARDING) return EmploymentStatus.PREBOARDING;
  if (normalized === EmploymentStatus.LEAVE) return EmploymentStatus.LEAVE;
  return null;
}

function positionStatus(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === PositionStatus.OPEN) return PositionStatus.OPEN;
  if (normalized === PositionStatus.PLANNED) return PositionStatus.PLANNED;
  if (normalized === PositionStatus.FILLED) return PositionStatus.FILLED;
  if (normalized === PositionStatus.FROZEN) return PositionStatus.FROZEN;
  if (normalized === PositionStatus.CLOSED) return PositionStatus.CLOSED;
  return null;
}

function requestedColumns<T extends readonly string[]>(params: URLSearchParams, allowed: T) {
  if (params.get("columnsMode") !== "custom") return new Set<string>(allowed);
  const allow = new Set<string>(allowed);
  return new Set(params.getAll("columns").slice(0, 12).filter((column) => allow.has(column)));
}

function peopleOrderBy(sortKey: string, dir: Direction): Prisma.PersonOrderByWithRelationInput[] {
  if (sortKey === "employeeNumber") return [{ employeeNumber: dir }, { familyName: "asc" }, { givenName: "asc" }];
  return [{ familyName: dir }, { givenName: dir }, { employeeNumber: "asc" }];
}

function positionOrderBy(sortKey: string, dir: Direction): Prisma.PositionOrderByWithRelationInput[] {
  if (sortKey === "title") return [{ title: dir }, { positionCode: "asc" }];
  if (sortKey === "status") return [{ status: dir }, { positionCode: "asc" }];
  if (sortKey === "critical") return [{ critical: dir }, { positionCode: "asc" }];
  return [{ positionCode: dir }, { title: "asc" }];
}

async function exportPeople(ctx: NonNullable<Awaited<ReturnType<typeof getRequestContext>>>, params: URLSearchParams) {
  if (!can(ctx, "people:read")) return forbidden();

  const query = textParam(params, "q", 160);
  const rawStatus = textParam(params, "status", 40);
  const status = peopleStatus(rawStatus);
  const sortKey = textParam(params, "sort", 40);
  const dir = direction(params);
  if (rawStatus && !status) return badRequest("Invalid people status filter.");
  if (!validPeopleSort(sortKey)) return badRequest("Invalid people sort field.");
  if (!dir) return badRequest("Invalid sort direction.");
  const columns = requestedColumns(params, peopleColumns);
  const scope = await resolveEmploymentScope(db, ctx);
  const employmentScope = employmentPrimaryKeyFilter(scope);
  const employmentWhere: Prisma.EmploymentWhereInput = {
    tenantId: ctx.tenantId,
    ...employmentScope,
    status: status ?? { not: EmploymentStatus.TERMINATED }
  };
  const personScope: Prisma.PersonWhereInput = scope === null && !status
    ? {}
    : { employments: { some: employmentWhere } };
  const where: Prisma.PersonWhereInput = {
    tenantId: ctx.tenantId,
    ...personScope,
    ...(query ? {
      OR: [
        { givenName: { contains: query, mode: "insensitive" } },
        { familyName: { contains: query, mode: "insensitive" } },
        { employeeNumber: { contains: query, mode: "insensitive" } },
        { workEmail: { contains: query, mode: "insensitive" } }
      ]
    } : {})
  };

  const rows = await db.person.findMany({
    where,
    orderBy: peopleOrderBy(sortKey, dir),
    take: EXPORT_LIMIT + 1,
    select: {
      employeeNumber: true,
      givenName: true,
      familyName: true,
      workEmail: true,
      employments: {
        where: employmentWhere,
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
  });
  if (rows.length > EXPORT_LIMIT) return tooLarge("people");

  const header = ["Employee ID", "Name", "Work email"];
  if (columns.has("position")) header.push("Position", "Position code");
  if (columns.has("department")) header.push("Department");
  if (columns.has("location")) header.push("Location");
  if (columns.has("status")) header.push("Status");
  if (columns.has("start")) header.push("Start date");

  const lines: unknown[][] = [header];
  for (const row of rows) {
    const employment = row.employments[0];
    const position = employment?.position;
    const values: unknown[] = [
      row.employeeNumber ?? "",
      `${row.givenName} ${row.familyName}`,
      row.workEmail ?? ""
    ];
    if (columns.has("position")) values.push(position?.title ?? "", position?.positionCode ?? "");
    if (columns.has("department")) values.push(position?.orgUnit.name ?? "");
    if (columns.has("location")) values.push(position?.location ?? "");
    if (columns.has("status")) values.push(employment?.status ?? "");
    if (columns.has("start")) values.push(employment?.startDate.toISOString().slice(0, 10) ?? "");
    lines.push(values);
  }

  await recordAudit({
    ctx,
    action: "PEOPLE_REGISTER_EXPORTED",
    resourceType: "PeopleRegister",
    resourceId: "filtered-register",
    classification: DataClassification.CONFIDENTIAL
  });
  return csvResponse(lines, `hrbp-people-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function exportPositions(ctx: NonNullable<Awaited<ReturnType<typeof getRequestContext>>>, params: URLSearchParams) {
  if (!can(ctx, "positions:read")) return forbidden();

  const query = textParam(params, "q", 160);
  const rawStatus = textParam(params, "status", 40);
  const status = positionStatus(rawStatus);
  const sortKey = textParam(params, "sort", 40);
  const dir = direction(params);
  if (rawStatus && !status) return badRequest("Invalid position status filter.");
  if (!validPositionSort(sortKey)) return badRequest("Invalid position sort field.");
  if (!dir) return badRequest("Invalid sort direction.");
  const columns = requestedColumns(params, positionColumns);
  const peopleScope = can(ctx, "people:read") ? await resolveEmploymentScope(db, ctx) : [];
  const where: Prisma.PositionWhereInput = {
    tenantId: ctx.tenantId,
    validTo: null,
    ...(status ? { status } : {}),
    ...(query ? {
      OR: [
        { positionCode: { contains: query, mode: "insensitive" } },
        { title: { contains: query, mode: "insensitive" } },
        { location: { contains: query, mode: "insensitive" } },
        { orgUnit: { name: { contains: query, mode: "insensitive" } } }
      ]
    } : {})
  };

  const rows = await db.position.findMany({
    where,
    orderBy: positionOrderBy(sortKey, dir),
    take: EXPORT_LIMIT + 1,
    select: {
      positionCode: true,
      title: true,
      grade: true,
      location: true,
      status: true,
      critical: true,
      orgUnit: { select: { name: true } },
      employments: {
        where: {
          status: { not: EmploymentStatus.TERMINATED },
          ...employmentPrimaryKeyFilter(peopleScope)
        },
        orderBy: { startDate: "desc" },
        take: 1,
        select: { person: { select: { givenName: true, familyName: true } } }
      }
    }
  });
  if (rows.length > EXPORT_LIMIT) return tooLarge("positions");

  const header = ["Position code", "Title"];
  if (columns.has("organization")) header.push("Organization");
  if (columns.has("grade")) header.push("Grade");
  if (columns.has("location")) header.push("Location");
  if (columns.has("incumbent")) header.push("Incumbent");
  if (columns.has("status")) header.push("Status");
  if (columns.has("critical")) header.push("Critical");

  const lines: unknown[][] = [header];
  for (const row of rows) {
    const incumbent = row.employments[0]?.person;
    const values: unknown[] = [row.positionCode, row.title];
    if (columns.has("organization")) values.push(row.orgUnit.name);
    if (columns.has("grade")) values.push(row.grade ?? "");
    if (columns.has("location")) values.push(row.location ?? "");
    if (columns.has("incumbent")) values.push(incumbent ? `${incumbent.givenName} ${incumbent.familyName}` : "");
    if (columns.has("status")) values.push(row.status);
    if (columns.has("critical")) values.push(row.critical ? "Yes" : "No");
    lines.push(values);
  }

  await recordAudit({
    ctx,
    action: "POSITIONS_REGISTER_EXPORTED",
    resourceType: "PositionsRegister",
    resourceId: "filtered-register",
    classification: DataClassification.CONFIDENTIAL
  });
  return csvResponse(lines, `hrbp-positions-${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  const params = new URL(request.url).searchParams;
  const moduleKey = params.get("module");
  if (moduleKey === "people") return exportPeople(ctx, params);
  if (moduleKey === "positions") return exportPositions(ctx, params);
  return badRequest("module must be people or positions.");
}
