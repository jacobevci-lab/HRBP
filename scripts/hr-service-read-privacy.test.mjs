/** Read-boundary tests execute real GET handlers with isolated database doubles.
 * Current roles use the real capability table; hypothetical future grants are
 * labelled separately and do not assert that those roles have access today. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const values = text => Object.fromEntries(text.split(' ').map(v => [v, v]));
const roles = values('EMPLOYEE MANAGER HRBP HR_OPERATIONS TENANT_ADMIN LEGAL SECURITY_AUDITOR RECRUITER PRIVACY_OFFICER ER_INVESTIGATOR TIME_ADMIN TALENT_ADMIN COMPENSATION_ADMIN PAYROLL_ADMIN');
const enums = { PlatformRole: roles, DataClassification: values('PUBLIC INTERNAL CONFIDENTIAL RESTRICTED HIGHLY_RESTRICTED'),
  ServiceVisibility: values('REQUESTOR PRIVATE_NOTE'), ServicePriority: values('LOW MEDIUM HIGH CRITICAL'),
  ServiceRequestStatus: values('OPEN TRIAGE IN_PROGRESS WAITING_EMPLOYEE WAITING_THIRD_PARTY RESOLVED CLOSED CANCELLED'),
  Prisma: { TransactionIsolationLevel: { RepeatableRead: 'RepeatableRead' } } };
function load(path, mocks) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const m = { exports: {} };
  new Function('module', 'exports', 'require', output.outputText)(m, m.exports, name => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name];
  }); return m.exports;
}
const authorization = load('lib/authorization.ts', { '@prisma/client': enums });
const inputs = load('lib/input-validation.ts', {});
const revision = load('lib/hr-service-revision.ts', {});
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => matches(row, part))
    : key === 'OR' ? value.some(part => matches(row, part))
    : value && typeof value === 'object' && !(value instanceof Date) ? value.in?.includes(row[key]) === true
    : value instanceof Date ? +row[key] === +value : row[key] === value);
}
function ordered(rows, orderBy) {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const c of clauses) for (const [key, direction] of Object.entries(c ?? {})) {
      const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (comparison) return direction === 'asc' ? comparison : -comparison;
    } return 0;
  });
}
function harness(kind, { role = 'EMPLOYEE', visible = true, fail = false, grantForFutureRole = false } = {}) {
  const ctx = role ? { actorId: 'reader-a', tenantId: 'tenant-a', role } : null;
  const time = new Date('2026-10-16T01:00:00.000Z');
  const ticket = { id: 'ticket-a', requestorId: 'reader-a', tenantId: 'tenant-a', createdAt: time, updatedAt: time };
  const row = (id, visibility, tenantId = 'tenant-a', requestId = 'ticket-a') => ({
    id, visibility, tenantId, requestId, authorId: 'staff-a', body: id, createdAt: time
  });
  const rows = [row('public', 'REQUESTOR'), row('hidden-private', 'PRIVATE_NOTE'),
    row('foreign-tenant', 'REQUESTOR', 'tenant-b'), row('other-request', 'REQUESTOR', 'tenant-a', 'ticket-b')];
  const calls = [];
  const db = {
    hRServiceRequest: {
      findFirst: async ({ where }) => { calls.push('request'); if (fail) throw new Error('PRIVATE_DATABASE_ERROR'); return visible && matches(ticket, where) ? ticket : null; },
      findMany: async options => {
        calls.push('requests'); if (fail) throw new Error('PRIVATE_DATABASE_ERROR');
        if (!visible || !matches(ticket, options.where)) return [];
        assert.equal(options.take, 300);
        const relation = options.include._count.select.comments;
        const count = rows.filter(r => r.requestId === ticket.id && (relation === true || matches(r, relation.where))).length;
        return [{ ...ticket, _count: { comments: count } }];
      }
    },
    hRServiceComment: { findMany: async options => {
      calls.push('comments'); if (fail) throw new Error('PRIVATE_DATABASE_ERROR'); assert.equal(options.take, 300);
      return ordered(rows.filter(r => matches(r, options.where)), options.orderBy).slice(0, options.take);
    } },
    $transaction: async (fn, options) => { calls.push('transaction'); assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(db); }
  };
  const noWrites = () => { throw new Error('Read attempted a business mutation'); };
  const mocks = { '@prisma/client': enums, 'node:crypto': { randomUUID }, '@/lib/db': { db },
    '@/lib/authorization': { ...authorization, can: (c, cap) => grantForFutureRole || authorization.can(c, cap) },
    '@/lib/hr-service-access': { hrServiceRequestWhere: async (_client, c) => ({ tenantId: c.tenantId, ...(['EMPLOYEE','MANAGER'].includes(c.role) ? { requestorId: c.actorId } : {}) }),
      isHRServiceSelfServiceRole: r => ['EMPLOYEE','MANAGER'].includes(r),
      isHRServiceStaffRole: r => ['HRBP','HR_OPERATIONS','TENANT_ADMIN'].includes(r) },
    '@/lib/input-validation': inputs, '@/lib/hr-service-revision': revision,
    '@/lib/employment-scope': {}, '@/lib/notification-outbox': { enqueueNotificationOutbox: noWrites }, '@/lib/audit': { appendAudit: noWrites },
    '@/lib/request-context': { getRequestContext: async () => ctx, unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) } };
  const path = kind === 'list' ? 'app/api/hr-service/requests/route.ts' : 'app/api/hr-service/requests/[id]/comments/route.ts';
  const handler = load(path, mocks).GET;
  return { rows, calls, ticket, async read(id = 'ticket-a') {
    const response = await handler(new Request('http://localhost/api/hr-service/requests' + (kind === 'list' ? '' : '/' + encodeURIComponent(id) + '/comments')), { params: Promise.resolve({ id }) });
    return { response, body: await response.json() };
  } };
}
function privateHeaders(response) {
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
  assert.match(response.headers.get('vary') ?? '', /Cookie/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
for (const role of ['EMPLOYEE','MANAGER','HRBP','HR_OPERATIONS','TENANT_ADMIN']) {
  test(`list: ${role} count excludes foreign tenant rows and only includes visible comments`, async () => {
    const h = harness('list', { role }), { response, body } = await h.read();
    assert.equal(response.status, 200);
    assert.equal(body.data[0]._count.comments, ['EMPLOYEE','MANAGER'].includes(role) ? 1 : 2);
    assert.ok(!JSON.stringify(body).includes('hidden-private'));
  });
  test(`legacy GET: ${role} retains authorized rows and original response shape`, async () => {
    const h = harness('comments', { role }), { response, body } = await h.read();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.map(r => r.id).sort(), ['EMPLOYEE','MANAGER'].includes(role) ? ['public'] : ['hidden-private','public']);
    assert.ok(body.data.every(r => r.tenantId === 'tenant-a' && r.requestId === 'ticket-a' && r.authorId === 'staff-a'));
    assert.equal(body.data[0].createdAt, '2026-10-16T01:00:00.000Z');
  });
}
test('list: adding a private note does not change the employee-visible count', async () => {
  const h = harness('list'); const before = (await h.read()).body.data[0]._count.comments;
  h.rows.push({ ...h.rows[1], id: 'second-private' });
  assert.equal((await h.read()).body.data[0]._count.comments, before);
});
for (const kind of ['list','comments']) {
  test(`${kind}: successful read is private and non-cacheable`, async () => privateHeaders((await harness(kind).read()).response));
  for (const role of [null,'LEGAL','SECURITY_AUDITOR']) test(`${kind}: ${role ?? 'anonymous'} is denied by current real grants before data access`, async () => {
    const h = harness(kind, { role }), { response } = await h.read();
    assert.equal(response.status, role ? 403 : 401); assert.equal(h.calls.length, 0); privateHeaders(response);
  });
  test(`${kind}: database failure gives bounded non-cacheable error rather than employee data`, async () => {
    const { response, body } = await harness(kind, { fail: true }).read();
    assert.equal(response.status, 503); assert.equal(body.data, undefined); assert.ok(!JSON.stringify(body).includes('PRIVATE_DATABASE')); privateHeaders(response);
  });
  test(`${kind}: hypothetical future read-only grant cannot authorize private notes`, async () => {
    const h = harness(kind, { role: 'LEGAL', grantForFutureRole: true }), { body } = await h.read();
    assert.equal(kind === 'list' ? body.data[0]._count.comments : body.data.length, 1);
    assert.ok(!JSON.stringify(body).includes('hidden-private'));
  });
}
for (const [id, status] of [['ticket-foreign',404],['bad\u0000id',400]]) test(`legacy GET: invalid or absent ${status} response remains non-cacheable`, async () => {
  const h = harness('comments'), { response } = await h.read(id); assert.equal(response.status, status); privateHeaders(response);
  assert.ok(!h.calls.includes('comments'));
});
test('legacy GET: scope authorization and comment read share one repeatable-read snapshot', async () => {
  const h = harness('comments'); await h.read(); assert.deepEqual(h.calls, ['transaction','request','comments']);
});
test('legacy GET: first 300 tied rows are deterministic, with no unbounded replacement', async () => {
  const h = harness('comments'); const template = h.rows[0];
  h.rows.splice(0, h.rows.length, ...Array.from({ length: 305 }, (_, i) => ({ ...template, id: `row-${String(304-i).padStart(3,'0')}` })));
  const { body } = await h.read(); assert.equal(body.data.length, 300);
  assert.deepEqual(body.data.map(r => r.id), Array.from({ length:300 }, (_,i) => `row-${String(i).padStart(3,'0')}`));
});
