import { randomBytes } from 'node:crypto';
import { MAINTENANCE_JOBS, MAINTENANCE_PROTOCOL_VERSION } from '../lib/maintenance-protocol.mjs';

const DATABASE = 'postgresql://hrbp:hrbp@localhost:5432/hrbp';
const ENDPOINT = '/api/internal/maintenance';
const JOB = 'operational-maintenance';
export const MAINTENANCE_PATHS = Object.freeze([
  ENDPOINT, `${ENDPOINT}?job=${JOB}`, `${ENDPOINT}?job=`, `${ENDPOINT}?job=unsupported`,
  `${ENDPOINT}?job=${JOB}&job=${JOB}`
]);
export const MAX_MAINTENANCE_BYTES = 32768;

function requireCheck(condition, code) {
  // Never include response bodies, database rows, connection strings or tokens.
  if (!condition) throw new Error(code);
}

export function fixtureClientOptions(env) {
  requireCheck(env.CI === 'true' && env.HRBP_DISPOSABLE_WORKER_SMOKE === 'true', 'DISPOSABLE_CI_REQUIRED');
  requireCheck(env.DATABASE_URL === DATABASE, 'LOCAL_DATABASE_REQUIRED');
  requireCheck(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''), 'SOURCE_REVISION_REQUIRED');
  return {
    datasourceUrl: `${DATABASE}?connection_limit=1&connect_timeout=5&pool_timeout=5&socket_timeout=10`,
    transactionOptions: { maxWait: 5000, timeout: 10000 }
  };
}

export async function maintenanceRequest(path, { method = 'GET', token, signal } = {}, fetchImpl = fetch) {
  requireCheck(MAINTENANCE_PATHS.includes(path), 'MAINTENANCE_PATH_NOT_ALLOWED');
  requireCheck(method === 'GET' || method === 'POST', 'MAINTENANCE_METHOD_NOT_ALLOWED');
  // Never exercise the legacy all-jobs POST, even accidentally.
  requireCheck(method !== 'POST' || path !== ENDPOINT, 'EXPLICIT_JOB_REQUIRED');
  const response = await fetchImpl(`http://127.0.0.1:8787${path}`, {
    method, redirect: 'manual',
    headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
  });
  const reader = response.body?.getReader();
  try {
    requireCheck(response.status < 300 || response.status >= 400, 'MAINTENANCE_REDIRECT_DENIED');
    requireCheck(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'MAINTENANCE_JSON_REQUIRED');
    requireCheck(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? ''), 'MAINTENANCE_NO_STORE_REQUIRED');
    requireCheck(Boolean(reader), 'MAINTENANCE_BODY_REQUIRED');
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      requireCheck(bytes <= MAX_MAINTENANCE_BYTES, 'MAINTENANCE_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error('MAINTENANCE_JSON_INVALID'); }
    requireCheck(body !== null && typeof body === 'object' && !Array.isArray(body), 'MAINTENANCE_OBJECT_REQUIRED');
    return { status: response.status, body };
  } finally {
    if (reader) {
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
  }
}

export function verifyCapabilities(response) {
  const data = response.body?.data;
  const jobs = data?.jobs;
  requireCheck(response.status === 200 && data?.protocolVersion === MAINTENANCE_PROTOCOL_VERSION &&
    Array.isArray(jobs) && jobs.length === MAINTENANCE_JOBS.length && new Set(jobs).size === jobs.length &&
    MAINTENANCE_JOBS.every(job => jobs.includes(job)), 'MAINTENANCE_CAPABILITIES_MISMATCH');
}

export function verifyExecution(response) {
  const body = response.body;
  requireCheck(response.status === 200 && body && !body.error &&
    (body.failures === undefined || (Array.isArray(body.failures) && body.failures.length === 0)),
  'MAINTENANCE_EXECUTION_FAILED');
  const run = body.execution;
  requireCheck(body.data && typeof body.data === 'object' && !Array.isArray(body.data) &&
    run?.protocolVersion === MAINTENANCE_PROTOCOL_VERSION && run.mode === 'single' &&
    Array.isArray(run.jobs) && run.jobs.length === 1 && run.jobs[0]?.job === JOB && run.jobs[0].status === 'success',
  'MAINTENANCE_EXECUTION_MISMATCH');
  const started = Date.parse(run.startedAt);
  const completed = Date.parse(run.completedAt);
  requireCheck(Number.isFinite(started) && Number.isFinite(completed) && completed >= started &&
    Number.isFinite(run.durationMs) && run.durationMs >= 0 &&
    Number.isFinite(run.jobs[0].durationMs) && run.jobs[0].durationMs >= 0, 'MAINTENANCE_TIMING_INVALID');
}

export function fixtureRows(tenantId, now = Date.now()) {
  requireCheck(/^ci-worker-maintenance-[a-f0-9]{24}$/.test(tenantId), 'FIXTURE_ID_INVALID');
  requireCheck(Number.isSafeInteger(now) && now > 0, 'FIXTURE_TIME_INVALID');
  const old = new Date(now - 200 * 86400000);
  const base = { tenantId, eventType: 'CI_NOTIFICATION', recipientUserId: 'ci-user',
    resourceType: 'CI', channel: 'IN_APP' };
  return [
    { ...base, id: `${tenantId}-pending`, resourceId: 'dispatch', dedupeKey: 'pending',
      status: 'PENDING', attempts: 0, nextAttemptAt: new Date(now - 1000) },
    { ...base, id: `${tenantId}-expired`, resourceId: 'retention', dedupeKey: 'expired',
      status: 'DELIVERED', attempts: 1, nextAttemptAt: old, deliveredAt: old, readAt: old, createdAt: old },
    { ...base, id: `${tenantId}-future`, resourceId: 'future', dedupeKey: 'future',
      status: 'PENDING', attempts: 0, nextAttemptAt: new Date(now + 86400000) },
    { ...base, id: `${tenantId}-unread`, resourceId: 'unread', dedupeKey: 'unread',
      status: 'DELIVERED', attempts: 1, nextAttemptAt: old, deliveredAt: old, createdAt: old }
  ];
}

export async function createMaintenanceFixture(db, env) {
  fixtureClientOptions(env);
  const tenantId = `ci-worker-maintenance-${randomBytes(12).toString('hex')}`;
  const rows = fixtureRows(tenantId);
  // A failed seed rolls back; no cleanup may target a pre-existing tenant.
  await db.$transaction(async tx => {
    await tx.tenant.create({ data: { id: tenantId, name: 'Disposable Worker maintenance', region: 'test' } });
    const result = await tx.notificationOutbox.createMany({ data: rows });
    requireCheck(result.count === 4, 'FIXTURE_SEED_INCOMPLETE');
  });
  return {
    tenantId,
    async snapshot() {
      return await db.notificationOutbox.findMany({ where: { tenantId }, orderBy: { id: 'asc' },
        select: { id: true, status: true, attempts: true, nextAttemptAt: true, deliveredAt: true,
          readAt: true, lockedAt: true, lastError: true, updatedAt: true } });
    },
    async cleanup() {
      await db.$transaction(async tx => {
        await tx.notificationOutbox.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { id: tenantId } });
      });
    }
  };
}

