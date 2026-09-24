import { LeaveRequestStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type LeaveParticipantData = {
  leaveTypes: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    requiresApproval: boolean;
    annualAllowance: string | null;
  }>;
  balances: Array<{
    leaveTypeId: string;
    leaveType: string;
    year: number;
    remaining: number;
  }>;
  requests: Array<{
    id: string;
    leaveType: string;
    startsAt: string;
    endsAt: string;
    units: string;
    unit: string;
    status: string;
  }>;
};

export async function getLeaveParticipantData(ctx: RequestContext): Promise<LeaveParticipantData> {
  if (!ctx.employmentId || !can(ctx, "leave:self-request")) return { leaveTypes: [], balances: [], requests: [] };
  const employmentId = ctx.employmentId;
  const now = new Date();
  const year = now.getUTCFullYear();
  const horizonStart = new Date(now);
  horizonStart.setUTCDate(horizonStart.getUTCDate() - 180);

  return withDb(async (db) => {
    const [leaveTypes, balances, requests] = await Promise.all([
      db.leaveType.findMany({
        where: { tenantId: ctx.tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, unit: true, requiresApproval: true, annualAllowance: true }
      }),
      db.leaveBalance.findMany({
        where: { tenantId: ctx.tenantId, employmentId, periodYear: year },
        orderBy: { leaveType: { name: "asc" } },
        select: { leaveTypeId: true, periodYear: true, opening: true, accrued: true, used: true, adjustment: true, leaveType: { select: { name: true } } }
      }),
      db.leaveRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          OR: [
            { status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] } },
            { startsAt: { gte: horizonStart } }
          ]
        },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: { id: true, startsAt: true, endsAt: true, units: true, status: true, leaveType: { select: { name: true, unit: true } } }
      })
    ]);

    return {
      leaveTypes: leaveTypes.map((type) => ({
        id: type.id,
        code: type.code,
        name: type.name,
        unit: type.unit,
        requiresApproval: type.requiresApproval,
        annualAllowance: type.annualAllowance?.toString() ?? null
      })),
      balances: balances.map((balance) => ({
        leaveTypeId: balance.leaveTypeId,
        leaveType: balance.leaveType.name,
        year: balance.periodYear,
        remaining: Number(balance.opening) + Number(balance.accrued) + Number(balance.adjustment) - Number(balance.used)
      })),
      requests: requests.map((request) => ({
        id: request.id,
        leaveType: request.leaveType.name,
        startsAt: request.startsAt.toISOString(),
        endsAt: request.endsAt.toISOString(),
        units: request.units.toString(),
        unit: request.leaveType.unit,
        status: request.status
      }))
    };
  });
}
