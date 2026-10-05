/** Decimal(8,2) values are compared in exact hundredths, not binary floating-point subtraction. */
type DecimalValue = number | string | { toString(): string };
type LeaveBalanceAmount = { opening: DecimalValue; accrued: DecimalValue; adjustment: DecimalValue; used: DecimalValue };

function hundredths(value: DecimalValue): number {
  const text = value.toString();
  if (!/^-?\d{1,6}(?:\.\d{1,2})?$/.test(text)) throw new RangeError("Invalid governed leave balance precision.");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  return (negative ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

export function hasAvailableLeaveBalance(balance: LeaveBalanceAmount, requested: DecimalValue): boolean {
  const required = hundredths(requested);
  if (required <= 0) throw new RangeError("A positive leave quantity is required.");
  const available = hundredths(balance.opening) + hundredths(balance.accrued) + hundredths(balance.adjustment) - hundredths(balance.used);
  return available >= required;
}
