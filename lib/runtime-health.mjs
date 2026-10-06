export const RELEASE_PROTOCOL_VERSION = 1;
export function normalizedRevision(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}
export function normalizedRuntimeProfile(value) {
  return value === 'onprem-node' ? 'onprem-node' : 'cloudflare-workers';
}
export function runtimeHealth(revision, probe, now = new Date(), runtimeProfile) {
  return {
    ok: true,
    service: 'hrbp',
    runtime: normalizedRuntimeProfile(runtimeProfile),
    timestamp: now.toISOString(),
    release: { protocolVersion: RELEASE_PROTOCOL_VERSION, revision: normalizedRevision(revision) },
    probe: typeof probe === 'string' && /^[a-f0-9]{32}$/.test(probe) ? probe : null,
    scope: 'runtime-and-release-only'
  };
}
