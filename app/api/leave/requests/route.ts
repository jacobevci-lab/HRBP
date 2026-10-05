import { readJsonObject } from "@/lib/input-validation";
import { parseLeaveRequest } from "@/lib/leave-input";
import { hasAvailableLeaveBalance } from "@/lib/leave-balance-amount";
import { DataClassification, LeaveRequestStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { enqueueLeaveApprovalNotification } from "@/lib/leave-notifications";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
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
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const parsed = parseLeaveRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { employmentId, leaveTypeId, startsAt, endsAt, units, reason } = parsed.value;

  const selfRequest = Boolean(ctx.employmentId && employmentId === ctx.employmentId);
  if (selfRequest) {
    if (!can(ctx, "leave:self-request")) return forbidden();
  } else {
    if (!can(ctx, "leave:write")) return forbidden("Creating leave on behalf of another employment requires leave:write.");
    const scope = await resolveEmploymentScope(db, ctx);
    if (!canActOnEmployment(scope, employmentId)) return forbidden("Employment is outside your authorized relationship scope.");
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const [employment, leaveType, overlap] = await Promise.all([
        tx.employment.findFirst({
          where: { id: employmentId, tenantId: ctx.tenantId },
          select: {
            id: true,
            managerEmploymentId: true,
            person: { select: { givenName: true, familyName: true } }
          }
        }),
        tx.leaveType.findFirst({
          where: { id: leaveTypeId, tenantId: ctx.tenantId, active: true },
          select: { id: true, name: true, requiresApproval: true, annualAllowance: true }
        }),
        tx.leaveRequest.findFirst({
          where: {
            tenantId: ctx.tenantId,
            employmentId: employmentId,
            status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED, LeaveRequestStatus.TAKEN] },
            startsAt: { lte: endsAt },
            endsAt: { gte: startsAt }
          },
          select: { id: true }
        })
      ]);
      if (!employment || !leaveType) throw new Error("NOT_FOUND");
      if (overlap) throw new Error("OVERLAP");

      const trackedBalance = leaveType.annualAllowance !== null;
      if (trackedBalance && startsAt.getUTCFullYear() !== endsAt.getUTCFullYear()) throw new Error("CROSS_YEAR_TRACKED");

      let balanceId: string | null = null;
      if (!leaveType.requiresApproval && trackedBalance) {
        const balance = await tx.leaveBalance.findUnique({
          where: { employmentId_leaveTypeId_periodYear: { employmentId: employment.id, leaveTypeId: leaveType.id, periodYear: startsAt.getUTCFullYear() } },
          select: { id: true, opening: true, accrued: true, used: true, adjustment: true }
        });
        if (!balance) throw new Error("BALANCE_NOT_FOUND");
        if (!hasAvailableLeaveBalance(balance, units)) throw new Error("INSUFFICIENT_BALANCE");
        balanceId = balance.id;
      }

      const status = leaveType.requiresApproval ? LeaveRequestStatus.PENDING : LeaveRequestStatus.APPROVED;
      const leave = await tx.leaveRequest.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: employment.id,
          leaveTypeId: leaveType.id,
          startsAt,
          endsAt,
          units,
          reason,
          status,
          approverId: status === LeaveRequestStatus.APPROVED ? ctx.actorId : null,
          decidedAt: status === LeaveRequestStatus.APPROVED ? new Date() : null
        }
      });

      if (balanceId) await tx.leaveBalance.update({ where: { id: balanceId }, data: { used: { increment: units } } });
      await appendAudit(tx, ctx, {
        action: status === LeaveRequestStatus.APPROVED ? "leave-request.created-auto-approved" : "leave-request.created",
        resourceType: "LeaveRequest",
        resourceId: leave.id,
        classification: DataClassification.CONFIDENTIAL
      });

      if (status === LeaveRequestStatus.PENDING && employment.managerEmploymentId) {
        await enqueueLeaveApprovalNotification(tx, {
          tenantId: ctx.tenantId,
          managerEmploymentId: employment.managerEmploymentId,
          requestId: leave.id,
          employeeName: `${employment.person.givenName} ${employment.person.familyName}`,
          leaveType: leaveType.name,
          startsAt,
          endsAt,
          units: String(units)
        });
      }
      return leave;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Employment or active leave type not found in tenant." }, { status: 404 });
    if (code === "OVERLAP") return Response.json({ error: "An overlapping pending, approved or taken leave request already exists." }, { status: 409 });
    if (code === "CROSS_YEAR_TRACKED") return Response.json({ error: "Balance-tracked leave requests must stay within one balance year." }, { status: 400 });
    if (code === "BALANCE_NOT_FOUND") return Response.json({ error: "No governed leave balance exists for this employee, leave type and year." }, { status: 409 });
    if (code === "INSUFFICIENT_BALANCE") return Response.json({ error: "Available leave balance is lower than the requested units." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Leave state changed concurrently. Retry the request." }, { status: 409 });
    throw error;
  }
}
