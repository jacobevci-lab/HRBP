import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOUDFLARE_APP_ID, providerCheckConfig, providerCheckSummary, verifyProviderCheck } from './verify-provider-check.mjs';

const SHA = 'a'.repeat(40);
const BUILD = '11111111-2222-4333-8444-555555555555';
const VERSION = '2dcda87c-1cf4-4072-9739-214e95136994';
const OTHER_BUILD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_VERSION = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TOKEN = 'github-checks-read-token';
const base = { repository: 'jacobevci-lab/HRBP', expectedRevision: SHA, expectedBuildId: BUILD, expectedVersionId: VERSION, token: TOKEN };
function check(changes = {}) {
  return {
    id: 123456,
    name: 'Workers Builds: hrbp',
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    external_id: BUILD,
    output: { summary: `\nBuild ID: [${BUILD}](https://dash.cloudflare.example/build)\nScript: [hrbp](https://dash.cloudflare.example/script)\nVersion ID: ${VERSION}\n` },
    app: { id: 85455, slug: 'cloudflare-workers-and-pages', owner: { login: 'cloudflare' } },
    ...changes
  };
}
function reply(check_runs = [check()], status = 200, headers = {}) {
  return new Response(JSON.stringify({ total_count: check_runs.length, check_runs }), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

test('configuration validates repo, exact revision, build/version UUIDs, token and timeout before network access', () => {
  assert.equal(providerCheckConfig(base).expectedBuildId, BUILD);
  assert.equal(providerCheckConfig(base).expectedVersionId, VERSION);
  for (const extra of [
    { repository: '../other' }, { expectedRevision: 'short' }, { expectedBuildId: 'latest' }, { expectedVersionId: 'latest' },
    { token: '' }, { token: 'bad token' }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { timeoutMs: 1.5 }
  ]) assert.throws(() => providerCheckConfig({ ...base, ...extra }));
});

test('read-only request is pinned to exact GitHub commit, Cloudflare check name and official app id', async () => {
  let calls = 0;
  const result = await verifyProviderCheck({ ...base, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.pathname, `/repos/jacobevci-lab/HRBP/commits/${SHA}/check-runs`);
    assert.equal(url.searchParams.get('check_name'), 'Workers Builds: hrbp');
    assert.equal(url.searchParams.has('status'), false, 'latest in-progress checks must not be hidden behind a completed-only filter');
    assert.equal(url.searchParams.get('filter'), 'latest');
    assert.equal(url.searchParams.get('per_page'), '10');
    assert.equal(url.searchParams.get('app_id'), String(CLOUDFLARE_APP_ID));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
    return reply();
  }});
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    success: true, code: 'PROVIDER_BUILD_AND_VERSION_SUCCESS_CONFIRMED', expectedRevision: SHA, expectedBuildId: BUILD,
    expectedProviderVersionId: VERSION, observedCheckRunId: 123456, observedConclusion: 'success',
    observedProviderVersionId: VERSION, providerAppId: 85455
  });
});

test('failed, cancelled, neutral and incomplete provider checks never pass', async () => {
  for (const [status, conclusion] of [['completed','failure'],['completed','cancelled'],['completed','neutral'],['in_progress',null]]) {
    const result = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([check({ status, conclusion })]) });
    assert.equal(result.success, false);
    assert.equal(result.code, 'PROVIDER_BUILD_NOT_SUCCESSFUL');
  }
});

test('same build id from wrong app, wrong source or malformed check id is rejected', async () => {
  for (const changed of [
    { app: { id: 1, slug: 'cloudflare-workers-and-pages', owner: { login: 'cloudflare' } } },
    { app: { id: 85455, slug: 'other', owner: { login: 'cloudflare' } } },
    { app: { id: 85455, slug: 'cloudflare-workers-and-pages', owner: { login: 'attacker' } } },
    { head_sha: 'b'.repeat(40) }, { name: 'Workers Builds: other' }, { id: '123456' }
  ]) {
    const result = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([check(changed)]) });
    assert.equal(result.success, false);
    assert.equal(result.code, 'PROVIDER_CHECK_IDENTITY_MISMATCH');
  }
});

test('wrong build id is not substituted and duplicate matching build ids fail closed', async () => {
  const missing = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([check({ external_id: OTHER_BUILD })]) });
  assert.equal(missing.code, 'PROVIDER_CHECK_NOT_FOUND');
  const duplicate = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([check(), check({ id: 123457 })]) });
  assert.equal(duplicate.code, 'PROVIDER_CHECK_AMBIGUOUS');
});

