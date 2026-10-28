import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const ORIGIN = 'http://127.0.0.1:8787';
export const DATABASE = 'postgresql://hrbp:hrbp@localhost:5432/hrbp';
export const METRICS_TOKEN = 'ci-local-worker-metrics-12345678901234567890';
const MAINTENANCE_TOKEN = 'ci-local-worker-maintenance-12345678901234567890';
export const MAX_RESPONSE_BYTES = 512 * 1024;

export function validateEnvironment(env) {
  assert.equal(env.HRBP_DISPOSABLE_WORKER_SMOKE, 'true', 'Disposable Worker smoke opt-in is required.');
  assert.equal(env.DATABASE_URL, DATABASE, 'Only the fixed disposable local database is allowed.');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'An exact merge-candidate SHA is required.');
  return env.GITHUB_SHA;
}

// Copy only the reviewed runtime compatibility settings, never provider IDs,
// remote bindings, deployment settings, custom build commands or customer vars.
export function localConfig(root, source) {
  assert.equal(source.main, '.open-next/worker.js');
  assert.equal(source.assets?.directory, '.open-next/assets');
  assert.equal(source.assets?.binding, 'ASSETS');
  assert.match(source.compatibility_date ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(source.compatibility_flags, ['nodejs_compat']);
  return {
    name: 'hrbp-stacked-local-smoke',
    main: resolve(root, source.main),
    compatibility_date: source.compatibility_date,
    compatibility_flags: [...source.compatibility_flags],
    workers_dev: false,
    preview_urls: false,
    assets: { directory: resolve(root, source.assets.directory), binding: 'ASSETS' },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: '00000000000000000000000000000000', localConnectionString: DATABASE }],
    vars: {
      HRBP_METRICS_TOKEN: METRICS_TOKEN,
      HRBP_MAINTENANCE_TOKEN: MAINTENANCE_TOKEN,
      HRBP_LOCAL_AUTH_ENABLED: 'false',
      HRBP_AUTH_TENANT_ID: 'ci-tenant',
      HRBP_SCIM_ENABLED: 'false'
    }
  };
}

export function localEnvironment(directory, path) {
  return {
    PATH: path, HOME: directory, TMPDIR: directory,
    XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory,
    CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false'
  };
}

export async function request(path, { method = 'GET', token, signal } = {}, fetchImpl = fetch) {
  assert.match(path, /^(?:\/api\/health\/runtime\?probe=[a-f0-9]{32}|\/api\/internal\/(?:metrics|audit-history))$/);
  assert.ok(method === 'GET' || method === 'POST');
  const response = await fetchImpl(`${ORIGIN}${path}`, {
    method, redirect: 'manual',
    headers: { accept: '*/*', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])])
  });
  const reader = response.body?.getReader();
  const chunks = [];
  let length = 0;
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        assert.ok(length <= MAX_RESPONSE_BYTES, 'Worker response exceeded the byte limit.');
        chunks.push(value);
      }
    }
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
  return { status: response.status, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') };
}

export function verifyHealth(response, revision, probe, now = Date.now()) {
  assert.equal(response.status, 200, 'Worker health must return HTTP 200 without redirects.');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/i);
  assert.match(response.headers.get('cache-control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = JSON.parse(response.text);
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'probe', 'release', 'runtime', 'scope', 'service', 'timestamp']);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'hrbp');
  assert.equal(body.runtime, 'cloudflare-workers');
  assert.equal(body.scope, 'runtime-and-release-only');
  assert.deepEqual(body.release, { protocolVersion: 1, revision });
  assert.equal(body.probe, probe, 'Worker must echo this request, not a stale response.');
  assert.ok(typeof body.timestamp === 'string' && Math.abs(Date.parse(body.timestamp) - now) <= 120000,
    'Worker health timestamp must be recent.');
}

