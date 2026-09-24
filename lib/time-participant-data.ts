import { TimeEntryStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type TimeParticipantData = {
  schedule: {
    code: string;
    name: string;
    timezone: string;
    weeklyMinutes: number;
  } | null;
  entries: Array<{
    id: string;
    workDate: string;
    startAt: string | null;
    endAt: string | null;
    minutes: number;
    overtimeMinutes: number;
    status: string;
    source: string;
  }>;
  totals: {
    minutes: number;
    overtimeMinutes: number;
    submitted: number;
    approved: number;
    locked: number;
  };
};

export async function getTimeParticipantData(ctx: RequestContext): Promise<TimeParticipantData> {
  if (!ctx.employmentId || !can(ctx, "time:self-entry")) {
    return { schedule: null, entries: [], totals: { minutes: 0, overtimeMinutes: 0, submitted: 0, approved: 0, locked: 0 } };
  }
  const employmentId = ctx.employmentId;
  const now = new Date();
  const horizonStart = new Date(now);
  horizonStart.setUTCDate(horizonStart.getUTCDate() - 45);

  return withDb(async (db) => {
    const [assignment, entries] = await Promise.all([
      db.workScheduleAssignment.findFirst({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          schedule: {
            active: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
          }
        },
        orderBy: { effectiveFrom: "desc" },
        select: { schedule: { select: { code: true, name: true, timezone: true, weeklyMinutes: true } } }
      }),
      db.timeEntry.findMany({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          OR: [
            { status: { in: [TimeEntryStatus.DRAFT, TimeEntryStatus.SUBMITTED, TimeEntryStatus.REJECTED] } },
            { workDate: { gte: horizonStart } }
          ]
        },
        orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
        take: 60,
        select: { id: true, workDate: true, startAt: true, endAt: true, minutes: true, overtimeMinutes: true, status: true, source: true }
      })
    ]);

    return {
      schedule: assignment?.schedule ?? null,
      entries: entries.map((entry) => ({
        id: entry.id,
        workDate: entry.workDate.toISOString(),
        startAt: entry.startAt?.toISOString() ?? null,
        endAt: entry.endAt?.toISOString() ?? null,
        minutes: entry.minutes,
        overtimeMinutes: entry.overtimeMinutes,
        status: entry.status,
        source: entry.source ?? "—"
      })),
      totals: {
        minutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
        overtimeMinutes: entries.reduce((sum, entry) => sum + entry.overtimeMinutes, 0),
        submitted: entries.filter((entry) => entry.status === TimeEntryStatus.SUBMITTED).length,
        approved: entries.filter((entry) => entry.status === TimeEntryStatus.APPROVED).length,
        locked: entries.filter((entry) => entry.status === TimeEntryStatus.LOCKED).length
      }
    };
  });
}
