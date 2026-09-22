export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as JsonObject;
  } catch {
    return null;
  }
}

export function asIdentifier(value: unknown, maxLength = 191): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function asText(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!allowEmpty && !normalized) return null;
  if (normalized.length > maxLength) return null;
  return normalized;
}

export function asOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = asText(value, maxLength);
  return normalized ?? null;
}

export function asEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : null;
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function asDecimalInput(value: unknown, maxIntegerDigits = 18, maxFractionDigits = 4): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const pattern = new RegExp(`^-?\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,${maxFractionDigits}})?$`);
  return pattern.test(normalized) ? normalized : null;
}

export function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
