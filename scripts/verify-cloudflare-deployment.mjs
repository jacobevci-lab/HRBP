import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizedProviderVersionId } from '../lib/runtime-health.mjs';

const API_ORIGIN = 'https://api.cloudflare.com';
const MAX_BYTES = 64 * 1024;
export const CLOUDFLARE_SCRIPT_NAME = 'hrbp';

function normalizedDeploymentId(value) { return normalizedProviderVersionId(value); }
function validAccountId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : null;
}
function validToken(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(value) ? value : null;
}
export function cloudflareDeploymentConfig({ accountId, token, expectedVersionId, timeoutMs = 10000 }) {
  const account = validAccountId(accountId), auth = validToken(token), versionId = normalizedProviderVersionId(expectedVersionId);
  if (!account) throw new Error('A canonical Cloudflare account ID is required.');
  if (!auth) throw new Error('A Cloudflare metadata-read token is required.');
  if (!versionId) throw new Error('A canonical provider version UUID is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid Cloudflare deployment timeout.');
  return { accountId: account, token: auth, expectedVersionId: versionId, timeoutMs };
}
async function boundedJson(response) {
  if (!response.body) throw new Error('INVALID_RESPONSE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('INVALID_RESPONSE');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
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
function safeSource(value) { return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : null; }
export function evaluateCloudflareDeployments(payload, expectedVersionId) {
  const base = { success: false, code: 'CLOUDFLARE_DEPLOYMENT_UNCONFIRMED', expectedProviderVersionId: expectedVersionId,
    observedDeploymentId: null, observedProviderVersionId: null, observedTrafficPercentage: null, observedDeploymentSource: null };
  if (!payload || typeof payload !== 'object' || payload.success !== true || !Array.isArray(payload.errors) || payload.errors.length !== 0 ||
      !payload.result || typeof payload.result !== 'object' || !Array.isArray(payload.result.deployments) || payload.result.deployments.length !== 1) {
    return { ...base, code: 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' };
  }
  const deployment = payload.result.deployments[0];
  const deploymentId = normalizedDeploymentId(deployment?.id), source = safeSource(deployment?.source);
  if (!deploymentId || deployment?.strategy !== 'percentage' || !Array.isArray(deployment?.versions) ||
      deployment.versions.length < 1 || deployment.versions.length > 2) return { ...base, code: 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' };
  const versions = [];
  for (const item of deployment.versions) {
    const versionId = normalizedProviderVersionId(item?.version_id), percentage = item?.percentage;
    if (!versionId || typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0.01 || percentage > 100) {
      return { ...base, observedDeploymentId: deploymentId, observedDeploymentSource: source, code: 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' };
    }
    versions.push({ versionId, percentage });
  }
  const total = versions.reduce((sum, item) => sum + item.percentage, 0);
  if (Math.abs(total - 100) > 0.000001) return { ...base, observedDeploymentId: deploymentId, observedDeploymentSource: source, code: 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' };
  const expected = versions.filter(item => item.versionId === expectedVersionId);
  if (expected.length !== 1) return { ...base, observedDeploymentId: deploymentId, observedDeploymentSource: source, code: 'CLOUDFLARE_VERSION_NOT_ACTIVE' };
  const observed = { ...base, observedDeploymentId: deploymentId, observedDeploymentSource: source,
    observedProviderVersionId: expected[0].versionId, observedTrafficPercentage: expected[0].percentage };
  if (versions.length !== 1 || expected[0].percentage !== 100) return { ...observed, code: 'CLOUDFLARE_TRAFFIC_SPLIT' };
  return { ...observed, success: true, code: 'CLOUDFLARE_100_PERCENT_DEPLOYMENT_CONFIRMED' };
}
export async function verifyCloudflareDeployment({ accountId, token, expectedVersionId, timeoutMs = 10000, fetchImpl = globalThis.fetch }) {
  const config = cloudflareDeploymentConfig({ accountId, token, expectedVersionId, timeoutMs });
  const url = new URL('/client/v4/accounts/' + config.accountId + '/workers/scripts/' + CLOUDFLARE_SCRIPT_NAME + '/deployments', API_ORIGIN);
  url.searchParams.set('page', '1'); url.searchParams.set('per_page', '1');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const base = { success: false, code: 'CLOUDFLARE_DEPLOYMENT_UNCONFIRMED', expectedProviderVersionId: config.expectedVersionId,
    observedDeploymentId: null, observedProviderVersionId: null, observedTrafficPercentage: null, observedDeploymentSource: null };
  try {
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + config.token } });
    } catch { return { ...base, code: controller.signal.aborted ? 'CLOUDFLARE_DEPLOYMENT_TIMEOUT' : 'CLOUDFLARE_DEPLOYMENT_REACHABILITY_UNCONFIRMED' }; }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { ...base, code: [401,403].includes(response.status) ? 'CLOUDFLARE_DEPLOYMENT_ACCESS_BLOCKED' : 'CLOUDFLARE_DEPLOYMENT_HTTP_FAILURE' };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      void response.body?.cancel().catch(() => {}); return { ...base, code: 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' };
    }
    let payload;
    try { payload = await boundedJson(response); }
    catch { return { ...base, code: controller.signal.aborted ? 'CLOUDFLARE_DEPLOYMENT_TIMEOUT' : 'CLOUDFLARE_DEPLOYMENT_RESPONSE_INVALID' }; }
    return evaluateCloudflareDeployments(payload, config.expectedVersionId);
  } finally { clearTimeout(timeout); }
}
export function cloudflareDeploymentSummary(result) {
  return ['## Cloudflare active deployment verification', '', 'Result: **' + (result.success ? 'confirmed' : 'not confirmed') + '** (' + result.code + ')', '',
    'Expected provider version: `' + result.expectedProviderVersionId + '`', 'Observed deployment: `' + (result.observedDeploymentId || 'unidentified') + '`',
    'Observed provider version: `' + (result.observedProviderVersionId || 'unidentified') + '`',
    'Observed traffic: ' + (result.observedTrafficPercentage ?? 'unidentified') + '%',
    'Deployment source: `' + (result.observedDeploymentSource || 'unidentified') + '`', '',
    'Scope: read-only Cloudflare Workers deployment metadata for the latest actively serving deployment. Build-log contents, account settings, token permissions beyond this read, database state and business workflows are NOT verified.', ''].join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyCloudflareDeployment({ accountId: process.env.HRBP_CLOUDFLARE_ACCOUNT_ID,
      token: process.env.HRBP_CLOUDFLARE_METADATA_READ_TOKEN, expectedVersionId: process.env.HRBP_EXPECTED_PROVIDER_VERSION_ID });
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, cloudflareDeploymentSummary(report));
    if (!report.success) process.exitCode = 1;
  } catch {
    console.error('Cloudflare deployment verification configuration failed; no token, account or provider output is printed.');
    process.exitCode = 1;
  }
}
