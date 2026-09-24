import type { Prisma } from "@prisma/client";

export type TimeEntryIntegrityInput = {
  startAt: Date | null | undefined;
  endAt: Date | null | undefined;
  minutes: number;
  overtimeMinutes: number;
};

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function validateTimeEntryIntegrity(input: TimeEntryIntegrityInput): string | null {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 1440) return "INVALID_MINUTES";
  if (!Number.isInteger(input.overtimeMinutes) || input.overtimeMinutes < 0 || input.overtimeMinutes > input.minutes) return "INVALID_OVERTIME";

  const hasStart = Boolean(input.startAt);
  const hasEnd = Boolean(input.endAt);
  if (hasStart !== hasEnd) return "INCOMPLETE_INTERVAL";
  if (!input.startAt || !input.endAt) return null;
  if (input.endAt <= input.startAt) return "INVALID_INTERVAL";

  const elapsedMinutes = Math.ceil((input.endAt.getTime() - input.startAt.getTime()) / 60_000);
  if (elapsedMinutes > 1440) return "INTERVAL_TOO_LONG";
  if (input.minutes > elapsedMinutes) return "MINUTES_EXCEED_INTERVAL";
  return null;
}

export async function findEffectiveWorkSchedule(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; employmentId: string; workDate: Date }
) {
  return tx.workScheduleAssignment.findFirst({
    where: {
      tenantId: input.tenantId,
      employmentId: input.employmentId,
      effectiveFrom: { lte: input.workDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.workDate } }],
      schedule: {
        active: true,
        effectiveFrom: { lte: input.workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.workDate } }]
      }
    },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      schedule: {
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          weeklyMinutes: true
        }
      }
    }
  });
}
