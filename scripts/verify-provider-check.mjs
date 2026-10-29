import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizedProviderVersionId, normalizedRevision } from '../lib/runtime-health.mjs';

const MAX_BYTES = 128 * 1024;
const MAX_SUMMARY_CHARS = 8192;
export const CLOUDFLARE_CHECK_NAME = 'Workers Builds: hrbp';
export const CLOUDFLARE_APP_ID = 85455;
export const CLOUDFLARE_APP_SLUG = 'cloudflare-workers-and-pages';
export const CLOUDFLARE_APP_OWNER = 'cloudflare';

function validRepository(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return null;
  const [owner, name] = value.split('/');
  return [owner, name].some(part => part === '.' || part === '..') ? null : value;
}
function validToken(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(value) ? value : null;
}

export function providerCheckConfig({ repository, expectedRevision, expectedBuildId, expectedVersionId, token, timeoutMs = 10000 }) {
  const repo = validRepository(repository);
  const revision = normalizedRevision(expectedRevision);
  const buildId = normalizedProviderVersionId(expectedBuildId);
  const versionId = normalizedProviderVersionId(expectedVersionId);
  const auth = validToken(token);
  if (!repo) throw new Error('Invalid GitHub repository.');
  if (!revision) throw new Error('A full 40-character expected commit SHA is required.');
  if (!buildId) throw new Error('A canonical provider build UUID is required.');
  if (!versionId) throw new Error('A canonical provider version UUID is required.');
  if (!auth) throw new Error('A GitHub checks-read token is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid provider-check timeout.');
  return { repository: repo, expectedRevision: revision, expectedBuildId: buildId, expectedVersionId: versionId, token: auth, timeoutMs };
}

async function boundedJson(response) {
  if (!response.body) throw new Error('INVALID_RESPONSE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('INVALID_RESPONSE');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function providerVersionFromSummary(summary) {
  if (typeof summary !== 'string' || summary.length > MAX_SUMMARY_CHARS) return null;
  const matches = [...summary.matchAll(/(?:^|\n)Version ID: ([a-f0-9-]{36})(?=\n|$)/gi)];
  if (matches.length !== 1) return null;
  return normalizedProviderVersionId(matches[0][1]);
}

function candidateIdentity(check, config) {
  return check && typeof check === 'object' &&
    check.name === CLOUDFLARE_CHECK_NAME &&
    normalizedRevision(check.head_sha) === config.expectedRevision &&
    check.app?.id === CLOUDFLARE_APP_ID &&
    check.app?.slug === CLOUDFLARE_APP_SLUG &&
    check.app?.owner?.login === CLOUDFLARE_APP_OWNER;
}

export function evaluateProviderChecks(payload, config) {
  const base = {
    success: false,
    code: 'PROVIDER_CHECK_UNCONFIRMED',
    expectedRevision: config.expectedRevision,
    expectedBuildId: config.expectedBuildId,
    expectedProviderVersionId: config.expectedVersionId,
    observedCheckRunId: null,
    observedConclusion: null,
    observedProviderVersionId: null,
    providerAppId: CLOUDFLARE_APP_ID
  };
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.check_runs) || payload.check_runs.length > 10) {
    return { ...base, code: 'PROVIDER_CHECK_RESPONSE_INVALID' };
  }
  const matchingBuild = payload.check_runs.filter(check =>
    normalizedProviderVersionId(check?.external_id) === config.expectedBuildId);
  if (matchingBuild.length === 0) return { ...base, code: 'PROVIDER_CHECK_NOT_FOUND' };
  if (matchingBuild.length !== 1) return { ...base, code: 'PROVIDER_CHECK_AMBIGUOUS' };
  const check = matchingBuild[0];
  const safe = {
    ...base,
    observedCheckRunId: Number.isSafeInteger(check.id) && check.id > 0 ? check.id : null,
    observedConclusion: typeof check.conclusion === 'string' && /^[a-z_]{1,32}$/.test(check.conclusion) ? check.conclusion : null
  };
  if (!candidateIdentity(check, config) || !safe.observedCheckRunId) {
    return { ...safe, code: 'PROVIDER_CHECK_IDENTITY_MISMATCH' };
  }
  if (check.status !== 'completed' || check.conclusion !== 'success') {
    return { ...safe, code: 'PROVIDER_BUILD_NOT_SUCCESSFUL' };
  }
  const observedVersion = providerVersionFromSummary(check.output?.summary);
  if (!observedVersion) return { ...safe, code: 'PROVIDER_CHECK_VERSION_UNIDENTIFIED' };
  const versionSafe = { ...safe, observedProviderVersionId: observedVersion };
  if (observedVersion !== config.expectedVersionId) return { ...versionSafe, code: 'PROVIDER_CHECK_VERSION_MISMATCH' };
  return { ...versionSafe, success: true, code: 'PROVIDER_BUILD_AND_VERSION_SUCCESS_CONFIRMED' };
}

