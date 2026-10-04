import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizedRevision, RELEASE_PROTOCOL_VERSION } from '../lib/runtime-health.mjs';

const MAX_BYTES = 8192;
export function deploymentConfig({ origin, expectedRevision, localSmoke = false, timeoutMs = 10000 }) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Invalid verification origin.'); }
  const loopback = localSmoke && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Verification requires a clean HTTPS origin; local smoke permits explicit loopback only.');
  }
  const expected = normalizedRevision(expectedRevision);
  if (!expected) throw new Error('A full 40-character expected commit SHA is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid verification timeout.');
  return { origin: url.origin, expectedRevision: expected, timeoutMs };
}

async function boundedJson(response) {
  if (!response.body) throw new Error('INVALID_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('INVALID_BODY');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    // No unbounded body dump on HTML/error/oversized responses.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Exactly one anonymous GET. Does not log in, trigger maintenance, retry or follow redirects. */
export async function verifyDeployment({ origin, expectedRevision, localSmoke = false, timeoutMs = 10000,
  fetchImpl = globalThis.fetch, nonce = () => randomBytes(16).toString('hex') }) {
  const config = deploymentConfig({ origin, expectedRevision, localSmoke, timeoutMs });
  const probe = nonce();
  if (typeof probe !== 'string' || !/^[a-f0-9]{32}$/.test(probe)) throw new Error('Invalid probe nonce.');
  const url = new URL('/api/health/runtime', config.origin);
  url.searchParams.set('probe', probe);
  const result = { success: false, code: 'UNCONFIRMED', expectedRevision: config.expectedRevision,
    observedRevision: null, httpStatus: null, scope: 'runtime-and-release-only' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: controller.signal, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    } catch { return { ...result, code: controller.signal.aborted ? 'TIMEOUT' : 'REACHABILITY_UNCONFIRMED' }; }
    result.httpStatus = response.status;
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { ...result, code: [401, 403].includes(response.status) ? 'ACCESS_BLOCKED' : 'HTTP_FAILURE' };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      void response.body?.cancel().catch(() => {});
      return { ...result, code: 'UNEXPECTED_CONTENT_TYPE' };
    }
    let body;
    try { body = await boundedJson(response); }
    catch { return { ...result, code: controller.signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE' }; }
    if (!body || body.ok !== true || body.service !== 'hrbp') return { ...result, code: 'UNEXPECTED_SERVICE' };
    if (body.release?.protocolVersion !== RELEASE_PROTOCOL_VERSION || body.scope !== result.scope) {
      return { ...result, code: 'RELEASE_PROTOCOL_UNAVAILABLE' };
    }
    if (body.probe !== probe || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') || '')) {
      return { ...result, code: 'FRESH_RESPONSE_UNCONFIRMED' };
    }
    result.observedRevision = normalizedRevision(body.release.revision);
    if (!result.observedRevision) return { ...result, code: 'RELEASE_UNIDENTIFIED' };
    if (result.observedRevision !== config.expectedRevision) return { ...result, code: 'REVISION_MISMATCH' };
    return { ...result, success: true, code: 'REVISION_MATCH' };
  } finally { clearTimeout(timeout); }
}

export function deploymentSummary(result) {
  // Only allowlisted result fields are emitted, never response bodies/URLs or exceptions.
  return ['## Deployed revision verification', '', `Result: **${result.success ? 'matched' : 'not confirmed'}** (${result.code})`, '',
    `Expected: \`${result.expectedRevision}\``, `Observed: \`${result.observedRevision || 'unidentified'}\``,
    `HTTP: ${result.httpStatus ?? 'unavailable'}`, '',
    'Scope: anonymous runtime response and build revision only. Database, login, provider integrations and business workflows are NOT verified.', ''].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyDeployment({ origin: process.env.HRBP_VERIFY_ORIGIN,
      expectedRevision: process.env.HRBP_EXPECTED_REVISION });
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, deploymentSummary(report));
    if (!report.success) process.exitCode = 1;
  } catch {
    console.error('Deployment verification configuration failed; no request or secret detail is printed.');
    process.exitCode = 1;
  }
}
