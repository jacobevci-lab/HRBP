export const SUPPORT_BUNDLE_VERSION = 1;
export const MAX_CAPTURE_BYTES = 1024 * 1024;

function string(value, max = 128) {
  return typeof value === "string" && value.length <= max ? value : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) && Number.isFinite(number) ? number : null;
}

export function sanitizeComposeService(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const service = string(value.Service ?? value.service, 96);
  if (!service) return null;
  return {
    service,
    state: string(value.State ?? value.state, 32),
    health: string(value.Health ?? value.health, 64),
    image: string(value.Image ?? value.image, 256),
    exitCode: integer(value.ExitCode ?? value.exitCode)
  };
}

export function sanitizeImage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const service = string(value.Service ?? value.service, 96);
  if (!service) return null;
  return {
    service,
    repository: string(value.Repository ?? value.repository, 256),
    tag: string(value.Tag ?? value.tag, 128),
    id: string(value.ID ?? value.Id ?? value.id, 128)
  };
}

export function sanitizeRuntimeHealth(body) {
  return {
    ok: body?.ok === true,
    service: string(body?.service, 32),
    releaseProtocolVersion: integer(body?.release?.protocolVersion),
    releaseRevision: typeof body?.release?.revision === "string" && /^[a-f0-9]{40}$/i.test(body.release.revision)
      ? body.release.revision.toLowerCase()
      : null
  };
}

export function sanitizeDatabaseHealth(body) {
  return {
    status: string(body?.status, 32),
    database: string(body?.database, 32),
    transport: string(body?.transport, 64),
    orm: string(body?.orm, 32),
    reason: string(body?.reason, 64),
    errorName: string(body?.errorName, 64),
    errorCode: string(body?.errorCode, 64),
    latencyMs: Number.isFinite(body?.latencyMs) && body.latencyMs >= 0 ? Math.round(body.latencyMs) : null
  };
}

export function sanitizeAuthHealth(body) {
  const modes = Array.isArray(body?.modes)
    ? body.modes.slice(0, 8).map((mode) => ({
        mode: string(mode?.mode, 32),
        enabled: mode?.enabled === true,
        configured: mode?.configured === true,
        missingCount: Array.isArray(mode?.missing) ? Math.min(mode.missing.length, 100) : 0
      }))
    : [];
  return {
    status: string(body?.status, 32),
    authentication: string(body?.authentication, 32),
    configured: body?.configured === true,
    missingCount: Array.isArray(body?.missing) ? Math.min(body.missing.length, 100) : 0,
    modes
  };
}

export function sanitizeSchedulerStatus(body) {
  const blocked = body?.blocked && typeof body.blocked === "object" && !Array.isArray(body.blocked)
    ? {
        at: string(body.blocked.at, 64),
        job: string(body.blocked.job, 64),
        code: string(body.blocked.code, 64),
        restoredFromBackup: body.blocked.restoredFromBackup === true
      }
    : null;
  const heartbeat = body?.heartbeat && typeof body.heartbeat === "object" && !Array.isArray(body.heartbeat)
    ? {
        at: string(body.heartbeat.at, 64),
        status: string(body.heartbeat.status, 32),
        intervalSeconds: integer(body.heartbeat.intervalSeconds)
      }
    : null;
  const lastRun = body?.lastRun && typeof body.lastRun === "object" && !Array.isArray(body.lastRun)
    ? {
        completedAt: string(body.lastRun.completedAt, 64),
        success: body.lastRun.success === true,
        stopped: body.lastRun.stopped === true,
        requested: integer(body.lastRun.requested),
        results: Array.isArray(body.lastRun.results)
          ? body.lastRun.results.slice(0, 32).map((entry) => ({
              job: string(entry?.job, 64),
              status: string(entry?.status, 16),
              httpStatus: integer(entry?.httpStatus),
              durationMs: Number.isFinite(entry?.durationMs) && entry.durationMs >= 0 ? Math.round(entry.durationMs) : null,
              code: string(entry?.code, 64)
            }))
          : []
      }
    : null;
  return { blocked, heartbeat, lastRun };
}

export function boundedJsonParse(text, maxBytes = MAX_CAPTURE_BYTES) {
  if (typeof text !== "string" || Buffer.byteLength(text) > maxBytes) throw new Error("Support capture exceeded its bounded response size.");
  return JSON.parse(text);
}

export function diagnosticsContainSecretMaterial(value) {
  const text = JSON.stringify(value);
  return /postgres(?:ql)?:\/\/[^\s"]+|bearer\s+[A-Za-z0-9._~+/=-]{16,}|password["'=:\s]+[^,}\s"]+/i.test(text);
}