export function verifyPersisted(initial, after, tenantId) {
  requireCheck(Array.isArray(initial) && initial.length === 4 && Array.isArray(after) && after.length === 3,
    'MAINTENANCE_FIXTURE_INVENTORY_MISMATCH');
  const pending = after.find(row => row.id === `${tenantId}-pending`);
  requireCheck(pending?.status === 'DELIVERED' && pending.attempts === 1 &&
    pending.deliveredAt instanceof Date && Number.isFinite(pending.deliveredAt.getTime()) &&
    pending.lockedAt === null && pending.lastError === null, 'MAINTENANCE_DELIVERY_NOT_PERSISTED');
  requireCheck(!after.some(row => row.id === `${tenantId}-expired`), 'MAINTENANCE_RETENTION_NOT_PERSISTED');
  for (const suffix of ['future', 'unread']) {
    const before = initial.find(row => row.id === `${tenantId}-${suffix}`);
    const retained = after.find(row => row.id === `${tenantId}-${suffix}`);
    requireCheck(Boolean(before) && Boolean(retained) && JSON.stringify(before) === JSON.stringify(retained),
      'MAINTENANCE_PROTECTED_FIXTURE_CHANGED');
  }
}

export async function verifyMaintenance(fixture, { token, signal, send = maintenanceRequest, alive = () => true }) {
  requireCheck(typeof token === 'string' && token.length >= 32, 'SYNTHETIC_MAINTENANCE_TOKEN_REQUIRED');
  const checks = [];
  const ensureRunning = () => {
    signal?.throwIfAborted();
    requireCheck(alive(), 'MAINTENANCE_WORKER_EXITED');
  };
  const call = async (path, options) => {
    ensureRunning();
    const response = await send(path, { ...options, signal });
    ensureRunning();
    return response;
  };
  ensureRunning();
  const initial = await fixture.snapshot();
  requireCheck(Array.isArray(initial) && initial.length === 4 &&
    initial.some(row => row.id === `${fixture.tenantId}-pending` && row.status === 'PENDING' && row.attempts === 0) &&
    initial.some(row => row.id === `${fixture.tenantId}-expired` && row.status === 'DELIVERED'), 'FIXTURE_PRECONDITION_FAILED');
  const unchanged = async () => requireCheck(JSON.stringify(await fixture.snapshot()) === JSON.stringify(initial),
    'REJECTED_OR_READONLY_REQUEST_CHANGED_FIXTURE');
  for (const method of ['GET', 'POST']) {
    for (const credential of [undefined, 'ci-deliberately-wrong-maintenance-token']) {
      const response = await call(MAINTENANCE_PATHS[1], { method, token: credential });
      requireCheck(response.status === 401, 'MAINTENANCE_UNAUTHORIZED_ACCEPTED');
      await unchanged();
      checks.push(`maintenance-${method}-${credential ? 'invalid' : 'missing'}-token-denied-without-fixture-change`);
    }
  }
  for (const path of MAINTENANCE_PATHS.slice(2)) {
    const response = await call(path, { method: 'POST', token });
    requireCheck(response.status === 400, 'MAINTENANCE_INVALID_SELECTOR_ACCEPTED');
    await unchanged();
    checks.push(`maintenance-invalid-selector-${checks.length - 3}-denied-without-fixture-change`);
  }
  verifyCapabilities(await call(ENDPOINT, { token }));
  await unchanged();
  checks.push('maintenance-capabilities-readonly');
  verifyExecution(await call(MAINTENANCE_PATHS[1], { method: 'POST', token }));
  const committed = await fixture.snapshot();
  verifyPersisted(initial, committed, fixture.tenantId);
  checks.push('maintenance-delivery-retention-and-protected-fixtures-persisted');
  verifyExecution(await call(MAINTENANCE_PATHS[1], { method: 'POST', token }));
  requireCheck(JSON.stringify(await fixture.snapshot()) === JSON.stringify(committed), 'MAINTENANCE_REPLAY_CHANGED_FIXTURE');
  ensureRunning();
  checks.push('maintenance-replay-preserves-committed-fixtures');
  return checks;
}
