import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { MAINTENANCE_JOBS } from '../lib/maintenance-protocol.mjs';
import { MAINTENANCE_PATHS, MAX_MAINTENANCE_BYTES, fixtureClientOptions, fixtureRows,
  maintenanceRequest, createMaintenanceFixture, verifyCapabilities, verifyExecution,
  verifyPersisted, verifyMaintenance } from './stacked-worker-maintenance.mjs';

const env = { CI: 'true', HRBP_DISPOSABLE_WORKER_SMOKE: 'true',
  DATABASE_URL: 'postgresql://hrbp:hrbp@localhost:5432/hrbp', GITHUB_SHA: 'a'.repeat(40) };
const tenantId = 'ci-worker-maintenance-' + 'b'.repeat(24);
const token = 'ci-synthetic-maintenance-token-1234567890';
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const capabilities = () => ({ status: 200, body: { data: { protocolVersion: 1, jobs: [...MAINTENANCE_JOBS] } } });
const execution = () => ({ status: 200, body: { data: {}, execution: {
  protocolVersion: 1, mode: 'single', startedAt: '2026-10-28T00:00:00.000Z',
  completedAt: '2026-10-28T00:00:00.001Z', durationMs: 1,
  jobs: [{ job: 'operational-maintenance', status: 'success', durationMs: 1 }]
} } });
function rows() {
  return fixtureRows(tenantId).map(row => ({ ...row, deliveredAt: row.deliveredAt ?? null,
    readAt: row.readAt ?? null, lockedAt: null, lastError: null, updatedAt: new Date() }));
}
function committed(initial) {
  return initial.filter(row => !row.id.endsWith('-expired')).map(row => row.id.endsWith('-pending') ?
    { ...row, status: 'DELIVERED', attempts: 1, deliveredAt: new Date() } : { ...row });
}
function simulation(onCall = () => {}) {
  let state = rows();
  let writes = 0;
  let index = 0;
  const calls = [];
  const fixture = { tenantId, snapshot: async () => structuredClone(state) };
  const send = async (path, options) => {
    calls.push({ path, ...options });
    let result;
    if (options.token !== token) result = { status: 401, body: { error: 'Unauthorized' } };
    else if (MAINTENANCE_PATHS.slice(2).includes(path)) result = { status: 400, body: { error: 'Bad selector' } };
    else if (options.method !== 'POST') result = capabilities();
    else {
      if (writes++ === 0) state = committed(state);
      result = execution();
    }
    onCall({ index: index++, path, options, state, result });
    return result;
  };
  return { fixture, send, calls };
}

test('fixture client pins the disposable database and bounded query/transaction options', () => {
  const options = fixtureClientOptions(env);
  const url = new URL(options.datasourceUrl);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.pathname, '/hrbp');
  assert.equal(url.searchParams.get('connection_limit'), '1');
  assert.equal(url.searchParams.get('socket_timeout'), '10');
  assert.deepEqual(options.transactionOptions, { maxWait: 5000, timeout: 10000 });
});

test('fixture setup rejects absent opt-in, non-CI, changed hosts and missing source identity', () => {
  for (const change of [{ CI: undefined }, { CI: 'false' }, { HRBP_DISPOSABLE_WORKER_SMOKE: undefined },
    { DATABASE_URL: env.DATABASE_URL + '?host=remote' }, { DATABASE_URL: 'postgres://production/db' },
    { GITHUB_SHA: 'main' }, { GITHUB_SHA: undefined }]) {
    assert.throws(() => fixtureClientOptions({ ...env, ...change }));
  }
});

test('fixtures separate due, expired-read, future and retained-unread IN_APP records', () => {
  const now = Date.now();
  const data = fixtureRows(tenantId, now);
  assert.equal(data.length, 4);
  assert.equal(new Set(data.map(row => row.id)).size, 4);
  assert.ok(data.every(row => row.tenantId === tenantId && row.channel === 'IN_APP'));
  assert.ok(data[0].nextAttemptAt < now);
  assert.ok(data[1].readAt < now - 180 * 86400000);
  assert.ok(data[2].nextAttemptAt > now);
  assert.equal(data[3].readAt, undefined);
  assert.ok(data[3].deliveredAt > now - 365 * 86400000);
  assert.throws(() => fixtureRows('customer-tenant'));
  assert.throws(() => fixtureRows(tenantId, NaN));
});

