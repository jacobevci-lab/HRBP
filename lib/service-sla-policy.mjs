/** Keep database eligibility and in-memory escalation decisions on identical millisecond boundaries. */
export function serviceSlaPolicy(now, warningMinutes = 120, severeMinutes = 1440) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("A valid SLA evaluation time is required.");
  const warning = Math.max(15, Math.floor(Number.isFinite(warningMinutes) ? warningMinutes : 120));
  const severe = Math.max(60, Math.floor(Number.isFinite(severeMinutes) ? severeMinutes : 1440));
  const evaluatedAt = new Date(now.getTime());
  const warningAt = new Date(evaluatedAt.getTime() + warning * 60_000);
  const severeAt = new Date(evaluatedAt.getTime() - severe * 60_000);
  if (!Number.isFinite(warningAt.getTime()) || !Number.isFinite(severeAt.getTime())) throw new RangeError("SLA thresholds exceed the supported date range.");
  const where = {
    OR: [
      { escalationLevel: { lt: 1 }, slaDueAt: { lte: warningAt } },
      { escalationLevel: { lt: 2 }, slaDueAt: { lte: evaluatedAt } },
      { escalationLevel: { lt: 3 }, slaDueAt: { lte: severeAt } }
    ]
  };
  function target(dueAt) {
    if (!(dueAt instanceof Date) || !Number.isFinite(dueAt.getTime())) throw new TypeError("A valid SLA deadline is required.");
    const due = dueAt.getTime();
    if (due <= severeAt.getTime()) return { level: 3, reason: `SLA breached by at least ${severe} minutes` };
    if (due <= evaluatedAt.getTime()) return { level: 2, reason: "SLA breached" };
    if (due <= warningAt.getTime()) return { level: 1, reason: `SLA due within ${warning} minutes` };
    return { level: 0, reason: "" };
  }
  return { where, target };
}
