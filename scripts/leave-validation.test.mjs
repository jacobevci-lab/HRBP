/** Executes the real parser and API route modules; identity and DB are instrumented fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

class KnownError extends Error { constructor(code) { super('bounded fixture error'); this.code = code; } }
const prisma = {
  LeaveUnit: { DAYS: 'DAYS', HOURS: 'HOURS' },
  LeaveRequestStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', TAKEN: 'TAKEN' },
  DataClassification: { INTERNAL: 'INTERNAL', CONFIDENTIAL: 'CONFIDENTIAL' },
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' }, PrismaClientKnownRequestError: KnownError }
};
function load(file, mocks = {}) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  }, fileName: file }).outputText;
  const module = { exports: {} };
  const require = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === '@prisma/client') return prisma;
    if (['@/lib/input-validation', '@/lib/leave-input', '@/lib/leave-balance-amount'].includes(name)) return load(name.replace('@/', '') + '.ts', mocks);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  runInNewContext(js, { module, exports: module.exports, require, Date, Error, RangeError, Request, Response, URL, URLSearchParams, TextDecoder });
  return module.exports;
}
const { asLeaveDate, parseLeaveRequest, parseLeaveType, parseLeaveBalanceYear } = load('lib/leave-input.ts');
const { hasAvailableLeaveBalance } = load('lib/leave-balance-amount.ts');
const requestBody = { employmentId: 'employment-test', leaveTypeId: 'type-test', startsAt: '2028-02-28', endsAt: '2028-02-29', units: '0.10', reason: 'İzin talebi' };
const typeBody = { code: 'annual', name: 'Yıllık izin', annualAllowance: '20.50' };
const badRequestFields = [
  ['employmentId', {}], ['employmentId', ['employment-test']], ['employmentId', true], ['employmentId', 12], ['employmentId', ''], ['employmentId', 'x'.repeat(192)], ['employmentId', 'id\u0000'],
  ['leaveTypeId', {}], ['leaveTypeId', ['type-test']], ['leaveTypeId', false], ['leaveTypeId', 'x'.repeat(192)],
  ['startsAt', 1], ['startsAt', true], ['startsAt', ['2028-02-28']], ['startsAt', {}], ['startsAt', '2028-02-30'],
  ['endsAt', '2028-02-27'], ['endsAt', '2028-03-01T12:00:00'], ['endsAt', '03/01/2028'],
  ['units', true], ['units', false], ['units', [1]], ['units', {}], ['units', null], ['units', ''], ['units', '0x10'], ['units', '1e2'],
  ['units', -1], ['units', 0], ['units', 367], ['units', 0.001], ['units', '0.009'], ['units', 'Infinity'],
  ['reason', {}], ['reason', [1]], ['reason', true], ['reason', 1], ['reason', 'x'.repeat(2001)], ['reason', 'nul\u0000byte']
];
const badTypeFields = [
  ['code', {}], ['code', true], ['code', ['x']], ['code', ''], ['code', 'x'.repeat(41)], ['code', 'a\u0000b'],
  ['name', {}], ['name', 1], ['name', []], ['name', 'x'.repeat(161)], ['name', 'line\nbreak'],
  ['unit', 'BOGUS'], ['unit', null], ['unit', {}], ['unit', ['DAYS']],
  ['paid', 'false'], ['paid', 0], ['paid', null], ['paid', {}],
  ['requiresApproval', 'false'], ['requiresApproval', 1], ['requiresApproval', []],
  ['annualAllowance', true], ['annualAllowance', [20]], ['annualAllowance', {}], ['annualAllowance', ''],
  ['annualAllowance', -1], ['annualAllowance', 3661], ['annualAllowance', '0.001'], ['annualAllowance', '0x14']
];
const badYears = ['', 'abc', 'NaN', 'Infinity', '2028.5', '2e3', '10000', '-1', '0000', ' 2028', '2028&year=2028'];

function fixture(options = {}) {
  const calls = [], audit = [], notifications = [];
  const ctx = options.anonymous ? null : { tenantId: 'tenant-test', actorId: 'actor-test', employmentId: 'employment-test' };
  const balance = options.balance ?? { id: 'balance-test', opening: '0.30', accrued: '0', adjustment: '0', used: '0.20' };
  const current = { id: 'request-test', employmentId: 'employment-other', leaveTypeId: 'type-test', startsAt: new Date('2028-02-28'), endsAt: new Date('2028-02-29'), units: '0.10', status: 'PENDING', leaveType: { name: 'Test', annualAllowance: 20 } };
  function record(name, result) { return async args => { calls.push({ name, args }); return typeof result === 'function' ? result(args) : result; }; }
  const tx = {
    employment: { findFirst: record('employment.read', { id: 'employment-test', managerEmploymentId: 'manager-test', person: { givenName: 'Synthetic', familyName: 'Person' } }) },
    leaveType: { findFirst: record('type.read', { id: 'type-test', name: 'Test', requiresApproval: !options.autoApprove, annualAllowance: 20 }),
      create: record('type.create', args => { if (options.unique) throw new KnownError('P2002'); return { id: 'type-test', ...args.data }; }) },
    leaveRequest: { findFirst: record('request.read', options.decision ? current : options.overlap ? { id: 'overlap' } : null),
      create: record('request.create', args => ({ id: 'request-test', ...args.data })),
      updateMany: record('request.update', { count: 1 }), findUnique: record('request.updated', { ...current, status: 'APPROVED' }) },
    leaveBalance: { findUnique: record('balance.read', balance), update: record('balance.update', {}), findMany: record('balances.list', []) }
  };
  const db = { ...tx, $transaction: async (fn, config) => { calls.push({ name: 'transaction', config }); return fn(tx); } };
  const mocks = {
    '@/lib/db': { db },
    '@/lib/authorization': { can: (_ctx, capability) => !options.denied && !(options.noSelf && capability === 'leave:self-request'), forbidden: error => Response.json({ error: error ?? 'Denied' }, { status: 403 }) },
    '@/lib/request-context': { getRequestContext: async () => ctx, mutationOriginAllowed: () => !options.crossOrigin, unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    '@/lib/audit': { appendAudit: async (actualTx, actualCtx, event) => { assert.equal(actualTx, tx); assert.equal(actualCtx, ctx); audit.push(event); } },
    '@/lib/employment-scope': { resolveEmploymentScope: async () => ({ mode: 'test' }), canActOnEmployment: () => !options.outOfScope, employmentIdFilter: () => ({ employmentId: { in: ['employment-test'] } }) },
    '@/lib/leave-notifications': { enqueueLeaveApprovalNotification: async (actualTx, event) => { assert.equal(actualTx, tx); notifications.push(event); }, enqueueLeaveDecisionNotification: async (_tx, event) => notifications.push(event) },
    '@/lib/work-pay-state': { canTransitionLeave: () => true }
  };
  const route = name => load(`app/api/leave/${name}/route.ts`, mocks);
  const req = (body, raw) => new Request('https://hrbp.example/api/leave/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  return { calls, audit, notifications, route, req };
}

for (const [index, [field, value]] of badRequestFields.entries()) test(`request invalid field ${index + 1}: ${field} rejected before DB`, async () => {
  const f = fixture(); const response = await f.route('requests').POST(f.req({ ...requestBody, [field]: value }));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0); assert.equal(f.audit.length, 0);
});
for (const [index, [field, value]] of badTypeFields.entries()) test(`leave type invalid field ${index + 1}: ${field} rejected before DB`, async () => {
  const f = fixture(); const response = await f.route('types').POST(f.req({ ...typeBody, [field]: value }));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});
for (const year of badYears) test(`balance rejects invalid/ambiguous year: ${year}`, async () => {
  const f = fixture(); const response = await f.route('balances').GET(new Request(`https://hrbp.example/api/leave/balances?year=${year}`));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});
for (const input of ['2027-02-29', '2028-02-30', '1900-02-29', '2028-04-31', '2028-00-01', '2028-13-01', '2028-01-00', '2028-02-28T24:00:00Z', '2028-02-28T12:60:00Z', '2028-02-28T12:00:60Z', '2028-02-28T12:00:00+24:00', '2028-02-28T12:00:00+03:60', '0000-01-01']) {
  test(`impossible date never silently normalizes: ${input}`, () => assert.equal(asLeaveDate(input), null));
}
test('leap dates, date-only and explicitly zoned instants retain their exact meaning', () => {
  for (const value of ['2000-02-29', '2028-02-29', '2028-02-28T12:30:00.123Z', '2028-02-28T15:30:00.123+03:00', '2028-02-28T07:30:00.123-05:00']) assert.equal(asLeaveDate(value)?.getTime(), new Date(value).getTime());
});
test('equal instants with different offsets compare as equal', () => {
  assert.equal(parseLeaveRequest({ ...requestBody, startsAt: '2028-02-28T12:00:00Z', endsAt: '2028-02-28T15:00:00+03:00' }).ok, true);
});
test('valid defaults, false flags, zero allowance and null untracked allowance are distinct', () => {
  for (const value of [undefined, null, 0, '0', '3660.00']) {
    const parsed = parseLeaveType({ ...typeBody, annualAllowance: value, paid: false, requiresApproval: false });
    assert.equal(parsed.ok, true); assert.equal(parsed.value.paid, false); assert.equal(parsed.value.requiresApproval, false);
    assert.equal(parsed.value.annualAllowance, value == null ? null : Number(value));
  }
  assert.equal(parseLeaveType({ code: ' a ', name: ' Name ' }).value.unit, 'DAYS');
  assert.equal(parseLeaveType({ code: 'a', name: 'Name', unit: 'HOURS' }).ok, true);
});
test('reason is optional bounded text; normalization never truncates identifiers', () => {
  for (const reason of [undefined, null, '', '  ']) assert.equal(parseLeaveRequest({ ...requestBody, reason }).value.reason, null);
  const result = parseLeaveRequest({ ...requestBody, employmentId: ' employment-test ', reason: ' line\none ' });
  assert.equal(result.value.employmentId, 'employment-test'); assert.equal(result.value.reason, 'line\none');
});
test('four-digit years use UTC default and never become zero via empty coercion', () => {
  const now = new Date('2028-01-01T00:00:00Z');
  assert.equal(parseLeaveBalanceYear(new URLSearchParams(), now), 2028);
  assert.equal(parseLeaveBalanceYear(new URLSearchParams('year=0001')), 1);
  assert.equal(parseLeaveBalanceYear(new URLSearchParams('year=9999')), 9999);
});
test('fractional balance exactly covers a hundredth-denominated request', () => {
  assert.ok(0.30 - 0.20 < 0.10, 'negative control demonstrates the former binary subtraction error');
  const balance = { opening: '0.30', accrued: '0', adjustment: '0', used: '0.20' };
  assert.equal(hasAvailableLeaveBalance(balance, '0.10'), true);
  assert.equal(hasAvailableLeaveBalance(balance, '0.11'), false);
  assert.equal(hasAvailableLeaveBalance({ ...balance, adjustment: '-0.01' }, '0.10'), false);
  assert.equal(hasAvailableLeaveBalance({ ...balance, accrued: '0.01', adjustment: '-0.01' }, '0.10'), true);
});
test('all one-cent boundary combinations agree with integer accounting', () => {
  for (let opening = 1; opening <= 100; opening++) for (let used = 0; used < opening; used++) {
    const balance = { opening: (opening / 100).toFixed(2), accrued: '0', adjustment: '0', used: (used / 100).toFixed(2) };
    assert.equal(hasAvailableLeaveBalance(balance, ((opening - used) / 100).toFixed(2)), true);
    assert.equal(hasAvailableLeaveBalance(balance, ((opening - used + 1) / 100).toFixed(2)), false);
  }
});
test('unexpected stored precision fails rather than rounding balance silently', () => {
  assert.throws(() => hasAvailableLeaveBalance({ opening: '0.001', accrued: '0', adjustment: '0', used: '0' }, '0.01'), RangeError);
});
for (const name of ['requests', 'types']) for (const [options, expected] of [[{ anonymous: true }, 401], [{ crossOrigin: true }, 403], [{ denied: true }, 403]]) {
  test(`${name}: authentication/origin/capability ${JSON.stringify(options)} remains enforced`, async () => {
    const f = fixture(options); const r = await f.route(name).POST(f.req(name === 'types' ? typeBody : requestBody));
    assert.equal(r.status, expected); assert.equal(f.calls.length, 0);
  });
}
for (const raw of ['null', '[]', '{']) test(`bounded object guard remains active: ${raw}`, async () => {
  const f = fixture(); assert.equal((await f.route('requests').POST(f.req(null, raw))).status, 400); assert.equal(f.calls.length, 0);
});
test('pending creation preserves transaction, tenant mapping, audit and manager notification', async () => {
  const f = fixture(); const r = await f.route('requests').POST(f.req({ ...requestBody, tenantId: 'attacker', status: 'APPROVED', approverId: 'attacker' }));
  assert.equal(r.status, 201);
  const { data } = await r.json(); assert.equal(data.tenantId, 'tenant-test'); assert.equal(data.status, 'PENDING'); assert.equal(data.approverId, null);
  assert.equal(f.calls[0].config.isolationLevel, 'Serializable'); assert.equal(f.audit[0].action, 'leave-request.created'); assert.equal(f.notifications.length, 1);
});
test('automatic approval uses exact balance comparison and debits only once', async () => {
  const f = fixture({ autoApprove: true }); const r = await f.route('requests').POST(f.req(requestBody));
  assert.equal(r.status, 201); assert.equal((await r.json()).data.status, 'APPROVED');
  assert.equal(f.calls.filter(x => x.name === 'balance.update').length, 1); assert.equal(f.notifications.length, 0);
});
test('manual approval uses the same exact comparison and preserves audit/notification', async () => {
  const f = fixture({ decision: true }); const r = await f.route('requests/[id]/decision').POST(f.req({ decision: 'APPROVED' }), { params: Promise.resolve({ id: 'request-test' }) });
  assert.equal(r.status, 200); assert.equal(f.calls.filter(x => x.name === 'balance.update').length, 1);
  assert.equal(f.audit[0].action, 'leave-request.approved'); assert.equal(f.notifications.length, 1);
});
test('duplicate leave-type code uses P2002, not human exception message matching', async () => {
  const f = fixture({ unique: true }); const r = await f.route('types').POST(f.req(typeBody)); assert.equal(r.status, 409);
});
test('balance listing retains tenant and relationship constraints', async () => {
  const f = fixture(); const r = await f.route('balances').GET(new Request('https://hrbp.example/api/leave/balances?year=2028'));
  assert.equal(r.status, 200); const where = f.calls[0].args.where;
  assert.equal(where.tenantId, 'tenant-test'); assert.equal(where.periodYear, 2028); assert.equal(where.employmentId.in[0], 'employment-test');
});
