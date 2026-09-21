import { DataClassification, EmploymentStatus, LifecycleEventType, PositionStatus } from "@prisma/client";
import { withDb, db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { appendAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "people:read")) return forbidden();

  const people = await db.person.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    take: 200,
    select: {
      id: true, employeeNumber: true, givenName: true, familyName: true, workEmail: true, classification: true,
      employments: { where: { status: { not: EmploymentStatus.TERMINATED } }, take: 1, select: {
        id: true, status: true, startDate: true,
        position: { select: { id: true, positionCode: true, title: true, orgUnit: { select: { id: true, name: true } } } }
      }}
    }
  });
  return Response.json({ data: people });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const givenName = String(body.givenName ?? "").trim();
  const familyName = String(body.familyName ?? "").trim();
  const employeeNumber = String(body.employeeNumber ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim().toLowerCase();
  const positionId = String(body.positionId ?? "").trim();
  const startDateValue = String(body.startDate ?? "").trim();

  if (!givenName || !familyName || !employeeNumber || !workEmail || !positionId || !startDateValue) {
    return Response.json({ error: "givenName, familyName, employeeNumber, workEmail, positionId and startDate are required." }, { status: 400 });
  }
  if (!workEmail.includes("@")) return Response.json({ error: "A valid work email is required." }, { status: 400 });

  const startDate = new Date(`${startDateValue}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime())) return Response.json({ error: "startDate is invalid." }, { status: 400 });

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
      if (position.status !== PositionStatus.OPEN && position.status !== PositionStatus.PLANNED) throw new Error("POSITION_NOT_AVAILABLE");
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

      await tx.position.update({ where: { id: position.id }, data: { status: PositionStatus.FILLED } });

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
    }));

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "POSITION_NOT_FOUND") return Response.json({ error: "The selected position does not exist in this tenant." }, { status: 404 });
    if (code === "POSITION_NOT_AVAILABLE" || code === "POSITION_OCCUPIED") return Response.json({ error: "The selected position is no longer available." }, { status: 409 });
    if (code === "PERSON_DUPLICATE" || (error as { code?: string })?.code === "P2002") return Response.json({ error: "Employee number or work email already exists." }, { status: 409 });
    console.error("Employee creation failed", error);
    return Response.json({ error: "Employee record could not be created." }, { status: 500 });
  }
}
