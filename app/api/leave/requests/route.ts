import { DataClassification, LeaveRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.leaveRequest.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
    include: {
      leaveType: true,
      employment: {
        select: {
          id: true,
          person: { select: { employeeNumber: true, givenName: true, familyName: true } },
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
  if (!can(ctx, "leave:write")) return forbidden();

  const body = await request.json() as { employmentId?: string; leaveTypeId?: string; startsAt?: string; endsAt?: string; units?: string | number; reason?: string };
  if (!body.employmentId || !body.leaveTypeId || !body.startsAt || !body.endsAt || body.units === undefined) {
    return Response.json({ error: "employmentId, leaveTypeId, startsAt, endsAt and units are required." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);
  if (!canActOnEmployment(scope, body.employmentId)) return forbidden("Employment is outside your authorized relationship scope.");

  const data = await db.$transaction(async (tx) => {
    const [employment, leaveType] = await Promise.all([
      tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.leaveType.findFirst({ where: { id: body.leaveTypeId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !leaveType) throw new Error("NOT_FOUND");

    const leave = await tx.leaveRequest.create({
      data: {
        tenantId: ctx.tenantId,
        employmentId: body.employmentId!,
        leaveTypeId: body.leaveTypeId!,
        startsAt: new Date(body.startsAt!),
        endsAt: new Date(body.endsAt!),
        units: body.units!,
        reason: body.reason,
        status: LeaveRequestStatus.PENDING
      }
    });
    await appendAudit(tx, ctx, { action: "leave-request.created", resourceType: "LeaveRequest", resourceId: leave.id, classification: DataClassification.CONFIDENTIAL });
    return leave;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!data) return Response.json({ error: "Employment or active leave type not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
