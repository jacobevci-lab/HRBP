import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const definitions = [
  { kind: 'people', capabilities: ['people:read', 'people:write', 'positions:read'], model: 'position', component: 'EmployeeCreateForm', field: 'positions', row: { id: 'private-position', positionCode: 'PRIVATE_CODE', title: 'PRIVATE_TITLE', location: 'PRIVATE_LOCATION', orgUnit: { name: 'PRIVATE_ORG' } } },
  { kind: 'positions', capabilities: ['positions:read', 'positions:write', 'organization:read'], model: 'organizationUnit', component: 'PositionCreateForm', field: 'organizations', row: { id: 'private-org', code: 'PRIVATE_CODE', name: 'PRIVATE_ORG', type: 'DEPARTMENT' } }
];
function fixture(definition, options = {}) {
  const { kind, model, capabilities, component, row } = definition;
  const source = readFileSync(`app/module/${kind}/new/page.tsx`, 'utf8');
  const calls = { auth: 0, db: 0, capabilities: [], queries: [] };
  const ctx = Object.hasOwn(options, 'context') ? options.context : { tenantId: 'verified-tenant-B', actorId: 'verified-user', role: 'HR_OPERATIONS' };
  const granted = new Set(options.granted ?? capabilities);
  const jsx = (type, props) => ({ type, props });
  const db = { [model]: { findMany: async query => {
    calls.queries.push(query);
    if (options.dbError) throw options.dbError;
    return options.rows ?? [row];
  } } };
  const mocks = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'Link' },
    'next/navigation': { redirect: path => { throw Object.assign(new Error('NEXT_REDIRECT'), { path }); } },
    'lucide-react': { ChevronLeft: 'ChevronLeft', ShieldCheck: 'ShieldCheck' },
    '@/components/app-shell': { AppShell: 'AppShell' },
    '@/components/employee-create-form': { EmployeeCreateForm: 'EmployeeCreateForm' },
    '@/components/position-create-form': { PositionCreateForm: 'PositionCreateForm' },
    '@/lib/server-session': { getServerRequestContext: async () => { calls.auth++; if (options.authError) throw options.authError; return ctx; } },
    '@/lib/authorization': { can: (received, capability) => { assert.equal(received, ctx); calls.capabilities.push(capability); return granted.has(capability); } },
    '@/lib/i18n-server': { getServerLocale: async () => options.locale ?? 'en' },
    '@/lib/db': { withDb: async callback => { calls.db++; return callback(db); } },
    // Baseline reproduction only: fixed pages must never import this fallback.
    '@/lib/workspace': { workspaceTenantId: () => 'default-staging-tenant' }
  };
  const compiled = ts.transpileModule(source, { fileName: `page-${kind}.tsx`, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(module, module.exports, name => { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; });
  return { calls, source, render: () => module.exports.default(), component };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const value of Object.values(tree)) {
    if (Array.isArray(value)) { for (const item of value) { const result = find(item, predicate); if (result) return result; } }
    else { const result = find(value, predicate); if (result) return result; }
  }
}
for (const definition of definitions) {
  const { kind, capabilities, component, field } = definition;
  test(`${kind}: anonymous request redirects before business lookup or form props`, async () => {
    const f = fixture(definition, { context: null });
    await assert.rejects(f.render(), error => error.message === 'NEXT_REDIRECT' && error.path === `/auth/sign-in?returnTo=%2Fmodule%2F${kind}%2Fnew`);
    assert.equal(f.calls.auth, 1); assert.equal(f.calls.db, 0); assert.deepEqual(f.calls.queries, []);
  });
  for (const missing of capabilities) test(`${kind}: missing ${missing} denies direct navigation without reading choices`, async () => {
    const f = fixture(definition, { granted: capabilities.filter(c => c !== missing) });
    const tree = await f.render();
    assert.ok(find(tree, n => n.props?.['data-record-create-state'] === 'restricted'));
    assert.equal(find(tree, n => n.type === component), undefined);
    assert.equal(f.calls.auth, 1); assert.equal(f.calls.db, 0);
    assert.doesNotMatch(JSON.stringify(tree), /PRIVATE_/);
  });
  for (const locale of ['en', 'tr']) test(`${kind}: denied screen follows ${locale} locale`, async () => {
    const f = fixture(definition, { granted: [], locale });
    const tree = await f.render();
    assert.ok(JSON.stringify(tree).includes(locale === 'tr' ? 'Erişim kısıtlı' : 'Access is restricted'));
    assert.equal(f.calls.db, 0);
  });
  for (const tenantId of ['verified-tenant-A', 'verified-tenant-B']) test(`${kind}: successful page binds choices to ${tenantId}, never deployment fallback`, async () => {
    const f = fixture(definition, { context: { tenantId, actorId: 'actor', role: 'HR_OPERATIONS' } });
    const tree = await f.render(), form = find(tree, n => n.type === component);
    assert.equal(f.calls.auth, 1); assert.equal(f.calls.db, 1);
    assert.deepEqual(f.calls.capabilities, capabilities);
    assert.equal(f.calls.queries[0].where.tenantId, tenantId);
    assert.equal(f.calls.queries[0].where.validTo, null);
    if (kind === 'people') assert.equal(f.calls.queries[0].where.status, 'OPEN');
    assert.equal(form.props[field].length, 1);
    assert.doesNotMatch(f.source, /workspaceTenantId|DEFAULT_STAGING_TENANT_ID/);
    assert.equal(find(tree, n => n.type === 'Link' && n.props?.href?.startsWith('/auth/sign-in')), undefined);
  });
  test(`${kind}: empty authorized choices stay empty, no synthetic records`, async () => {
    const f = fixture(definition, { rows: [] });
    assert.deepEqual(find(await f.render(), n => n.type === component).props[field], []);
  });
  test(`${kind}: account verification error propagates and never reads choices`, async () => {
    const error = new Error('AUTH_UNAVAILABLE'); const f = fixture(definition, { authError: error });
    await assert.rejects(f.render(), e => e === error); assert.equal(f.calls.db, 0);
  });
  test(`${kind}: business data outage propagates without a successful demo fallback`, async () => {
    const error = new Error('DB_UNAVAILABLE'); const f = fixture(definition, { dbError: error });
    await assert.rejects(f.render(), e => e === error); assert.equal(f.calls.auth, 1); assert.equal(f.calls.db, 1);
  });
}
