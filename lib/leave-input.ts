import { LeaveUnit } from "@prisma/client";
import { asDecimalInput, asIdentifier, asText, type JsonObject } from "@/lib/input-validation";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const invalid = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Date-only means UTC. Timestamps must specify a zone; impossible dates never roll forward. */
export function asLeaveDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(input);
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  if (parts[4] !== undefined && (Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] ?? 0) > 59)) return null;
  const zone = parts[8];
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date : null;
}

export type LeaveRequestInput = {
  employmentId: string; leaveTypeId: string; startsAt: Date; endsAt: Date; units: number; reason: string | null;
};
export function parseLeaveRequest(body: JsonObject): Parsed<LeaveRequestInput> {
  const employmentId = asIdentifier(body.employmentId), leaveTypeId = asIdentifier(body.leaveTypeId);
  if (!employmentId || !leaveTypeId) return invalid("employmentId and leaveTypeId must be non-empty identifiers of at most 191 characters.");
  const startsAt = asLeaveDate(body.startsAt), endsAt = asLeaveDate(body.endsAt);
  if (!startsAt || !endsAt) return invalid("startsAt and endsAt must be real YYYY-MM-DD dates or ISO timestamps with an explicit timezone.");
  if (endsAt < startsAt) return invalid("endsAt must be on or after startsAt.");
  const decimal = asDecimalInput(body.units, 6, 2);
  const units = decimal === null ? NaN : Number(decimal);
  if (!Number.isFinite(units) || units <= 0 || units > 366) return invalid("units must be greater than 0 and no more than 366, with at most two decimal places.");
  const reason = body.reason == null ? "" : asText(body.reason, 2000, true);
  if (reason === null || reason.includes("\u0000")) return invalid("reason must be text of at most 2000 characters without null characters.");
  return { ok: true, value: { employmentId, leaveTypeId, startsAt, endsAt, units, reason: reason || null } };
}

export type LeaveTypeInput = {
  code: string; name: string; unit: LeaveUnit; paid: boolean; requiresApproval: boolean; annualAllowance: number | null;
};
export function parseLeaveType(body: JsonObject): Parsed<LeaveTypeInput> {
  const inputCode = asIdentifier(body.code, 40), name = asIdentifier(body.name, 160);
  const code = inputCode?.toUpperCase();
  if (!code || code.length > 40 || !name) return invalid("code and name must be bounded text (40 and 160 characters) without control characters.");
  const unit = body.unit === undefined ? LeaveUnit.DAYS : body.unit;
  if (typeof unit !== "string" || !Object.values(LeaveUnit).includes(unit as LeaveUnit)) return invalid("unit must be a supported leave unit.");
  if ((body.paid !== undefined && typeof body.paid !== "boolean") ||
      (body.requiresApproval !== undefined && typeof body.requiresApproval !== "boolean")) {
    return invalid("paid and requiresApproval must be booleans when provided.");
  }
  let annualAllowance: number | null = null;
  if (body.annualAllowance !== undefined && body.annualAllowance !== null) {
    const decimal = asDecimalInput(body.annualAllowance, 6, 2);
    const value = decimal === null ? NaN : Number(decimal);
    if (!Number.isFinite(value) || value < 0 || value > 3660) return invalid("annualAllowance must be between 0 and 3660, with at most two decimal places, or null for untracked leave.");
    annualAllowance = value;
  }
  return { ok: true, value: { code, name, unit: unit as LeaveUnit,
    paid: body.paid === undefined ? true : body.paid as boolean,
    requiresApproval: body.requiresApproval === undefined ? true : body.requiresApproval as boolean,
    annualAllowance } };
}

export function parseLeaveBalanceYear(params: URLSearchParams, now = new Date()): number | null {
  const values = params.getAll("year");
  if (!values.length) return now.getUTCFullYear();
  if (values.length !== 1 || !/^\d{4}$/.test(values[0]) || Number(values[0]) < 1) return null;
  return Number(values[0]);
}
