import { DataClassification, TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const data = await db.timeEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...employmentIdFilter(scope),
      ...(from || to ? { workDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {})
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
  if (!can(ctx, "time:write")) return forbidden();

  const body = await request.json() as { employmentId?: string; workDate?: string; startAt?: string; endAt?: string; minutes?: number; overtimeMinutes?: number; source?: string; status?: TimeEntryStatus };
  if (!body.employmentId || !body.workDate || !Number.isInteger(body.minutes) || (body.minutes ?? 0) < 0) {
    return Response.json({ error: "employmentId, workDate and non-negative integer minutes are required." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);
  if (!canActOnEmployment(scope, body.employmentId)) return forbidden("Employment is outside your authorized relationship scope.");

  const data = await db.$transaction(async (tx) => {
    const employment = await tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!employment) throw new Error("NOT_FOUND");
    const entry = await tx.timeEntry.create({
      data: {
        tenantId: ctx.tenantId,
        employmentId: body.employmentId!,
        workDate: new Date(body.workDate!),
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
        minutes: body.minutes!,
        overtimeMinutes: body.overtimeMinutes ?? 0,
        source: body.source,
        status: body.status ?? TimeEntryStatus.DRAFT
      }
    });
    await appendAudit(tx, ctx, { action: "time-entry.created", resourceType: "TimeEntry", resourceId: entry.id, classification: DataClassification.CONFIDENTIAL });
    return entry;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!data) return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
