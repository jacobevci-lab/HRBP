export const RELEASE_PROTOCOL_VERSION: 1;
export function normalizedRevision(value: unknown): string | null;
export function normalizedRuntimeProfile(value: unknown): 'cloudflare-workers' | 'onprem-node';
export function runtimeHealth(revision: unknown, probe: unknown, now?: Date, runtimeProfile?: unknown): {
  ok: true; service: 'hrbp'; runtime: 'cloudflare-workers' | 'onprem-node'; timestamp: string;
  release: { protocolVersion: 1; revision: string | null };
  probe: string | null; scope: 'runtime-and-release-only';
};
