import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name];
  });
  return module.exports;
}

for (const [name, statuses, expected] of [
  ['mixed acknowledgement and waiver', ['ACKNOWLEDGED', 'WAIVED'], 50],
  ['only waived assignments', ['WAIVED'], 0]
]) {
  test(`policy metrics: ${name} must not turn exemption into read evidence`, async () => {
    for (const role of ['EMPLOYEE', 'HR_OPERATIONS']) {
      const enums = new Proxy({}, { get: (_target, key) => key });
      let query;
      const model = { id: 'policy-a', code: 'QA', title: 'Synthetic', version: '1', status: 'PUBLISHED',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'), reviewDueAt: null,
        assignments: statuses.map(status => ({ status, dueAt: null })), exceptions: [] };
      const { getPoliciesLiveData } = compile('lib/employee-services-live-data.ts', {
        '@prisma/client': new Proxy({}, { get: () => enums }),
        '@/lib/authorization': { can: ctx => ctx.role === 'HR_OPERATIONS' },
        '@/lib/db': { withDb: fn => fn({ policyRecord: { findMany: async args => { query = args; return [model]; } } }) },
        '@/lib/hr-service-access': {}
      });
      const result = await getPoliciesLiveData({ tenantId: 'tenant-a', actorId: 'actor-a', role, employmentId: 'employment-a' });
      assert.equal(result.acknowledgement, expected); assert.equal(result.rows[0].acknowledged, expected);
      assert.equal(result.pending, 0, 'an exemption is not a pending obligation either');
      assert.equal(query.where.tenantId, 'tenant-a'); assert.equal(query.take, 200);
      if (role === 'EMPLOYEE') assert.deepEqual(query.select.assignments.where, { employmentId: 'employment-a' });
    }
  });
}
