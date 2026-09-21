import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reads a runtime setting from Cloudflare Worker bindings first and then falls
 * back to process.env for local development / CI. Secrets stay in the platform
 * environment; this helper never serializes them to the client.
 */
export function runtimeString(name: string): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Outside a Cloudflare request context (local build/tests), use process.env.
  }

  const value = process.env[name];
  return value?.trim() || undefined;
}

export function runtimeBoolean(name: string, fallback = false): boolean {
  const value = runtimeString(name);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function runtimeNumber(name: string, fallback: number): number {
  const value = runtimeString(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