test('fixture creation and cleanup use transactions and exact run-owned predicates', async () => {
  const actions = [];
  const tx = {
    tenant: { create: async query => actions.push(['create', query]), deleteMany: async query => actions.push(['tenant-delete', query]) },
    notificationOutbox: { createMany: async query => { actions.push(['seed', query]); return { count: 4 }; },
      deleteMany: async query => actions.push(['outbox-delete', query]) }
  };
  const db = { $transaction: async callback => { actions.push(['transaction']); return await callback(tx); },
    notificationOutbox: { findMany: async query => { actions.push(['snapshot', query]); return []; } } };
  const fixture = await createMaintenanceFixture(db, env);
  assert.match(fixture.tenantId, /^ci-worker-maintenance-[a-f0-9]{24}$/);
  await fixture.snapshot();
  await fixture.cleanup();
  assert.equal(actions.filter(action => action[0] === 'transaction').length, 2);
  for (const [name, query] of actions) {
    if (name === 'outbox-delete' || name === 'snapshot') assert.deepEqual(query.where, { tenantId: fixture.tenantId });
    if (name === 'tenant-delete') assert.deepEqual(query.where, { id: fixture.tenantId });
  }
  assert.ok(actions.findIndex(action => action[0] === 'outbox-delete') < actions.findIndex(action => action[0] === 'tenant-delete'));
});

test('unsafe environment cannot reach a database write', async () => {
  let reached = false;
  await assert.rejects(createMaintenanceFixture({ $transaction: () => { reached = true; } }, { ...env, CI: 'false' }), /DISPOSABLE_CI_REQUIRED/);
  assert.equal(reached, false);
});

test('incomplete seed rejects inside the transaction', async () => {
  const db = { $transaction: async callback => callback({ tenant: { create: async () => {} },
    notificationOutbox: { createMany: async () => ({ count: 3 }) } }) };
  await assert.rejects(createMaintenanceFixture(db, env), /FIXTURE_SEED_INCOMPLETE/);
});

test('transport allows only exact loopback cases and never the all-jobs POST', async () => {
  for (const path of ['https://example.test', '//example.test', '/api/internal/maintenance#fragment',
    '/api/internal/maintenance?job=audit-integrity', '/api/internal/maintenance?job=operational-maintenance&x=1']) {
    await assert.rejects(maintenanceRequest(path, {}, () => assert.fail('must not fetch')), /PATH_NOT_ALLOWED/);
  }
  await assert.rejects(maintenanceRequest(MAINTENANCE_PATHS[0], { method: 'POST' }, () => assert.fail('must not fetch')), /EXPLICIT_JOB_REQUIRED/);
  await assert.rejects(maintenanceRequest(MAINTENANCE_PATHS[1], { method: 'DELETE' }, () => assert.fail('must not fetch')), /METHOD_NOT_ALLOWED/);
  const result = await maintenanceRequest(MAINTENANCE_PATHS[1], { method: 'POST', token }, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8787' + MAINTENANCE_PATHS[1]);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('{}', { status: 200, headers });
  });
  assert.equal(result.status, 200);
});

test('transport rejects redirects, HTML, missing no-store and invalid JSON without raw payload diagnostics', async () => {
  for (const response of [new Response('', { status: 302 }),
    new Response('private payload', { headers: { ...headers, 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    new Response('private payload', { headers }), new Response('[]', { headers }),
    new Response(new Uint8Array([0xff]), { headers })]) {
    await assert.rejects(maintenanceRequest(MAINTENANCE_PATHS[0], {}, async () => response), error =>
      /^MAINTENANCE_[A-Z_]+$/.test(error.message) && !error.message.includes('private payload'));
  }
});

test('oversized response cancels its stream and fails closed', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(MAX_MAINTENANCE_BYTES + 1)); },
    cancel() { cancelled = true; } });
  await assert.rejects(maintenanceRequest(MAINTENANCE_PATHS[0], {}, async () => new Response(stream, { headers })), /RESPONSE_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test('real loopback server cannot redirect a maintenance token to another path', async () => {
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === MAINTENANCE_PATHS[0]) { res.writeHead(302, { location: '/forbidden' }); res.end(); }
    else { redirected++; res.end('{}'); }
  });
  server.listen(8787, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(maintenanceRequest(MAINTENANCE_PATHS[0], { token }), /REDIRECT_DENIED/);
    assert.equal(redirected, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('capability validation requires exact supported inventory and protocol', () => {
  verifyCapabilities(capabilities());
  for (const change of [result => { result.status = 401; }, result => { result.body.data.protocolVersion = 2; },
    result => { result.body.data.jobs.pop(); }, result => { result.body.data.jobs[1] = result.body.data.jobs[0]; },
    result => { result.body.data.jobs = ['operational-maintenance']; }]) {
    const response = capabilities(); change(response); assert.throws(() => verifyCapabilities(response));
  }
});

test('execution validation rejects partial failure, all-jobs mode, wrong job and invalid timing', () => {
  verifyExecution(execution());
  for (const change of [r => { r.status = 500; }, r => { r.body.error = 'failure'; },
    r => { r.body.failures = [{}]; }, r => { r.body.execution.mode = 'all'; },
    r => { r.body.execution.jobs[0].job = 'audit-integrity'; },
    r => { r.body.execution.jobs[0].status = 'failed'; }, r => { r.body.execution.jobs.push({}); },
    r => { r.body.execution.durationMs = -1; }, r => { r.body.execution.jobs[0].durationMs = NaN; },
    r => { r.body.execution.startedAt = 'invalid'; }, r => { r.body.execution.completedAt = '2000-01-01'; }]) {
    const response = execution(); change(response); assert.throws(() => verifyExecution(response));
  }
});

test('complete sequence checks ten runtime cases and reads back each rejected/read-only request', async () => {
  const fake = simulation();
  let reads = 0;
  const snapshot = fake.fixture.snapshot;
  fake.fixture.snapshot = async () => { reads++; return await snapshot(); };
  const checks = await verifyMaintenance(fake.fixture, { token, send: fake.send });
  assert.equal(checks.length, 10);
  assert.equal(fake.calls.length, 10);
  assert.equal(reads, 11);
  assert.equal(fake.calls.filter(call => call.path === MAINTENANCE_PATHS[1] && call.method === 'POST' && call.token === token).length, 2);
});

for (const index of [0, 1, 2, 3, 4, 5, 6]) {
  test(`rejected request ${index + 1} cannot change fixture state even with correct HTTP error`, async () => {
    const fake = simulation(call => { if (call.index === index) call.state[0].attempts++; });
    await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send }), /REQUEST_CHANGED_FIXTURE/);
  });
}

