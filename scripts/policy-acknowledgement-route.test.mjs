import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const path = 'app/api/policies/[id]/acknowledgements/route.ts';
const NOW = new Date('2027-01-10T12:00:00.000Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW.getTime(); } }
class KnownError extends Error { constructor(code) { super('private database detail'); this.code = code; } }
const enumOf = values => Object.fromEntries(values.map(value => [value, value]));
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('lte' in value) return row[key] != null && row[key] <= value.lte;
      if ('gte' in value) return row[key] != null && row[key] >= value.gte;
    }
    return row[key] === value;
  });
}
function receipt(overrides = {}) { return { id: 'receipt-a', tenantId: 'tenant-a', policyId: 'policy-a', employmentId: 'employment-a', policyVersion: '1.0', acknowledgedBy: 'original-actor', acknowledgedAt: new Date('2027-01-01T12:00:00Z'), ipAddress: '192.0.2.10', ...overrides }; }
function harness(options = {}) {
  let state = {
    policies: [{ id: 'policy-a', tenantId: 'tenant-a', version: '1.0', status: 'PUBLISHED', effectiveFrom: new Date('2026-01-01Z'), effectiveTo: null, ...options.policy }],
    employments: [{ id: 'employment-a', tenantId: 'tenant-a', status: 'ACTIVE', ...options.employment }],
    assignments: options.noAssignment ? [] : [{ id: 'assignment-a', tenantId: 'tenant-a', policyId: 'policy-a', employmentId: 'employment-a', status: 'PENDING', ...options.assignment }],
    receipts: options.receipts ?? [], audits: []
  };
  const calls = { transactions: 0, writes: [], locks: [] };
  const ctx = options.anonymous ? null : { tenantId: 'tenant-a', actorId: 'actor-a', employmentId: 'employment-a', ipAddress: '192.0.2.20', ...options.ctx };
  function model(key) {
    return {
      findFirst: async ({ where }) => structuredClone(state[key].find(row => matches(row, where)) ?? null),
      findMany: async ({ where }) => structuredClone(state[key].filter(row => matches(row, where))),
      create: async ({ data }) => {
        calls.writes.push([key, 'create']);
        if (options.createError) throw new KnownError(options.createError);
        const row = { id: 'receipt-new', acknowledgedAt: new Date(NOW), ...data }; state[key].push(row); return structuredClone(row);
      },
      update: async ({ where, data }) => {
        calls.writes.push([key, 'update']);
        const row = state[key].find(row => matches(row, where)); if (!row) throw new KnownError('P2025');
        Object.assign(row, data); return structuredClone(row);
      },
      upsert: async ({ where, update, create }) => {
        const row = state[key].find(row => matches(row, where.policyId_employmentId_policyVersion));
        if (!row) return model(key).create({ data: create });
        calls.writes.push([key, 'upsert-update']); Object.assign(row, update); return structuredClone(row);
      }
    };
  }
  const tx = {
    policyRecord: model('policies'), employment: model('employments'), policyAssignment: model('assignments'), policyAcknowledgement: model('receipts'),
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?'); calls.locks.push({ sql, values });
      if (options.lockError) throw new KnownError(options.lockError);
      return [{ id: 'locked-fixture' }]; // SQL behavior is verified separately on real PostgreSQL.
    }
  };
  const mocks = {
    '@prisma/client': { DataClassification: enumOf(['CONFIDENTIAL']), EmploymentStatus: enumOf(['ACTIVE', 'TERMINATED']), PolicyStatus: enumOf(['PUBLISHED']), PolicyAssignmentStatus: enumOf(['PENDING', 'OVERDUE', 'ACKNOWLEDGED', 'WAIVED']), Prisma: { PrismaClientKnownRequestError: KnownError, TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } },
    '@/lib/db': { db: { $transaction: async run => { calls.transactions++; const old = structuredClone(state); try { return await run(tx); } catch (error) { state = old; throw error; } } } },
    '@/lib/authorization': { can: () => options.allowed !== false, forbidden: () => Response.json({ error: 'Denied.' }, { status: 403 }) },
    '@/lib/audit': { appendAudit: async (_tx, _ctx, event) => { if (options.auditError) throw Error('private audit detail'); state.audits.push(event); } },
    '@/lib/input-validation': { asIdentifier: value => typeof value === 'string' && value.trim() && value.trim().length <= 191 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null },
    '@/lib/request-context': { getRequestContext: async () => ctx, mutationOriginAllowed: () => options.origin !== false, unauthorized: () => Response.json({ error: 'Unauthorized.' }, { status: 401 }) }
  };
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'Date', js)(module, module.exports, name => { assert.ok(name in mocks, name); return mocks[name]; }, Clock);
  return { calls, get state() { return state; }, async post(id = 'policy-a') {
    const response = await module.exports.POST(new Request('https://hrbp.example/api/policies/' + id + '/acknowledgements', { method: 'POST' }), { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() };
  } };
}

