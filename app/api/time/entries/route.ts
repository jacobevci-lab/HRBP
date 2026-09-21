import { TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:read")) return forbidden();

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const data = await db.timeEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(from || to ? { workDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {})
    },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    include: { employment: { select: { id: true, status: true, person: { select: { id: true, employeeNumber: true, givenName: true, familyName: true } }, position: { select: { title: true } } } } }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:write")) return forbidden();

  const body = await request.json() as { employmentId?: string; workDate?: string; startAt?: string; endAt?: string; minutes?: number; overtimeMinutes?: number; source?: string; status?: TimeEntryStatus };
  if (!body.employmentId || !body.workDate || !Number.isInteger(body.minutes) || (body.minutes ?? 0) < 0) return Response.json({ error: "employmentId, workDate and non-negative integer minutes are required." }, { status: 400 });
  const employment = await db.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!employment) return Response.json({ error: "Employment not found in tenant." }, { status: 404 });

  const data = await db.timeEntry.create({ data: { tenantId: ctx.tenantId, employmentId: body.employmentId, workDate: new Date(body.workDate), startAt: body.startAt ? new Date(body.startAt) : undefined, endAt: body.endAt ? new Date(body.endAt) : undefined, minutes: body.minutes!, overtimeMinutes: body.overtimeMinutes ?? 0, source: body.source, status: body.status ?? TimeEntryStatus.DRAFT } });
  return Response.json({ data }, { status: 201 });
}
