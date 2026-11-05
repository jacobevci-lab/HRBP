import { asDateOnly, asEmailAddress, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification, EmploymentStatus, LifecycleEventType, PositionStatus, Prisma } from "@prisma/client";
import { withDb, db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { appendAudit } from "@/lib/audit";
import { canCreateEmployeeMasterRecord } from "@/lib/workforce-master-data-access";
import { privateJson } from "@/lib/private-json";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "people:read")) return forbidden();
  const pagination = parseApiPagination(request);
  if (!pagination) return privateJson({ error: "page must be 1–10000 and limit must be 1–200; each parameter may appear only once." }, { status: 400 });

  const scope = await resolveEmploymentScope(db, ctx);
  const employmentWhere = {
    status: { not: EmploymentStatus.TERMINATED },
    ...employmentPrimaryKeyFilter(scope)
  };
  const where = {
    tenantId: ctx.tenantId,
    ...(scope === null ? {} : { employments: { some: employmentWhere } })
  };
  const [people, total] = await Promise.all([
    db.person.findMany({
      where,
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true, employeeNumber: true, givenName: true, familyName: true, workEmail: true, classification: true,
        employments: { where: employmentWhere, orderBy: [{ startDate: "desc" }, { id: "desc" }], take: 1, select: {
          id: true, status: true, startDate: true,
          position: { select: { id: true, positionCode: true, title: true, orgUnit: { select: { id: true, name: true } } } }
        }}
      }
    }),
    db.person.count({ where })
  ]);
  return privateJson({ data: people, meta: paginationMeta(pagination.page, pagination.limit, total) });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!canCreateEmployeeMasterRecord(ctx)) {
    return forbidden("Creating a workforce master record requires an operational tenant-wide role.");
  }

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return privateJson({ error: "A bounded JSON object body is required." }, { status: 400 });
  const givenName = asText(body.givenName, 100);
  const familyName = asText(body.familyName, 100);
  const employeeNumber = asIdentifier(body.employeeNumber, 64);
  const workEmail = asEmailAddress(body.workEmail);
  const positionId = asIdentifier(body.positionId);
  const startDate = asDateOnly(body.startDate);

  if (!givenName || !familyName || !employeeNumber || !workEmail || !positionId || !startDate) {
    return privateJson({
      error: "A valid employeeNumber, givenName, familyName, workEmail, positionId and YYYY-MM-DD startDate are required."
    }, { status: 400 });
  }

  const now = new Date();
  const status = startDate.getTime() > now.getTime() ? EmploymentStatus.PREBOARDING : EmploymentStatus.ACTIVE;

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      const position = await tx.position.findFirst({
        where: { id: positionId, tenantId: ctx.tenantId, validTo: null },
        select: {
          id: true,
          title: true,
          status: true,
          employments: {
            where: { status: { not: EmploymentStatus.TERMINATED } },
            take: 1,
            select: { id: true }
          }
        }
      });

      if (!position) throw new Error("POSITION_NOT_FOUND");
      if (position.status !== PositionStatus.OPEN) throw new Error("POSITION_NOT_AVAILABLE");
      if (position.employments.length) throw new Error("POSITION_OCCUPIED");

      const duplicate = await tx.person.findFirst({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { employeeNumber },
            { workEmail: { equals: workEmail, mode: "insensitive" } }
          ]
        },
        select: { id: true }
      });
      if (duplicate) throw new Error("PERSON_DUPLICATE");

      const positionClaim = await tx.position.updateMany({
        where: { id: position.id, tenantId: ctx.tenantId, status: PositionStatus.OPEN, validTo: null },
        data: { status: PositionStatus.FILLED }
      });
      if (positionClaim.count !== 1) throw new Error("STATE_CONFLICT");

      const person = await tx.person.create({
        data: {
          tenantId: ctx.tenantId,
          givenName,
          familyName,
          employeeNumber,
          workEmail,
          classification: DataClassification.CONFIDENTIAL
        }
      });

      const employment = await tx.employment.create({
        data: {
          tenantId: ctx.tenantId,
          personId: person.id,
          positionId: position.id,
          status,
          startDate
        }
      });

      await tx.employeeLifecycleEvent.create({
        data: {
          tenantId: ctx.tenantId,
          personId: person.id,
          employmentId: employment.id,
          type: LifecycleEventType.HIRED,
          effectiveAt: startDate,
          summary: `Hired as ${position.title}`,
          actorId: ctx.actorId
        }
      });

      if (status === EmploymentStatus.PREBOARDING) {
        await tx.onboardingPlan.create({
          data: {
            tenantId: ctx.tenantId,
            personId: person.id,
            employmentId: employment.id,
            status: "IN_PROGRESS",
            targetStartDate: startDate,
            ownerId: ctx.actorId
          }
        });
      }

      await appendAudit(tx, ctx, {
        action: "PERSON_CREATED",
        resourceType: "Person",
        resourceId: person.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Employee administration"
      });
      await appendAudit(tx, ctx, {
        action: "EMPLOYMENT_CREATED",
        resourceType: "Employment",
        resourceId: employment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Employee administration"
      });

      return { person, employment, status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return privateJson({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "POSITION_NOT_FOUND") return privateJson({ error: "The selected position does not exist in this tenant." }, { status: 404 });
    if (code === "POSITION_NOT_AVAILABLE" || code === "POSITION_OCCUPIED") return privateJson({ error: "The selected position is no longer available." }, { status: 409 });
    if (code === "PERSON_DUPLICATE" || (error as { code?: string })?.code === "P2002") return privateJson({ error: "Employee number or work email already exists." }, { status: 409 });
    if (code === "STATE_CONFLICT" || (error as { code?: string })?.code === "P2034") return privateJson({ error: "Employee or position state changed concurrently. Refresh and retry." }, { status: 409 });
    console.error("Employee creation failed", error);
    return privateJson({ error: "Employee record could not be created." }, { status: 500 });
  }
}
