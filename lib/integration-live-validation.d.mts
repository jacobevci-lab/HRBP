export const INTEGRATION_VALIDATION_MAX_AGE_MS: number;

export function integrationValidationCurrent(value: Date | string | number | null | undefined, nowMs?: number): boolean;

export type IntegrationProbeResult =
  | { ok: true; status: number; durationMs: number; origin: string }
  | { ok: false; reason: "TARGET_NOT_ALLOWED" | "TRANSPORT_UNAVAILABLE"; durationMs?: number; origin?: string };

export function parseIntegrationProbeOrigins(value: unknown, allowHttp?: boolean): string[] | null;

export function integrationProbeTarget(
  baseUrl: unknown,
  allowedOrigins: string[],
  allowHttp?: boolean
): URL | null;

export function probeIntegrationEndpoint(input: {
  baseUrl: string;
  allowedOrigins: string[];
  allowHttp?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<IntegrationProbeResult>;