test('provider check Version ID must be present exactly once and equal the independently supplied Version ID', async () => {
  const cases = [
    [{ output: { summary: `Build ID: ${BUILD}\n` } }, 'PROVIDER_CHECK_VERSION_UNIDENTIFIED'],
    [{ output: { summary: 'Version ID: not-a-uuid\n' } }, 'PROVIDER_CHECK_VERSION_UNIDENTIFIED'],
    [{ output: { summary: `Version ID: ${VERSION}\nVersion ID: ${VERSION}\n` } }, 'PROVIDER_CHECK_VERSION_UNIDENTIFIED'],
    [{ output: { summary: `Version ID: ${OTHER_VERSION}\n` } }, 'PROVIDER_CHECK_VERSION_MISMATCH']
  ];
  for (const [changed, code] of cases) {
    const result = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([check(changed)]) });
    assert.equal(result.success, false);
    assert.equal(result.code, code);
  }
});

test('HTTP, content-type, malformed, oversized and network failures stay bounded', async () => {
  const failures = [
    [async () => new Response('private-error', { status: 500 }), 'PROVIDER_CHECK_HTTP_FAILURE'],
    [async () => new Response('private-error', { status: 403 }), 'PROVIDER_CHECK_ACCESS_BLOCKED'],
    [async () => new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }), 'PROVIDER_CHECK_RESPONSE_INVALID'],
    [async () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'PROVIDER_CHECK_RESPONSE_INVALID'],
    [async () => new Response('x'.repeat(128 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), 'PROVIDER_CHECK_RESPONSE_INVALID'],
    [async () => { throw new Error('private-network-secret'); }, 'PROVIDER_CHECK_REACHABILITY_UNCONFIRMED']
  ];
  for (const [fetchImpl, code] of failures) {
    const result = await verifyProviderCheck({ ...base, fetchImpl });
    assert.equal(result.success, false);
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('response inventory is bounded and arbitrary provider output never appears in result or summary', async () => {
  const tooMany = await verifyProviderCheck({ ...base, fetchImpl: async () => reply(Array.from({length: 11}, (_,i)=>check({id:100+i, external_id:OTHER_BUILD}))) });
  assert.equal(tooMany.code, 'PROVIDER_CHECK_RESPONSE_INVALID');
  const raw = check({ output: { summary: `PRIVATE_PROVIDER_LOG token=secret\nVersion ID: ${VERSION}\n` }, details_url: 'https://private.invalid/value' });
  const result = await verifyProviderCheck({ ...base, fetchImpl: async () => reply([raw]) });
  const summary = providerCheckSummary(result);
  assert.equal(result.success, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PROVIDER_LOG'));
  assert.ok(!summary.includes('PRIVATE_PROVIDER_LOG'));
  assert.ok(!summary.includes('private.invalid'));
  assert.match(summary, /NOT verified/);
});

test('manual Release Verification binds provider build success before runtime Version ID verification', () => {
  const workflow = readFileSync('.github/workflows/release-verification.yml', 'utf8');
  assert.match(workflow, /expected_provider_build_id:\n\s+description:/);
  assert.match(workflow, /expected_provider_build_id:[\s\S]{0,180}required: true/);
  assert.match(workflow, /^    permissions:\n      contents: read\n      checks: read$/m);
  assert.match(workflow, /HRBP_EXPECTED_PROVIDER_BUILD_ID: \$\{\{ inputs\.expected_provider_build_id \}\}/);
  assert.match(workflow, /HRBP_EXPECTED_PROVIDER_VERSION_ID: \$\{\{ inputs\.expected_provider_version_id \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  const providerStep = workflow.indexOf('run: node scripts/verify-provider-check.mjs');
  const runtimeStep = workflow.indexOf('run: node scripts/verify-deployment.mjs');
  assert.ok(providerStep > 0 && runtimeStep > providerStep);
});

test('mandatory deployment contract includes provider-check tests', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['deployment-verification:validate'],
    'node --test scripts/deployment-verification.test.mjs scripts/provider-version-verification.test.mjs scripts/provider-check-verification.test.mjs');
  assert.ok(pkg.scripts.prebuild.split(' && ').includes('npm run deployment-verification:validate'));
});