export function verifyMetrics(response) {
  assert.equal(response.status, 200, 'Authenticated Worker-to-PostgreSQL metrics read must succeed.');
  assert.match(response.headers.get('content-type') ?? '', /^text\/plain\s*;\s*version=0\.0\.4;/i);
  assert.match(response.headers.get('cache-control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.text.split('\n').filter(line => line.startsWith('hrbp_operational_metrics_up ')).join('\n'),
    'hrbp_operational_metrics_up 1');
  for (const name of ['hrbp_audit_history_tenant_universe', 'hrbp_notification_outbox_due_jobs']) {
    assert.match(response.text, new RegExp(`^${name} [0-9]+$`, 'm'));
  }
}

export async function verifyWorker(revision, { send = request, signal, alive = () => true, attempts = 45, pause = 1000 } = {}) {
  const checks = [];
  const probe = randomBytes(16).toString('hex');
  let ready = false;
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted();
    assert.ok(alive(), 'Local Worker process exited before readiness.');
    let response;
    try { response = await send(`/api/health/runtime?probe=${probe}`, { signal }); }
    catch (error) {
      signal?.throwIfAborted();
      // Only network/startup unavailability is retryable. Invalid successful
      // payloads, oversized bodies and broken response contracts fail immediately.
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    if (response?.status === 200) {
      verifyHealth(response, revision, probe);
      ready = true;
      break;
    }
    if (response && ![500, 502, 503, 504].includes(response.status)) {
      throw new Error(`Unexpected readiness HTTP status: ${response.status}`);
    }
    if (i + 1 < attempts) await delay(pause, undefined, { signal });
  }
  assert.ok(ready, 'Local Worker did not become ready within the bounded attempts.');
  checks.push('health-source-revision-and-fresh-probe');
  for (const [path, method] of [['/api/internal/metrics', 'GET'], ['/api/internal/audit-history', 'POST']]) {
    for (const token of [undefined, 'ci-deliberately-invalid-token-12345678901234567890']) {
      const response = await send(path, { method, token, signal });
      assert.equal(response.status, 401, `${path} must reject ${token ? 'invalid' : 'missing'} credentials.`);
      checks.push(`${path}:${token ? 'invalid' : 'missing'}-token-denied`);
    }
  }
  verifyMetrics(await send('/api/internal/metrics', { token: METRICS_TOKEN, signal }));
  checks.push('authenticated-worker-postgresql-metrics-read');
  const finalProbe = randomBytes(16).toString('hex');
  verifyHealth(await send(`/api/health/runtime?probe=${finalProbe}`, { signal }), revision, finalProbe);
  assert.ok(alive(), 'Worker exited during smoke checks.');
  checks.push('post-check-health-with-new-probe');
  return { scope: 'ci-local-worker-only', revision, checks, releaseAuthorized: false, productionDeployed: false };
}

// Linux CI process group: terminate descendants even if the launcher has exited.
export async function stopWorker(child) {
  if (!child?.pid) return;
  const kill = signal => {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  kill('SIGTERM');
  await delay(500);
  kill('SIGKILL');
}

export async function requireFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 8787, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function main() {
  assert.equal(process.platform, 'linux', 'The disposable Worker harness requires Linux process groups.');
  const revision = validateEnvironment(process.env);
  await requireFreePort();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const config = localConfig(root, source);
  const directory = await mkdtemp(resolve(tmpdir(), 'hrbp-stacked-worker-'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Worker smoke exceeded 180 seconds.')), 180000);
  let child;
  let launchError;
  let tail = '';
  const interrupt = () => controller.abort(new Error('Worker smoke interrupted.'));
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(config), { mode: 0o600 });
    await writeFile(resolve(directory, '.dev.vars'), '', { mode: 0o600 });
    child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0',
      '--config', resolve(directory, 'wrangler.json'), '--persist-to', resolve(directory, 'state')], {
      cwd: directory, env: localEnvironment(directory, process.env.PATH),
      detached: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.on('error', error => { launchError = error; });
    const capture = data => { tail = (tail + data.toString('utf8')).slice(-16384); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const summary = await verifyWorker(revision, {
      signal: controller.signal,
      alive: () => !launchError && child.exitCode === null && child.signalCode === null
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    for (const value of [METRICS_TOKEN, MAINTENANCE_TOKEN, DATABASE]) tail = tail.split(value).join('[synthetic-ci-value]');
    console.error('Local Worker diagnostics (bounded tail):\n' + tail);
    throw error;
  } finally {
    clearTimeout(timeout);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    try { await stopWorker(child); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
