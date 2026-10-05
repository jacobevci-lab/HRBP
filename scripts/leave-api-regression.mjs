/** Real HTTP + disposable PostgreSQL. No production targets, fabricated sessions or external providers. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
assert.equal(database.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD, 'Disposable fixture password is required');
const db = new PrismaClient();
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [], failures: [],
  scope: 'Three synthetic roles, real HTTP/Prisma/PostgreSQL; targeted leave workflows, not browser forms or legal/calendar validation' };
await mkdir('.audit', { recursive: true });
async function scenario(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false }); report.failures.push(name); throw error; }
}
async function http(path, { method = 'GET', cookie, body, requestOrigin = origin } = {}) {
  const r = await fetch(origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let payload = null;
  try { payload = JSON.parse(text); } catch { /* Do not log raw server errors or credentials. */ }
  return { status: r.status, payload, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function login(role) {
  const r = await http('/api/auth/local', { method: 'POST', body: { identifier: `audit.${role}`, password: process.env.HRBP_TEST_ADMIN_PASSWORD } });
  assert.equal(r.status, 200, `Fixture login: ${role}`); assert.ok(r.cookie);
  const session = await http('/api/auth/session', { cookie: r.cookie });
  assert.equal(session.payload?.authenticated, true);
  assert.equal(session.payload.user.id, `qa-audit-${role}`);
  return { cookie: r.cookie, ...session.payload.user };
}
try {
  const admin = await login('admin'), employee = await login('employee'), manager = await login('manager');
  assert.ok(employee.employmentId && manager.employmentId && employee.employmentId !== manager.employmentId);
  const tenantId = employee.tenantId;
  assert.equal(admin.tenantId, tenantId); assert.equal(manager.tenantId, tenantId);
  const prefix = `qa-leave-${randomUUID().slice(0, 8)}`;
  const year = new Date().getUTCFullYear() + 2;
  const at = day => new Date(Date.UTC(year, 0, day, 12)).toISOString();
  let typeId, autoTypeId, balanceId, autoBalanceId;
  await scenario('configure tracked leave with valid booleans and exact decimal allowance', async () => {
    const r = await http('/api/leave/types', { method: 'POST', cookie: admin.cookie, body: { code: prefix, name: 'QA tracked leave', unit: 'DAYS', paid: false, requiresApproval: true, annualAllowance: '0.30' } });
    assert.equal(r.status, 201); typeId = r.payload.data.id;
    const row = await db.leaveType.findUniqueOrThrow({ where: { id: typeId } });
    assert.equal(row.paid, false); assert.equal(row.requiresApproval, true); assert.equal(row.annualAllowance.toString(), '0.3');
  });
  await scenario('duplicate code is a controlled conflict and never creates a second type', async () => {
    const r = await http('/api/leave/types', { method: 'POST', cookie: admin.cookie, body: { code: prefix, name: 'QA duplicate' } });
    assert.equal(r.status, 409);
    assert.equal(await db.leaveType.count({ where: { tenantId, code: prefix.toUpperCase() } }), 1);
  });
  await scenario('explicit null allowance remains untracked instead of becoming zero', async () => {
    const r = await http('/api/leave/types', { method: 'POST', cookie: admin.cookie, body: { code: `${prefix}-untracked`, name: 'QA untracked', annualAllowance: null } });
    assert.equal(r.status, 201);
    assert.equal((await db.leaveType.findUniqueOrThrow({ where: { id: r.payload.data.id } })).annualAllowance, null);
  });
  balanceId = (await db.leaveBalance.create({ data: { tenantId, employmentId: employee.employmentId, leaveTypeId: typeId, periodYear: year, opening: '0.30', used: '0.20' } })).id;
  await db.leaveBalance.create({ data: { tenantId, employmentId: manager.employmentId, leaveTypeId: typeId, periodYear: year, opening: '20.00' } });
  const base = { employmentId: employee.employmentId, leaveTypeId: typeId, startsAt: at(10), endsAt: at(10), units: '0.10', reason: 'QA leave lifecycle' };
  const badRequestFields = [
    ['employmentId', {}], ['employmentId', [employee.employmentId]], ['employmentId', 'x'.repeat(192)],
    ['leaveTypeId', {}], ['leaveTypeId', [typeId]],
    ['startsAt', 1], ['startsAt', [at(10)]], ['startsAt', `${year}-02-30`], ['startsAt', `${year}-01-10T12:00:00`],
    ['endsAt', {}], ['endsAt', at(9)],
    ['units', true], ['units', false], ['units', [1]], ['units', {}], ['units', null], ['units', ''],
    ['units', '0x10'], ['units', '1e2'], ['units', 0], ['units', 367], ['units', '0.001'],
    ['reason', {}], ['reason', [1]], ['reason', 4], ['reason', 'x'.repeat(2001)], ['reason', 'nul\u0000byte']
  ];
  for (const [index, [field, value]] of badRequestFields.entries()) await scenario(`invalid request field ${index + 1}: ${field} returns 400`, async () => {
    const r = await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, [field]: value } });
    assert.equal(r.status, 400);
  });
  await scenario('invalid request fields do not persist requests or debit balance', async () => {
    assert.equal(await db.leaveRequest.count({ where: { tenantId, leaveTypeId: typeId } }), 0);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.2');
  });
  for (const [index, [field, value]] of [
    ['code', {}], ['name', []], ['unit', 'INVALID'], ['paid', 'false'], ['paid', null],
    ['requiresApproval', 'false'], ['requiresApproval', []], ['annualAllowance', true],
    ['annualAllowance', [1]], ['annualAllowance', ''], ['annualAllowance', '0.001']
  ].entries()) await scenario(`invalid leave-type field ${index + 1}: ${field} returns 400`, async () => {
    const r = await http('/api/leave/types', { method: 'POST', cookie: admin.cookie, body: { code: `${prefix}-bad`, name: 'QA invalid', [field]: value } });
    assert.equal(r.status, 400);
  });
  for (const query of ['year=', 'year=abc', 'year=Infinity', 'year=2028.5', 'year=0000', `year=${year}&year=${year}`]) await scenario(`invalid balance query rejected: ${query}`, async () => {
    assert.equal((await http(`/api/leave/balances?${query}`, { cookie: employee.cookie })).status, 400);
  });
  await scenario('employee balance listing stays within its employment scope', async () => {
    const r = await http(`/api/leave/balances?year=${year}`, { cookie: employee.cookie });
    assert.equal(r.status, 200); assert.ok(r.payload.data.some(x => x.id === balanceId));
    assert.ok(r.payload.data.every(x => x.employmentId === employee.employmentId));
  });
  await scenario('employee cannot configure leave types or create leave for a colleague', async () => {
    assert.equal((await http('/api/leave/types', { method: 'POST', cookie: employee.cookie, body: { code: `${prefix}-deny`, name: 'Denied' } })).status, 403);
    assert.equal((await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, employmentId: manager.employmentId } })).status, 403);
  });
  await scenario('anonymous and cross-origin writes remain blocked', async () => {
    assert.equal((await http('/api/leave/requests', { method: 'POST', body: base })).status, 401);
    assert.equal((await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, requestOrigin: 'https://other.invalid', body: base })).status, 403);
  });
  let requestId;
  await scenario('employee creates a pending request without debiting balance or accepting forged status/tenant', async () => {
    const r = await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, tenantId: 'other-tenant', status: 'APPROVED', approverId: 'forged' } });
    assert.equal(r.status, 201); requestId = r.payload.data.id;
    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(row.status, 'PENDING'); assert.equal(row.tenantId, tenantId); assert.equal(row.approverId, null);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.2');
  });
  await scenario('authorized approval consumes exactly 0.10 from available 0.30 minus 0.20', async () => {
    const r = await http(`/api/leave/requests/${requestId}/decision`, { method: 'POST', cookie: admin.cookie, body: { decision: 'APPROVED' } });
    assert.equal(r.status, 200);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.3');
    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(row.status, 'APPROVED'); assert.equal(row.approverId, admin.id);
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: requestId, action: 'leave-request.approved' } }), 1);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, resourceId: requestId, eventType: 'LEAVE_REQUEST_APPROVED' } }), 1);
  });
  await scenario('duplicate approval neither debits again nor duplicates audit/notification', async () => {
    const r = await http(`/api/leave/requests/${requestId}/decision`, { method: 'POST', cookie: admin.cookie, body: { decision: 'APPROVED' } });
    assert.equal(r.status, 409);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.3');
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: requestId, action: 'leave-request.approved' } }), 1);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, resourceId: requestId, eventType: 'LEAVE_REQUEST_APPROVED' } }), 1);
  });
  await scenario('insufficient balance blocks approval while rejection leaves balance untouched', async () => {
    const created = await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, startsAt: at(12), endsAt: at(12), units: '0.11' } });
    assert.equal(created.status, 201); const id = created.payload.data.id;
    assert.equal((await http(`/api/leave/requests/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { decision: 'APPROVED' } })).status, 409);
    assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id } })).status, 'PENDING');
    assert.equal((await http(`/api/leave/requests/${id}/decision`, { method: 'POST', cookie: admin.cookie, body: { decision: 'REJECTED' } })).status, 200);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.3');
  });
  await scenario('cancelling pending leave does not refund an undebited quantity', async () => {
    const created = await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, startsAt: at(14), endsAt: at(14) } });
    assert.equal(created.status, 201);
    assert.equal((await http(`/api/leave/requests/${created.payload.data.id}/self-cancel`, { method: 'POST', cookie: employee.cookie })).status, 200);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.3');
  });
  await scenario('cancelling approved leave refunds once and repeated cancellation conflicts', async () => {
    const path = `/api/leave/requests/${requestId}/self-cancel`;
    assert.equal((await http(path, { method: 'POST', cookie: employee.cookie })).status, 200);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.2');
    assert.equal((await http(path, { method: 'POST', cookie: employee.cookie })).status, 409);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balanceId } })).used.toString(), '0.2');
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: requestId, action: 'leave-request.self-cancelled' } }), 1);
  });
  await scenario('manager may request own leave but self-approval is refused', async () => {
    const created = await http('/api/leave/requests', { method: 'POST', cookie: manager.cookie, body: { ...base, employmentId: manager.employmentId, startsAt: at(16), endsAt: at(16) } });
    assert.equal(created.status, 201);
    const r = await http(`/api/leave/requests/${created.payload.data.id}/decision`, { method: 'POST', cookie: manager.cookie, body: { decision: 'APPROVED' } });
    assert.equal(r.status, 403); assert.match(r.payload.error, /Self-approval/);
  });
  await scenario('automatic approval also honors exact fractional balance', async () => {
    const configured = await http('/api/leave/types', { method: 'POST', cookie: admin.cookie, body: { code: `${prefix}-auto`, name: 'QA auto', requiresApproval: false, annualAllowance: '0.30' } });
    assert.equal(configured.status, 201); autoTypeId = configured.payload.data.id;
    autoBalanceId = (await db.leaveBalance.create({ data: { tenantId, employmentId: employee.employmentId, leaveTypeId: autoTypeId, periodYear: year, opening: '0.30', used: '0.20' } })).id;
    const created = await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, leaveTypeId: autoTypeId, startsAt: at(20), endsAt: at(20) } });
    assert.equal(created.status, 201); assert.equal(created.payload.data.status, 'APPROVED');
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: autoBalanceId } })).used.toString(), '0.3');
    assert.equal((await http(`/api/leave/requests/${created.payload.data.id}/self-cancel`, { method: 'POST', cookie: employee.cookie })).status, 200);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: autoBalanceId } })).used.toString(), '0.2');
  });
  await scenario('over-budget auto approval and cross-year tracked leave persist no request', async () => {
    const before = await db.leaveRequest.count({ where: { leaveTypeId: autoTypeId } });
    assert.equal((await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, leaveTypeId: autoTypeId, startsAt: at(22), endsAt: at(22), units: '0.11' } })).status, 409);
    assert.equal((await http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, leaveTypeId: autoTypeId, startsAt: `${year}-12-31`, endsAt: `${year + 1}-01-01` } })).status, 400);
    assert.equal(await db.leaveRequest.count({ where: { leaveTypeId: autoTypeId } }), before);
  });
  await scenario('two concurrent automatic approvals cannot spend the same remaining balance', async () => {
    const responses = await Promise.all([24, 26].map(day => http('/api/leave/requests', { method: 'POST', cookie: employee.cookie, body: { ...base, leaveTypeId: autoTypeId, startsAt: at(day), endsAt: at(day) } })));
    assert.deepEqual(responses.map(x => x.status).sort(), [201, 409]);
    assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: autoBalanceId } })).used.toString(), '0.3');
    const successfulId = responses.find(x => x.status === 201).payload.data.id;
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: successfulId, action: 'leave-request.created-auto-approved' } }), 1);
  });
} finally {
  await db.$disconnect();
  await writeFile('.audit/leave-api-regression.json', JSON.stringify(report, null, 2));
  console.log('LEAVE_API_REGRESSION ' + JSON.stringify({ source: report.source, checks: report.checks.length, failures: report.failures }));
}
assert.deepEqual(report.failures, []);