for (const [name, options, expected] of [
  ['anonymous', { anonymous: true }, 401], ['cross origin', { origin: false }, 403],
  ['missing capability', { allowed: false }, 403], ['no trusted employment', { ctx: { employmentId: undefined } }, 403]
]) test(`ack: ${name} stops before a database transaction`, async () => {
  const h = harness(options); assert.equal((await h.post()).status, expected); assert.equal(h.calls.transactions, 0);
});
for (const id of ['', 'x'.repeat(192), 'bad\u0000id']) test(`ack: invalid identifier ${JSON.stringify(id.slice(0, 15))} stops before transaction`, async () => {
  const h = harness(); assert.equal((await h.post(id)).status, 400); assert.equal(h.calls.transactions, 0);
});
for (const [name, options] of [
  ['unassigned policy', { noAssignment: true }],
  ['assignment for another employment', { assignment: { employmentId: 'employment-other' } }],
  ['assignment in another tenant', { assignment: { tenantId: 'tenant-other' } }],
  ['policy in another tenant', { policy: { tenantId: 'tenant-other' } }],
  ['employment in another tenant', { employment: { tenantId: 'tenant-other' } }],
  ['terminated employment', { employment: { status: 'TERMINATED' } }],
  ['future effective policy', { policy: { effectiveFrom: new Date(NOW.getTime() + 1) } }],
  ['expired policy', { policy: { effectiveTo: new Date(NOW.getTime() - 1) } }],
  ['draft policy', { policy: { status: 'DRAFT' } }],
  ['retired policy', { policy: { status: 'RETIRED' } }]
]) test(`ack: ${name} cannot create a receipt or mutate an assignment`, async () => {
  const h = harness(options); const before = structuredClone(h.state);
  assert.equal((await h.post()).status, 404); assert.deepEqual(h.state, before); assert.equal(h.calls.writes.length, 0);
});
for (const [name, options] of [
  ['waived assignment', { assignment: { status: 'WAIVED' } }],
  ['waived assignment with historic receipt', { assignment: { status: 'WAIVED' }, receipts: [receipt()] }],
  ['acknowledged status without receipt', { assignment: { status: 'ACKNOWLEDGED' } }],
  ['pending status with historic receipt', { receipts: [receipt()] }],
  ['acknowledged status with only an older-version receipt', { assignment: { status: 'ACKNOWLEDGED' }, receipts: [receipt({ policyVersion: '0.9' })] }],
  ['unknown assignment status', { assignment: { status: 'UNKNOWN' } }]
]) test(`ack: ${name} fails closed without fabricating read evidence`, async () => {
  const h = harness(options); const before = structuredClone(h.state);
  assert.equal((await h.post()).status, 409); assert.deepEqual(h.state, before); assert.equal(h.calls.writes.length, 0);
});
for (const status of ['PENDING', 'OVERDUE']) test(`ack: ${status} creates one receipt and one audit in the transaction`, async () => {
  const h = harness({ assignment: { status } }); const result = await h.post();
  assert.equal(result.status, 201); assert.equal(result.body.meta.replayed, false);
  assert.equal(result.body.data.policyId, 'policy-a'); assert.equal(result.body.data.policyVersion, '1.0');
  assert.equal(result.body.data.employmentId, 'employment-a'); assert.equal(result.body.data.acknowledgedBy, 'actor-a');
  assert.equal(h.state.assignments[0].status, 'ACKNOWLEDGED'); assert.equal(h.state.receipts.length, 1); assert.equal(h.state.audits.length, 1);
  assert.equal(h.state.audits[0].resourceId, result.body.data.id);
});
test('ack: replay preserves the original actor, timestamp and IP without a second audit', async () => {
  const h = harness({ assignment: { status: 'ACKNOWLEDGED' }, receipts: [receipt()] }); const before = structuredClone(h.state);
  const result = await h.post(); assert.equal(result.status, 201); assert.equal(result.body.meta.replayed, true);
  assert.equal(result.body.data.acknowledgedAt, before.receipts[0].acknowledgedAt.toISOString());
  assert.equal(result.body.data.acknowledgedBy, 'original-actor'); assert.equal(result.body.data.ipAddress, '192.0.2.10');
  assert.deepEqual(h.state, before); assert.equal(h.calls.writes.length, 0);
});
test('ack: effective date endpoints remain inclusive like the policy read model', async () => {
  const h = harness({ policy: { effectiveFrom: NOW, effectiveTo: NOW } }); assert.equal((await h.post()).status, 201);
});
test('ack: audit failure rolls back both the receipt and assignment change', async () => {
  const h = harness({ auditError: true }); const before = structuredClone(h.state);
  const result = await h.post(); assert.equal(result.status, 503); assert.deepEqual(h.state, before); assert.doesNotMatch(JSON.stringify(result.body), /private/);
});
for (const code of ['P2002', 'P2025', 'P2034']) test(`ack: ${code} returns bounded conflict feedback and rolls back`, async () => {
  const h = harness({ createError: code }); const before = structuredClone(h.state);
  const result = await h.post(); assert.equal(result.status, 409); assert.deepEqual(h.state, before); assert.doesNotMatch(JSON.stringify(result.body), /private/);
});
test('ack: database outage is not exposed as a successful acknowledgement', async () => {
  const h = harness({ lockError: 'P1001' }); const before = structuredClone(h.state);
  const result = await h.post(); assert.equal(result.status, 503); assert.deepEqual(h.state, before); assert.doesNotMatch(JSON.stringify(result.body), /private/);
});
test('ack: row-lock parameters remain tenant scoped and parent locks precede assignment lock', async () => {
  const h = harness(); await h.post(); const locks = h.calls.locks;
  assert.equal(locks.length, 3); assert.match(locks[0].sql, /"Employment"[\s\S]*FOR SHARE/);
  assert.match(locks[1].sql, /"PolicyRecord"[\s\S]*FOR SHARE/); assert.match(locks[2].sql, /"PolicyAssignment"[\s\S]*FOR UPDATE/);
  for (const lock of locks) { assert.ok(lock.values.includes('tenant-a')); assert.doesNotMatch(lock.sql, /\b(?:tenant-a|policy-a|employment-a)\b/); }
});
