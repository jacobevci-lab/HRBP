import { DataClassification, EmploymentStatus, Prisma, TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asFiniteNumber, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { addUtcDays, startOfUtcDay, validateTimeEntryIntegrity } from "@/lib/time-governance";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const activeEntryStatuses = [TimeEntryStatus.DRAFT, TimeEntryStatus.SUBMITTED, TimeEntryStatus.APPROVED, TimeEntryStatus.LOCKED] as const;

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromDate = from ? asDate(from) : null;
  const toDate = to ? asDate(to) : null;
  if (from && !fromDate) return Response.json({ error: "from must be a valid date." }, { status: 400 });
  if (to && !toDate) return Response.json({ error: "to must be a valid date." }, { status: 400 });
  if (fromDate && toDate && toDate < fromDate) return Response.json({ error: "to must be on or after from." }, { status: 400 });

  const data = await db.timeEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...employmentIdFilter(scope),
      ...(fromDate || toDate ? { workDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {})
    },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    include: {
      employment: {
        select: {
          id: true,
          status: true,
          person: { select: { id: true, employeeNumber: true, givenName: true, familyName: true } },
          position: { select: { title: true } }
        }
      }
    }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const employmentId = asIdentifier(body.employmentId);
  const workDate = asDate(body.workDate);
  const minutes = asFiniteNumber(body.minutes);
  const overtimeMinutes = body.overtimeMinutes === undefined || body.overtimeMinutes === null || body.overtimeMinutes === "" ? 0 : asFiniteNumber(body.overtimeMinutes);
  const startAt = body.startAt === undefined || body.startAt === null || body.startAt === "" ? undefined : asDate(body.startAt);
  const endAt = body.endAt === undefined || body.endAt === null || body.endAt === "" ? undefined : asDate(body.endAt);
  const source = asOptionalText(body.source, 80);

  if (!employmentId || !workDate || minutes === null || overtimeMinutes === null) {
    return Response.json({ error: "employmentId, workDate, minutes and overtimeMinutes must be valid scalar values." }, { status: 400 });
  }
  if (body.startAt !== undefined && body.startAt !== null && body.startAt !== "" && !startAt) return Response.json({ error: "startAt must be a valid date-time." }, { status: 400 });
  if (body.endAt !== undefined && body.endAt !== null && body.endAt !== "" && !endAt) return Response.json({ error: "endAt must be a valid date-time." }, { status: 400 });
  if (source === null) return Response.json({ error: "source must be no more than 80 characters." }, { status: 400 });

  const integrityError = validateTimeEntryIntegrity({ startAt, endAt, minutes, overtimeMinutes });
  if (integrityError) {
    return Response.json({ error: "minutes must be 1-1440, overtime cannot exceed worked minutes, and any start/end interval must be complete, ordered and consistent with worked minutes." }, { status: 400 });
  }

  const selfEntry = Boolean(ctx.employmentId && ctx.employmentId === employmentId);
  if (selfEntry) {
    if (!can(ctx, "time:self-entry")) return forbidden();
  } else {
    if (!can(ctx, "time:write")) return forbidden("Creating time for another employment requires time:write.");
    const scope = await resolveEmploymentScope(db, ctx);
    if (!canActOnEmployment(scope, employmentId)) return forbidden("Employment is outside your authorized relationship scope.");
  }

  const dayStart = startOfUtcDay(workDate);
  const dayEnd = addUtcDays(dayStart, 1);

  try {
    const data = await db.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { id: employmentId, tenantId: ctx.tenantId, status: EmploymentStatus.ACTIVE },
        select: { id: true }
      });
      if (!employment) throw new Error("NOT_FOUND");

      const overlap = await tx.timeEntry.findFirst({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          workDate: { gte: dayStart, lt: dayEnd },
          status: { in: [...activeEntryStatuses] },
          ...(startAt && endAt ? {
            OR: [
              { startAt: null },
              { endAt: null },
              { startAt: { lt: endAt }, endAt: { gt: startAt } }
            ]
          } : {})
        },
        select: { id: true }
      });
      if (overlap) throw new Error("OVERLAP");

      const entry = await tx.timeEntry.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          workDate: dayStart,
          startAt,
          endAt,
          minutes,
          overtimeMinutes,
          source: selfEntry ? "SELF_SERVICE" : (source ?? "OPERATIONS"),
          status: TimeEntryStatus.DRAFT
        }
      });
      await appendAudit(tx, ctx, {
        action: selfEntry ? "time-entry.self-created" : "time-entry.created",
        resourceType: "TimeEntry",
        resourceId: entry.id,
        classification: DataClassification.CONFIDENTIAL
      });
      return entry;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Active employment not found in tenant." }, { status: 404 });
    if (code === "OVERLAP") return Response.json({ error: "An overlapping governed time entry already exists for this employment and work day." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Time state changed concurrently. Retry the request." }, { status: 409 });
    throw error;
  }
}