test('capability GET cannot mutate fixture state', async () => {
  const fake = simulation(call => { if (call.index === 7) call.state[0].attempts++; });
  await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send }), /REQUEST_CHANGED_FIXTURE/);
});

test('HTTP 200 without committed delivery and retention is not success', async () => {
  const fake = simulation();
  const initial = await fake.fixture.snapshot();
  fake.fixture.snapshot = async () => structuredClone(initial);
  await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send }), /FIXTURE_INVENTORY_MISMATCH/);
});

test('retained unread and not-yet-due notifications must survive unchanged', () => {
  const initial = rows();
  verifyPersisted(initial, committed(initial), tenantId);
  for (const suffix of ['future', 'unread']) {
    const after = committed(initial); after.find(row => row.id.endsWith(`-${suffix}`)).attempts++;
    assert.throws(() => verifyPersisted(initial, after, tenantId), /PROTECTED_FIXTURE_CHANGED/);
  }
});

test('delivery with wrong attempts, missing timestamp or stale lock is rejected', () => {
  for (const change of [row => { row.attempts = 2; }, row => { row.deliveredAt = null; },
    row => { row.lockedAt = new Date(); }, row => { row.lastError = 'error'; }]) {
    const initial = rows(); const after = committed(initial); change(after.find(row => row.id.endsWith('-pending')));
    assert.throws(() => verifyPersisted(initial, after, tenantId), /DELIVERY_NOT_PERSISTED/);
  }
});

test('repeat execution cannot re-deliver or rewrite committed fixture timestamps', async () => {
  const fake = simulation(call => { if (call.index === 9) call.state.find(row => row.id.endsWith('-pending')).attempts++; });
  await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send }), /REPLAY_CHANGED_FIXTURE/);
});

test('worker death and cancellation abort before another HTTP request', async () => {
  const fake = simulation();
  await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send, alive: () => false }), /WORKER_EXITED/);
  await assert.rejects(verifyMaintenance(fake.fixture, { token, send: fake.send, signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
  assert.equal(fake.calls.length, 0);
});

test('mandatory runtime integration keeps cleanup after Worker termination and before disconnect', () => {
  const workflow = readFileSync(new URL('../.github/workflows/stacked-integration.yml', import.meta.url), 'utf8');
  const app = workflow.split('  application:\n')[1].split('\n  dependencies:\n')[0];
  assert.match(app, /run: node --test scripts\/stacked-worker-maintenance.test.mjs\n/);
  assert.doesNotMatch(app, /^\s*(if|continue-on-error):/m);
  const script = readFileSync(new URL('./stacked-worker-smoke.mjs', import.meta.url), 'utf8');
  for (const expression of ['fixtureClientOptions(process.env)', 'new PrismaClient(clientOptions)',
    'await createMaintenanceFixture(db, process.env)', 'await verifyMaintenance(fixture,', 'post-maintenance-health-with-new-probe']) {
    assert.ok(script.includes(expression), `Missing mandatory integration: ${expression}`);
  }
  assert.ok(script.indexOf('await stopWorker(child)') < script.indexOf('await fixture?.cleanup()'));
  assert.ok(script.indexOf('await fixture?.cleanup()') < script.indexOf('await db?.$disconnect()'));
  assert.ok(script.indexOf('await verifyMaintenance(fixture,') < script.indexOf('console.log(JSON.stringify(summary'));
});
