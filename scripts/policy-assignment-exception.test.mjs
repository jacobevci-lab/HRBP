import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const paths = { assign: 'assignments/route.ts', request: 'exceptions/route.ts', decision: 'exceptions/[exceptionId]/decision/route.ts' };
const root = process.env.HRBP_POLICY_TEST_SOURCE || '.';
const enums = values => Object.fromEntries(values.split(' ').map(v => [v, v]));
const start = Date.parse('2027-01-01T12:00:00Z');
class KnownError extends Error { constructor(code) { super('PRIVATE_DATABASE_DETAIL'); this.code = code; } }
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'AND') return value.every(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('gte' in value) return row[key] !== null && row[key] >= value.gte;
    }
    return row[key] === value;
  });
}
function harness(kind, options = {}) {
  let now = start;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  let state = {
    policies: [{ id: 'policy-a', tenantId: 'tenant-a', status: 'PUBLISHED', ...options.policy }],
    employees: [{ id: 'employee-a', tenantId: 'tenant-a', status: 'ACTIVE', ...options.employee }],
    assignments: options.assignments ?? [{ id: 'assignment-a', tenantId: 'tenant-a', policyId: 'policy-a', employmentId: 'employee-a', status: 'PENDING', dueAt: new Date(start + 86400000) }],
    exceptions: options.exceptions ?? (kind === 'decision' ? [{ id: 'exception-a', tenantId: 'tenant-a', policyId: 'policy-a', employmentId: 'employee-a', requestedById: 'requester-a', status: 'REQUESTED', active: false, expiresAt: null }] : []),
    audits: []
  };
  const calls = { locks: [], writes: 0, transactions: 0, scopes: 0, isolation: null };
  function model(key) {
    return {
      findFirst: async ({ where }) => structuredClone(state[key].find(row => matches(row, where)) ?? null),
      findMany: async ({ where }) => structuredClone(state[key].filter(row => matches(row, where))),
      create: async ({ data }) => { calls.writes++; if (options.writeError) throw new KnownError(options.writeError); const row = { id: 'exception-new', ...data }; state[key].push(row); return structuredClone(row); },
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true); if (options.writeError) throw new KnownError(options.writeError);
        let count = 0;
        for (const row of data) {
          if (state[key].some(x => x.policyId === row.policyId && x.employmentId === row.employmentId)) continue;
          state[key].push({ id: `assignment-${count}`, ...row }); count++; calls.writes++;
        }
        return { count };
      },
      update: async ({ where, data }) => {
        calls.writes++; if (options.writeError) throw new KnownError(options.writeError);
        const row = state[key].find(row => matches(row, where)); if (!row) throw new KnownError('P2025');
        Object.assign(row, data); return structuredClone(row);
      }
    };
  }
  const tx = { policyRecord: model('policies'), employment: model('employees'), policyAssignment: model('assignments'), policyException: model('exceptions'),
    $queryRaw: async (strings, ...values) => {
      assert.ok(Array.isArray(strings.raw), 'SQL must be parameter bound'); calls.locks.push({ sql: strings.join('?'), values });
      if (options.lockError) throw new KnownError(options.lockError);
      options.afterLock?.(state, calls.locks.length);
      if (options.advanceAfterLock) now = start + options.advanceAfterLock;
      return [{ id: 'locked' }]; // Lock engine and waiting are exercised in the PostgreSQL gate.
    }
  };
  const ctx = options.anonymous ? null : { tenantId: 'tenant-a', actorId: 'actor-a', employmentId: 'employee-a', ...options.ctx };
  const asIdentifier = (value, max = 191) => typeof value === 'string' && value.trim() && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
  const asText = (v, n) => typeof v === 'string' && v.trim() && v.trim().length <= n ? v.trim() : null;
  const mocks = {
    '@prisma/client': { DataClassification: enums('INTERNAL CONFIDENTIAL'), EmploymentStatus: enums('ACTIVE TERMINATED'), PolicyStatus: enums('PUBLISHED'), PolicyAssignmentStatus: enums('PENDING ACKNOWLEDGED OVERDUE WAIVED'), PolicyExceptionStatus: enums('REQUESTED APPROVED REJECTED REVOKED EXPIRED'), Prisma: { PrismaClientKnownRequestError: KnownError, TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' }, join: ids => ({ values: ids }) } },
    '@/lib/db': { db: { $transaction: async (fn, config) => { calls.transactions++; calls.isolation = config?.isolationLevel; const before = structuredClone(state); try { return await fn(tx); } catch (e) { state = before; throw e; } } } },
    '@/lib/audit': { appendAudit: async (_tx, _ctx, entry) => { if (options.auditError) throw Error('PRIVATE_AUDIT_DETAIL'); state.audits.push(entry); } },
    '@/lib/authorization': { can: (_ctx, permission) => options.denied !== permission && (kind !== 'request' || options.manage !== false || permission === 'policies:read'), forbidden: () => Response.json({ error: 'denied' }, { status: 403 }) },
    '@/lib/employment-scope': { resolveEmploymentScope: async () => { calls.scopes++; return options.scope ?? null; }, canActOnEmployment: (scope, id) => scope === null || scope.includes(id) },
    '@/lib/request-context': { getRequestContext: async () => ctx, mutationOriginAllowed: () => options.origin !== false, unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }) },
    '@/lib/input-validation': { asIdentifier, asText, asOptionalText: (v, n) => v === undefined || v === null || v === '' ? undefined : asText(v, n), asEnumValue: (v, allowed) => typeof v === 'string' && allowed.includes(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null,
      readJsonObject: async req => { try { const value = await req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } } }
  };
  const path = `app/api/policies/[id]/${paths[kind]}`;
  const js = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'Date', js)(module, module.exports, name => { assert.ok(name in mocks, name); return mocks[name]; }, Clock);
  return { calls, get state() { return state; }, async post(body, params = {}) {
    const response = await module.exports.POST(new Request('https://hrbp.example/api/policies/policy-a/' + paths[kind], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'policy-a', exceptionId: 'exception-a', ...params }) });
    return { status: response.status, body: await response.json() };
  } };
}
const bodies = { assign: { employmentIds: ['employee-a'] }, request: { employmentId: 'employee-a', reason: 'Synthetic request' }, decision: { decision: 'APPROVE' } };
for (const kind of Object.keys(paths)) {
  for (const [label, options, status] of [['anonymous', { anonymous: true }, 401], ['foreign origin', { origin: false }, 403], ['missing capability', { denied: kind === 'assign' ? 'policies:write' : kind === 'request' ? 'policies:read' : 'policies:approve' }, 403]]) {
    test(`${kind}: ${label} never starts transaction`, async () => { const h = harness(kind, options); assert.equal((await h.post(bodies[kind])).status, status); assert.equal(h.calls.transactions, 0); });
  }
  test(`${kind}: a failed audit rolls back the domain mutation with bounded feedback`, async () => {
    const h = harness(kind, { auditError: true, assignments: kind === 'assign' ? [] : undefined }); const before = structuredClone(h.state);
    const result = await h.post(bodies[kind]); assert.equal(result.status, 503); assert.deepEqual(h.state, before); assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
  });
  test(`${kind}: database lock failure cannot produce success or leak details`, async () => {
    const h = harness(kind, { lockError: 'P1001' }); const result = await h.post(bodies[kind]); assert.equal(result.status, 503); assert.equal(h.calls.writes, 0); assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
  });
}
for (const dueAt of [123, true, {}, [], 'not-date']) test(`assignment: invalid dueAt ${JSON.stringify(dueAt)} is rejected before writes`, async () => {
  const h = harness('assign', { assignments: [] }); assert.equal((await h.post({ ...bodies.assign, dueAt })).status, 400); assert.equal(h.calls.transactions, 0);
});
for (const employmentIds of [[], ['employee-a', 'employee-a'], ['bad\u0000id'], [123], Array.from({length:501}, (_,i)=>`e-${i}`)]) test(`assignment: invalid/bounded IDs (${employmentIds.length}) cannot write`, async () => {
  const h = harness('assign'); assert.equal((await h.post({ employmentIds })).status, 400); assert.equal(h.calls.writes, 0);
});
test('assignment: invalid policy identity never reaches transaction', async () => { const h = harness('assign'); assert.equal((await h.post(bodies.assign, { id: 'bad\u0000id' })).status, 400); assert.equal(h.calls.transactions, 0); });
for (const status of ['ACKNOWLEDGED', 'WAIVED', 'PENDING', 'OVERDUE']) test(`assignment: existing ${status} and due date survive replay without a new creation audit`, async () => {
  const h = harness('assign'); h.state.assignments[0].status = status; const before = structuredClone(h.state);
  const result = await h.post({ ...bodies.assign, dueAt: '2027-02-01T00:00:00Z' }); assert.equal(result.status, 201); assert.deepEqual(result.body.data, { assigned: 0, requested: 1, skippedExisting: 1 }); assert.deepEqual(h.state, before);
});
test('assignment: actual inserted count, first audit and second no-op match', async () => {
  const h = harness('assign', { assignments: [] }); const first = await h.post(bodies.assign); const second = await h.post(bodies.assign);
  assert.equal(first.body.data.assigned, 1); assert.equal(second.body.data.assigned, 0); assert.equal(h.state.assignments.length, 1); assert.equal(h.state.audits.length, 1);
});
test('assignment: denied relationship scope cannot acquire business locks', async () => {
  const h = harness('assign', { scope: [] }); assert.equal((await h.post(bodies.assign)).status, 403); assert.equal(h.calls.locks.length, 0); assert.equal(h.calls.writes, 0);
});
for (const [kind, label, change, expected] of [
  ['assign','terminated subject', s=>{s.employees[0].status='TERMINATED';},400],
  ['assign','retired policy', s=>{s.policies[0].status='RETIRED';},404],
  ['request','terminated subject', s=>{s.employees[0].status='TERMINATED';},400],
  ['request','retired policy', s=>{s.policies[0].status='RETIRED';},404],
  ['request','existing competing request', s=>{s.exceptions=[{id:'other',tenantId:'tenant-a',policyId:'policy-a',employmentId:'employee-a',status:'REQUESTED',expiresAt:null}];},409],
  ['decision','changed expiry', s=>{s.exceptions[0].expiresAt=new Date(start-1);},409],
  ['decision','changed requester', s=>{s.exceptions[0].requestedById='actor-a';},403]
]) test(`${kind}: ${label} is read after the lock boundary`, async () => {
  const h = harness(kind, { assignments: kind === 'assign' ? [] : undefined, afterLock: change });
  assert.equal((await h.post(bodies[kind])).status, expected); assert.equal(h.calls.writes, 0); assert.equal(h.calls.isolation, 'ReadCommitted');
});
test('request: self-service ignores supplied employment and still requires assignment', async () => {
  const h = harness('request', { manage: false }); const result = await h.post({ ...bodies.request, employmentId: 'other' }); assert.equal(result.status, 201); assert.equal(result.body.data.employmentId, 'employee-a');
  const no = harness('request', { manage: false, assignments: [] }); assert.equal((await no.post(bodies.request)).status, 403);
});
for (const kind of ['assign','request']) test(`${kind}: time limit is rechecked after waiting`, async () => {
  const h = harness(kind, { assignments: kind === 'assign' ? [] : undefined, advanceAfterLock: 2000 });
  const body = { ...bodies[kind], [kind === 'assign' ? 'dueAt' : 'expiresAt']: new Date(start+1000).toISOString() };
  assert.equal((await h.post(body)).status, 409); assert.equal(h.calls.writes, 0);
});
for (const decision of ['APPROVE','REJECT']) test(`decision: requester cannot ${decision} its own request`, async () => {
  const h = harness('decision', { ctx:{actorId:'requester-a'} }); assert.equal((await h.post({decision})).status,403); assert.equal(h.calls.writes,0);
});
test('decision: approve then revoke preserves original approver and assignments', async () => {
  const h = harness('decision'); const assignments = structuredClone(h.state.assignments);
  assert.equal((await h.post({decision:'APPROVE'})).status,200); assert.equal((await h.post({decision:'REVOKE'})).status,200);
  assert.equal(h.state.exceptions[0].status,'REVOKED'); assert.equal(h.state.exceptions[0].approvedById,'actor-a'); assert.deepEqual(h.state.assignments,assignments);
  assert.deepEqual(h.state.audits.map(x=>x.action),['policy.exception-approved','policy.exception-revoked']);
});
test('locks: ordered parameter binding preserves tenant isolation, including sorted batches', async () => {
  const a=harness('assign'); a.state.employees.push({id:'employee-z',tenantId:'tenant-a',status:'ACTIVE'});
  await a.post({employmentIds:['employee-z','employee-a']});
  assert.match(a.calls.locks[0].sql,/ORDER BY "id" FOR SHARE/); assert.deepEqual(a.calls.locks[0].values[1].values,['employee-a','employee-z']);
  const e=harness('request',{manage:false});await e.post(bodies.request);assert.match(e.calls.locks[0].sql,/"Employment"[\s\S]*FOR UPDATE/);assert.match(e.calls.locks[2].sql,/"PolicyAssignment"/);
  const d=harness('decision');await d.post(bodies.decision);assert.match(d.calls.locks[0].sql,/"PolicyException"[\s\S]*FOR UPDATE/);
  for(const h of [a,e,d]) for(const l of h.calls.locks) {assert.ok(l.values.includes('tenant-a'));assert.doesNotMatch(l.sql,/\b(?:tenant-a|employee-a|policy-a)\b/);}
});
