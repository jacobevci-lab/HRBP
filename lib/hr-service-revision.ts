/** Request-level optimistic revision. No browser clock or submit-time reread.
 * All supported request writers must advance updatedAt monotonically, including
 * comments that do not change status. This is not a durable idempotency key.
 */
export function asServiceRevision(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

export function nextServiceRevision(current: Date, now: Date): Date {
  const previous = current.getTime(), clock = now.getTime();
  if (!Number.isFinite(previous) || !Number.isFinite(clock)) throw new Error("INVALID_REVISION");
  const next = new Date(Math.max(previous + 1, clock));
  if (!asServiceRevision(next.toISOString())) throw new Error("INVALID_REVISION");
  return next;
}
