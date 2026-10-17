/** Real legacy read/count acceptance. Synthetic localhost fixtures only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
const origin = 'http://localhost:3100', database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/hr-service-read-privacy'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Real API, signed synthetic sessions, production Next.js and disposable PostgreSQL through Chromium request contexts.',
  limitations: ['API/read acceptance, not new UI click coverage.', 'No production data or provider calls.', 'Legacy read is capped at 300; use conversation pages for more history.'] };
const db = new PrismaClient(), browser = await chromium.launch(), contexts = [], ticketIds = [];
const marker = 'qareads-' + randomUUID().slice(0, 8), selfId = marker + '-self', staffId = marker + '-staff', peerId = marker + '-peer';
let tenantId, foreignTenant, sequence = 0;
async function context(id) {
  const ctx = await browser.newContext(); contexts.push(ctx);
  if (id) assert.equal((await ctx.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: id, password } })).status(), 200);
  return ctx;
}
async function fixture(status = 'IN_PROGRESS', otherTenant = false) {
  const record = await db.hRServiceRequest.create({ data: { tenantId: otherTenant ? foreignTenant : tenantId,
    requestNumber: marker + '-' + (++sequence), requestorId: selfId, category: 'QA',
    title: 'Synthetic legacy reads', description: 'Synthetic only', status, priority: 'MEDIUM' } });
  ticketIds.push(record.id); return record;
}
async function add(ticket, body, visibility = 'REQUESTOR', extra = {}) {
  return db.hRServiceComment.create({ data: { tenantId: ticket.tenantId, requestId: ticket.id, authorId: staffId, body, visibility, ...extra } });
}
async function check(name, _page, fn) {
  const row = { name, passed: false };
  try { Object.assign(row, await fn(), { passed: true }); }
  catch (error) { row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 700); }
  report.tests.push(row); console.log('READ_PRIVACY_SCENARIO ' + JSON.stringify(row));
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
}
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  tenantId = template.tenantId; assert.ok(template.localPasswordHash);
  foreignTenant = marker + '-tenant';
  await db.tenant.create({ data: { id: foreignTenant, name: 'Synthetic legacy isolation', region: 'QA' } });
  for (const [id, role] of [[selfId, 'EMPLOYEE'], [peerId, 'EMPLOYEE'], [staffId, 'HR_OPERATIONS']]) {
    await db.userAccount.create({ data: { id, tenantId, subject: id, email: id + '@example.test',
      displayName: 'Synthetic ' + role, role, active: true, localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  }
  const self = await context(selfId), staff = await context(staffId), peer = await context(peerId), anonymous = await context(null);
  const sp = null, tied = new Date('2026-01-01T12:00:00.000Z');
  // Compatibility read acceptance uses its own synthetic records, preserving
  // all existing conversation fixtures and assertions below.
  const legacyTicket = await fixture();
  await add(legacyTicket, 'Legacy public ' + marker);
  await add(legacyTicket, 'Legacy private ' + marker, 'PRIVATE_NOTE');
  const legacyPath = t => `/api/hr-service/requests/${t.id}/comments`;
  const assertPrivateRead = response => {
    assert.match(response.headers()['cache-control'] || '', /private.*no-store/);
    assert.match(response.headers().vary || '', /Cookie/);
    assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  };
  async function listed(ctx, id) {
    const res = await ctx.request.get(origin + '/api/hr-service/requests');
    assert.equal(res.status(), 200); assertPrivateRead(res);
    const body = await res.json(); assert.ok(Array.isArray(body.data));
    return body.data.find(row => row.id === id);
  }
  await check('legacy list: employee counts public replies only; staff counts visible public and private messages', sp, async () => {
    assert.equal((await listed(self, legacyTicket.id))._count.comments, 1);
    assert.equal((await listed(staff, legacyTicket.id))._count.comments, 2);
    assert.equal(await listed(peer, legacyTicket.id), undefined);
  });
  await check('legacy list: adding a private note does not expose its existence through the employee count', sp, async () => {
    const before = (await listed(self, legacyTicket.id))._count.comments;
    await add(legacyTicket, 'Second legacy private ' + marker, 'PRIVATE_NOTE');
    assert.equal((await listed(self, legacyTicket.id))._count.comments, before);
    assert.equal((await listed(staff, legacyTicket.id))._count.comments, 3);
  });
  await check('legacy list: an inconsistent cross-tenant comment cannot contaminate visible counts', sp, async () => {
    // This legacy schema has no composite tenant/request foreign key. Deliberate
    // fixture corruption must not broaden the count's tenant predicate.
    await add(legacyTicket, 'Foreign legacy row ' + marker, 'REQUESTOR', { tenantId: foreignTenant });
    assert.equal((await listed(self, legacyTicket.id))._count.comments, 1);
    assert.equal((await listed(staff, legacyTicket.id))._count.comments, 3);
  });
  await check('legacy comments: original envelope and fields are retained with scoped private visibility and no read writes', sp, async () => {
    const before = await db.hRServiceRequest.findUniqueOrThrow({ where: { id: legacyTicket.id } });
    const auditCount = await db.auditEvent.count({ where: { tenantId, resourceId: legacyTicket.id } });
    for (const [ctx, expected] of [[self, 1], [staff, 3]]) {
      const res = await ctx.request.get(origin + legacyPath(legacyTicket));
      assert.equal(res.status(), 200); assertPrivateRead(res);
      const data = (await res.json()).data; assert.equal(data.length, expected);
      assert.ok(data.every(row => row.tenantId === tenantId && row.requestId === legacyTicket.id && row.authorId === staffId));
      assert.ok(data.every(row => typeof row.id === 'string' && typeof row.body === 'string' && typeof row.createdAt === 'string'));
      if (ctx === self) assert.ok(data.every(row => row.visibility === 'REQUESTOR'));
    }
    assert.deepEqual(await db.hRServiceRequest.findUniqueOrThrow({ where: { id: legacyTicket.id } }), before);
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: legacyTicket.id } }), auditCount);
  });
  await check('legacy reads: anonymous, invalid, foreign and out-of-scope requests have non-cacheable denials', sp, async () => {
    const foreign = await fixture('CLOSED', true);
    for (const [ctx, url, status] of [
      [anonymous, '/api/hr-service/requests', 401], [anonymous, legacyPath(legacyTicket), 401],
      [peer, legacyPath(legacyTicket), 404], [self, '/api/hr-service/requests/bad%00id/comments', 400],
      [self, legacyPath(foreign), 404], [staff, legacyPath(foreign), 404]
    ]) {
      const res = await ctx.request.get(origin + url); assert.equal(res.status(), status); assertPrivateRead(res);
      assert.equal((await res.json()).data, undefined);
    }
    assert.equal(await listed(self, foreign.id), undefined);
    assert.equal(await listed(staff, foreign.id), undefined);
  });
  await check('legacy comments: equal timestamps return a deterministic bounded 300-row window without changing totals', sp, async () => {
    const t = await fixture();
    const ids = Array.from({ length: 305 }, (_, i) => marker + '-legacy-' + String(i).padStart(3, '0'));
    await db.hRServiceComment.createMany({ data: [...ids].reverse().map(id => ({ id, tenantId, requestId: t.id,
      authorId: staffId, body: 'Synthetic bounded history', visibility: 'REQUESTOR', createdAt: tied })) });
    await add(t, 'Legacy private outside the public count', 'PRIVATE_NOTE');
    for (let i = 0; i < 2; i++) {
      const res = await self.request.get(origin + legacyPath(t)); assert.equal(res.status(), 200); assertPrivateRead(res);
      assert.deepEqual((await res.json()).data.map(row => row.id), ids.slice(0, 300));
    }
    assert.equal((await listed(self, t.id))._count.comments, 305);
    assert.equal((await listed(staff, t.id))._count.comments, 306);
  });
} finally {
  await Promise.all(contexts.map(ctx => ctx.close().catch(() => {}))); await browser.close();
  if (ticketIds.length) {
    await db.hRServiceComment.deleteMany({ where: { requestId: { in: ticketIds }, tenantId: { in: [tenantId, foreignTenant].filter(Boolean) } } }).catch(() => {});
    await db.hRServiceRequest.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {});
  }
  await db.userAccount.deleteMany({ where: { id: { in: [selfId, staffId, peerId] }, tenantId } }).catch(() => {});
  if (foreignTenant) await db.tenant.deleteMany({ where: { id: foreignTenant } }).catch(() => {});
  await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2)); console.log('READ_PRIVACY_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 6 || report.tests.some(t => !t.passed)) process.exitCode = 1;
