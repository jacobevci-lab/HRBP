import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  DATABASE, MAX_RESPONSE_BYTES, METRICS_TOKEN, ORIGIN, localConfig, localEnvironment,
  request, requireFreePort, stopWorker, validateEnvironment, verifyHealth, verifyMetrics, verifyWorker
} from './stacked-worker-smoke.mjs';

const revision = 'a'.repeat(40);
const probe = 'b'.repeat(32);
const source = {
  main: '.open-next/worker.js', assets: { directory: '.open-next/assets', binding: 'ASSETS' },
  compatibility_date: '2026-09-14', compatibility_flags: ['nodejs_compat']
};
const health = (nonce = probe) => ({ status: 200,
  headers: new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }),
  text: JSON.stringify({ ok: true, service: 'hrbp', runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(), release: { protocolVersion: 1, revision },
    probe: nonce, scope: 'runtime-and-release-only' })
});
const metrics = () => ({ status: 200,
  headers: new Headers({ 'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }),
  text: 'hrbp_operational_metrics_up 1\nhrbp_audit_history_tenant_universe 0\nhrbp_notification_outbox_due_jobs 0\n'
});
const bodyChange = change => {
  const response = health();
  const body = JSON.parse(response.text);
  change(body);
  response.text = JSON.stringify(body);
  return response;
};
function goodSend(path, options = {}) {
  if (path.startsWith('/api/health/runtime?')) return health(path.split('=')[1]);
  if (path === '/api/internal/metrics' && options.token === METRICS_TOKEN) return metrics();
  return { status: 401, headers: new Headers(), text: 'unauthorized' };
}

test('environment requires explicit disposable opt-in, exact local DB and merge SHA', () => {
  const env = { HRBP_DISPOSABLE_WORKER_SMOKE: 'true', DATABASE_URL: DATABASE, GITHUB_SHA: revision };
  assert.equal(validateEnvironment(env), revision);
  for (const change of [{ HRBP_DISPOSABLE_WORKER_SMOKE: undefined }, { HRBP_DISPOSABLE_WORKER_SMOKE: '1' },
    { DATABASE_URL: 'postgresql://hrbp:hrbp@production.example/hrbp' }, { DATABASE_URL: DATABASE + '?host=remote' },
    { GITHUB_SHA: undefined }, { GITHUB_SHA: 'main' }, { GITHUB_SHA: 'A'.repeat(40) }]) {
    assert.throws(() => validateEnvironment({ ...env, ...change }));
  }
});

test('local config copies compatibility but never source credentials or remote resources', () => {
  const config = localConfig('/tmp/repository', { ...source, account_id: 'customer', routes: ['customer.example'],
    vars: { TOKEN: 'must-not-copy' }, services: [{ service: 'production', remote: true }],
    hyperdrive: [{ id: 'live', localConnectionString: 'postgres://production' }], build: { command: 'publish' } });
  assert.deepEqual(Object.keys(config).sort(), ['assets', 'compatibility_date', 'compatibility_flags', 'hyperdrive',
    'main', 'name', 'preview_urls', 'vars', 'workers_dev']);
  assert.equal(config.hyperdrive[0].localConnectionString, DATABASE);
  assert.equal(config.hyperdrive[0].id, '0'.repeat(32));
  assert.equal(config.main, '/tmp/repository/.open-next/worker.js');
  assert.equal(config.vars.HRBP_BUILD_REVISION, undefined);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.doesNotMatch(JSON.stringify(config), /customer|must-not-copy|production|publish/);
  for (const change of [{ main: '../../worker.js' }, { assets: { directory: '/remote', binding: 'ASSETS' } },
    { compatibility_flags: ['nodejs_compat', 'unexpected'] }, { compatibility_date: '' }]) {
    assert.throws(() => localConfig('/tmp/repository', { ...source, ...change }));
  }
});

test('child environment is an allowlist, with isolated HOME and dotenv loading disabled', () => {
  const env = localEnvironment('/tmp/isolated', '/usr/bin:/bin');
  assert.deepEqual(Object.keys(env).sort(), ['CI', 'CLOUDFLARE_INCLUDE_PROCESS_ENV', 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV',
    'HOME', 'NO_COLOR', 'PATH', 'TMPDIR', 'WRANGLER_SEND_METRICS', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME']);
  assert.equal(env.HOME, '/tmp/isolated');
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
  assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'false');
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
});

test('HTTP transport uses fixed loopback origin, no redirects and bounded bodies', async () => {
  let cancelled = false;
  const response = await request('/api/internal/metrics', { token: METRICS_TOKEN }, async (url, options) => {
    assert.equal(url, ORIGIN + '/api/internal/metrics');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${METRICS_TOKEN}`);
    return new Response('ok', { status: 200 });
  });
  assert.equal(response.text, 'ok');
  await assert.rejects(request('/api/internal/metrics', {}, async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); },
    cancel() { cancelled = true; }
  }))), /byte limit/);
  assert.equal(cancelled, true);
  for (const path of ['https://example.test', '//example.test', '/api/internal/metrics#fragment',
    '/api/internal/metrics?redirect=1', '/api/internal/../metrics', '/api/internal/maintenance']) {
    await assert.rejects(request(path, {}, () => { throw new Error('network must not be reached'); }), assert.AssertionError);
  }
});

test('health verifies source, freshness, exact shape, cache policy and request challenge', () => {
  verifyHealth(health(), revision, probe);
  for (const change of [body => { body.ok = false; }, body => { body.service = 'other'; },
    body => { body.runtime = 'node'; }, body => { body.scope = 'database'; },
    body => { body.release.revision = 'c'.repeat(40); }, body => { body.release.protocolVersion = 2; },
    body => { body.probe = 'd'.repeat(32); }, body => { body.timestamp = '2000-01-01T00:00:00Z'; },
    body => { body.timestamp = 'invalid'; }, body => { body.secret = 'unexpected'; }]) {
    assert.throws(() => verifyHealth(bodyChange(change), revision, probe));
  }
  for (const status of [204, 301, 302, 401, 500, 503]) assert.throws(() => verifyHealth({ ...health(), status }, revision, probe));
  assert.throws(() => verifyHealth({ ...health(), text: '<html>wrong</html>' }, revision, probe));
  for (const name of ['cache-control', 'content-type', 'x-content-type-options']) {
    const response = health(); response.headers.delete(name);
    assert.throws(() => verifyHealth(response, revision, probe));
  }
});

test('metrics requires successful real-query indicator and expected database metric families', () => {
  verifyMetrics(metrics());
  for (const text of ['<html>login</html>', metrics().text.replace('_up 1', '_up 0'),
    metrics().text + 'hrbp_operational_metrics_up 1\n', metrics().text.replace('hrbp_audit_history_tenant_universe 0\n', ''),
    metrics().text.replace('hrbp_notification_outbox_due_jobs 0', 'hrbp_notification_outbox_due_jobs NaN')]) {
    assert.throws(() => verifyMetrics({ ...metrics(), text }));
  }
  assert.throws(() => verifyMetrics({ ...metrics(), status: 503 }));
  const response = metrics(); response.headers.set('content-type', 'text/html');
  assert.throws(() => verifyMetrics(response));
});

test('complete probe sequence performs seven checks without authorizing a deployment', async () => {
  const calls = [];
  const result = await verifyWorker(revision, { send: async (path, options) => {
    calls.push({ path, ...options }); return goodSend(path, options);
  } });
  assert.equal(result.checks.length, 7);
  assert.equal(calls.length, 7);
  assert.equal(result.scope, 'ci-local-worker-only');
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.productionDeployed, false);
  assert.notEqual(calls[0].path, calls.at(-1).path);
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.ok(calls.filter(call => call.method === 'POST').every(call => call.token !== METRICS_TOKEN));
});

test('missing/invalid authorization, metrics failure and terminal health failure deny success', async () => {
  for (const target of [1, 2, 3, 4, 5, 6]) {
    let index = 0;
    await assert.rejects(verifyWorker(revision, { send: async (path, options) => {
      const response = goodSend(path, options);
      if (index++ === target) response.status = target <= 4 ? 200 : 503;
      return response;
    } }));
  }
});

test('readiness retries transient unavailability but rejects redirects and stale revisions immediately', async () => {
  let calls = 0;
  const result = await verifyWorker(revision, { pause: 0, send: async (path, options) => {
    if (calls++ === 0) throw new TypeError('fetch failed');
    if (calls === 2) return { status: 503 };
    return goodSend(path, options);
  } });
  assert.equal(result.checks.length, 7);
  assert.equal(calls, 9);
  for (const status of [301, 302, 401, 404]) {
    let attempts = 0;
    await assert.rejects(verifyWorker(revision, { pause: 0, send: async () => { attempts++; return { status }; } }));
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(verifyWorker(revision, { pause: 0, send: async () => {
    attempts++; return bodyChange(body => { body.release.revision = 'c'.repeat(40); });
  } }));
  assert.equal(attempts, 1);
});

test('readiness exhaustion, worker death and cancellation cannot become success', async () => {
  let calls = 0;
  await assert.rejects(verifyWorker(revision, { attempts: 2, pause: 0, send: async () => { calls++; return { status: 503 }; } }), /bounded attempts/);
  assert.equal(calls, 2);
  await assert.rejects(verifyWorker(revision, { alive: () => false, send: goodSend }), /exited/);
  await assert.rejects(verifyWorker(revision, { signal: AbortSignal.abort(new Error('cancelled')), send: goodSend }), /cancelled/);
  let liveChecks = 0;
  await assert.rejects(verifyWorker(revision, { alive: () => ++liveChecks === 1, send: goodSend }), /exited/);
});

test('real loopback HTTP transport refuses redirects and rejects an already occupied port', async () => {
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === '/api/internal/metrics') { res.writeHead(302, { location: '/forbidden' }); res.end(); }
    else { redirected++; res.end('should not be fetched'); }
  });
  server.listen(8787, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(requireFreePort(), error => error.code === 'EADDRINUSE');
    assert.equal((await request('/api/internal/metrics')).status, 302);
    assert.equal(redirected, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await requireFreePort();
});

test('cleanup terminates the actual detached local process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  await once(child, 'spawn');
  try {
    await stopWorker(child);
    await delay(20);
    assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
    await stopWorker(child);
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});


test('workflow cannot omit or conditionally skip the unit guardrails and bundled runtime step', () => {
  const workflow = readFileSync(new URL('../.github/workflows/stacked-integration.yml', import.meta.url), 'utf8');
  const app = workflow.split('  application:\n')[1].split('\n  dependencies:\n')[0];
  const commands = ['node --test scripts/stacked-worker-smoke.test.mjs', 'npm ci',
    'npm run db:migrate:upgrade', 'npm run cf:build', 'npx --no-install wrangler deploy --dry-run',
    'node scripts/stacked-worker-smoke.mjs'];
  let previous = -1;
  for (const command of commands) {
    const index = app.indexOf(`run: ${command}\n`);
    assert.ok(index > previous, `Missing or reordered required runtime command: ${command}`);
    previous = index;
  }
  assert.match(app, /HRBP_DISPOSABLE_WORKER_SMOKE: "true"/);
  assert.doesNotMatch(app, /^\s*(if|continue-on-error):/m);
  const script = readFileSync(new URL('./stacked-worker-smoke.mjs', import.meta.url), 'utf8');
  assert.match(script, /'dev', '--local', '--ip', '127.0.0.1'/);
  assert.doesNotMatch(script, /--remote|process\.env\.CLOUDFLARE_API_TOKEN|\.\.\.process\.env/);
});