/** Read-only GitHub Checks API lookup. Never follows redirects or logs provider output/token values. */
export async function verifyProviderCheck({ repository, expectedRevision, expectedBuildId, expectedVersionId, token, timeoutMs = 10000,
  fetchImpl = globalThis.fetch }) {
  const config = providerCheckConfig({ repository, expectedRevision, expectedBuildId, expectedVersionId, token, timeoutMs });
  const [owner, name] = config.repository.split('/');
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${config.expectedRevision}/check-runs`);
  url.searchParams.set('check_name', CLOUDFLARE_CHECK_NAME);
  url.searchParams.set('filter', 'latest');
  url.searchParams.set('per_page', '10');
  url.searchParams.set('app_id', String(CLOUDFLARE_APP_ID));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const base = { success: false, code: 'PROVIDER_CHECK_UNCONFIRMED', expectedRevision: config.expectedRevision,
    expectedBuildId: config.expectedBuildId, expectedProviderVersionId: config.expectedVersionId,
    observedCheckRunId: null, observedConclusion: null, observedProviderVersionId: null, providerAppId: CLOUDFLARE_APP_ID };
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2026-03-10'
        }
      });
    } catch {
      return { ...base, code: controller.signal.aborted ? 'PROVIDER_CHECK_TIMEOUT' : 'PROVIDER_CHECK_REACHABILITY_UNCONFIRMED' };
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { ...base, code: response.status === 403 ? 'PROVIDER_CHECK_ACCESS_BLOCKED' : 'PROVIDER_CHECK_HTTP_FAILURE' };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      void response.body?.cancel().catch(() => {});
      return { ...base, code: 'PROVIDER_CHECK_RESPONSE_INVALID' };
    }
    let payload;
    try { payload = await boundedJson(response); }
    catch { return { ...base, code: controller.signal.aborted ? 'PROVIDER_CHECK_TIMEOUT' : 'PROVIDER_CHECK_RESPONSE_INVALID' }; }
    return evaluateProviderChecks(payload, config);
  } finally {
    clearTimeout(timeout);
  }
}

export function providerCheckSummary(result) {
  return ['## Cloudflare provider build check', '',
    `Result: **${result.success ? 'confirmed' : 'not confirmed'}** (${result.code})`, '',
    `Expected source: \`${result.expectedRevision}\``,
    `Expected build: \`${result.expectedBuildId}\``,
    `Expected provider version: \`${result.expectedProviderVersionId}\``,
    `Cloudflare GitHub App ID: \`${result.providerAppId}\``,
    `Observed check run: \`${result.observedCheckRunId || 'unidentified'}\``,
    `Observed conclusion: \`${result.observedConclusion || 'unidentified'}\``,
    `Observed provider version: \`${result.observedProviderVersionId || 'unidentified'}\``, '',
    'Scope: GitHub Checks metadata from the Cloudflare Workers and Pages App only. Cloudflare build-log contents, account configuration, quota, permissions and deployed runtime traffic allocation are NOT verified by this step.', ''].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyProviderCheck({
      repository: process.env.GITHUB_REPOSITORY,
      expectedRevision: process.env.HRBP_EXPECTED_REVISION,
      expectedBuildId: process.env.HRBP_EXPECTED_PROVIDER_BUILD_ID,
      expectedVersionId: process.env.HRBP_EXPECTED_PROVIDER_VERSION_ID,
      token: process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, providerCheckSummary(report));
    if (!report.success) process.exitCode = 1;
  } catch {
    console.error('Provider-check verification configuration failed; no token or provider output is printed.');
    process.exitCode = 1;
  }
}
