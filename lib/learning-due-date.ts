/**
 * Learning due dates are calendar dates, not instants. Values persisted as midnight
 * UTC must remain actionable through their entire recorded UTC calendar day.
 * No existing rows need rewriting.
 */
export function learningDueDayStartUtc(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new RangeError("A valid date is required.");
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Exclusive upper bound for all due dates up to and including N future UTC days. */
export function learningDueSoonExclusiveUtc(now: Date, daysAhead: number): Date {
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 366) {
    throw new RangeError("Due-soon window must be a bounded integer number of days.");
  }
  const cutoff = learningDueDayStartUtc(now);
  cutoff.setUTCDate(cutoff.getUTCDate() + daysAhead + 1);
  return cutoff;
}
