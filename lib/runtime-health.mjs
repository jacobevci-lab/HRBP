export const RELEASE_PROTOCOL_VERSION = 1;
export function normalizedRevision(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}
/** Public liveness information only: no DB initialization, account state, bindings or secrets. */
export function runtimeHealth(revision, probe, now = new Date()) {
  return {
    ok: true,
    service: 'hrbp',
    // Retained for compatibility. This is the configured deployment target, not host detection.
    runtime: 'cloudflare-workers',
    timestamp: now.toISOString(),
    release: { protocolVersion: RELEASE_PROTOCOL_VERSION, revision: normalizedRevision(revision) },
    probe: typeof probe === 'string' && /^[a-f0-9]{32}$/.test(probe) ? probe : null,
    scope: 'runtime-and-release-only'
  };
}
