import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function readReceipts(name = 'export-receipts.jsonl') {
  assert.match(name, /^[a-z0-9-]{1,80}\.jsonl$/);
  const source = await readFile(new URL(`../.audit/${name}`, import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(source) <= 1024 * 1024, 'Receipt evidence too large');
  assert.ok(source.endsWith('\n'), 'Missing or incomplete receipt evidence');
  const rows = source.trimEnd().split('\n').map(line => JSON.parse(line));
  const sequences = new Map();
  for (const row of rows) {
    assert.equal(row.v, 1); assert.ok(Number.isInteger(row.pid) && row.pid > 0);
    assert.equal(row.sequence, (sequences.get(row.pid) ?? -1) + 1, 'Lost, duplicated or reordered receipt');
    sequences.set(row.pid, row.sequence);
    assert.ok(['start', 'request'].includes(row.kind));
    if (row.kind === 'request') {
      assert.ok(['/api/audit/export', '/api/health/runtime'].includes(row.path));
      assert.match(row.targetHash, /^[a-f0-9]{64}$/);
      assert.ok(['GET', 'HEAD', 'POST', 'OTHER'].includes(row.method));
      assert.equal(typeof row.prefetch, 'boolean'); assert.equal(typeof row.rsc, 'boolean');
    }
  }
  return { source, rows };
}
export async function openReceiptWindow(name) {
  const baseline = await readReceipts(name);
  assert.ok(baseline.rows.some(row => row.path === '/api/health/runtime'), 'Observer must see a real health request before testing');
  return async () => {
    const current = await readReceipts(name);
    assert.ok(current.source.startsWith(baseline.source), 'Receipt history was reset during the test');
    return current.rows.slice(baseline.rows.length).filter(row => row.path === '/api/audit/export');
  };
}
export function assertSingleExport(receipts, target) {
  const url = new URL(target);
  assert.equal(receipts.length, 1, 'An explicit download must reach the server exactly once');
  assert.equal(receipts[0].method, 'GET');
  assert.equal(receipts[0].prefetch, false, 'Export must not be prefetched');
  assert.equal(receipts[0].rsc, false, 'Export must not be requested as an RSC page');
  assert.equal(receipts[0].targetHash, createHash('sha256').update(url.pathname + url.search).digest('hex'), 'The received export must preserve all requested filters');
}
