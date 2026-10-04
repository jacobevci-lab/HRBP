'use strict';
// Test-only passive HTTP receipts. Never loaded by the deployed application.
const assert = require('node:assert/strict');
const http = require('node:http');
const { appendFileSync, mkdirSync, statSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true', 'HTTP observation requires a disposable audit');
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const name = process.env.HRBP_AUDIT_RECEIPTS || 'export-receipts.jsonl';
assert.match(name, /^[a-z0-9-]{1,80}\.jsonl$/);
mkdirSync('.audit', { recursive: true });
const file = resolve('.audit', name);
let size = existsSync(file) ? statSync(file).size : 0;
let sequence = 0;
function record(data) {
  const line = JSON.stringify({ v: 1, pid: process.pid, sequence: sequence++, ...data }) + '\n';
  size += Buffer.byteLength(line);
  assert.ok(size <= 1024 * 1024, 'Audit receipts exceeded their evidence budget');
  appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
}
const original = http.Server.prototype.emit;
record({ kind: 'start' });
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const request = args[0];
    const target = typeof request.url === 'string' ? request.url : '';
    const pathname = target.split('?')[0];
    if (pathname === '/api/audit/export' || pathname === '/api/health/runtime') {
      assert.ok(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.localAddress), 'Only loopback listeners may be observed');
      assert.ok(target.length <= 8192, 'Unexpected audit request target length');
      record({ kind: 'request', path: pathname,
        method: ['GET', 'HEAD', 'POST'].includes(request.method) ? request.method : 'OTHER',
        targetHash: createHash('sha256').update(target).digest('hex'),
        prefetch: request.headers['next-router-prefetch'] !== undefined || /prefetch/i.test(String(request.headers.purpose || request.headers['sec-purpose'] || '')),
        rsc: request.headers.rsc !== undefined });
    }
  }
  // Do not consume the body, change a header, suppress a request or modify a response.
  return Reflect.apply(original, this, [event, ...args]);
};
