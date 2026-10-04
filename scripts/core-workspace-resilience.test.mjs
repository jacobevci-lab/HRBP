/** Execute actual route/component code with isolated identity and data dependencies.
 * This is a fault-injection unit suite, not a real DB/network/browser outage test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const slugs = ['people', 'organization', 'positions', 'employee-360'];
const jsx = (type, props) => ({ type, props: props || {} });
function load(path, mocks = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  }, fileName: path }).outputText;
  const module = { exports: {} };
  const require = name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'next/link') return { __esModule: true, default: 'a' };
    if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => `icon:${String(key)}` });
    if (name === '@/components/app-shell') return { AppShell: 'app-shell' };
    if (name === '@/components/public-core-landing') return { PublicCoreLanding: 'public-preview' };
    if (name === '@/lib/core-workspace-copy') return load('lib/core-workspace-copy.ts');
    if (Object.hasOwn(mocks, name)) {
      const value = mocks[name];
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`Unexpected dependency (including synthetic fallback): ${name}`);
  };
  runInNewContext(code, { module, exports: module.exports, require, ...globals }, { filename: path });
  return module.exports;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'object') return text(tree.props?.children);
  return String(tree);
}
function fixture(slug, { locale = 'en', ctx = { tenantId: 'tenant-test', actorId: 'test-user' },
  capabilities = ['people:read', 'people:write', 'positions:read', 'positions:write', 'organization:read'],
  fail, importFail } = {}) {
  const calls = [];
  const mocks = {
    '@/lib/server-session': { getServerRequestContext: async () => ctx },
    '@/lib/i18n-server': { getServerLocale: async () => locale },
    '@/lib/authorization': { can: (actual, capability) => {
      assert.equal(actual, ctx, 'capability checks must use the resolved identity');
      return capabilities.includes(capability);
    } },
    '@/components/core-hr-live-workspace': importFail || { CoreHRLiveWorkspace: async args => {
      calls.push(JSON.parse(JSON.stringify(args)));
      if (fail) throw fail;
      return jsx('live-workspace', { children: 'Test live record' });
    } }
  };
  return { ...load(`app/module/${slug}/page.tsx`, mocks), calls };
}
for (const slug of slugs) {
  test(`${slug}: unauthenticated preview short-circuits before live data and search input`, async () => {
    const route = fixture(slug, { ctx: null });
    const tree = await route.default({ searchParams: { then() { throw new Error('must not resolve search params before identity'); } } });
    assert.equal(route.calls.length, 0);
    assert.ok(nodes(tree).some(n => n.type === 'public-preview' && n.props.slug === slug));
  });
  test(`${slug}: normal route renders live data, not a preview`, async () => {
    const route = fixture(slug);
    const tree = await route.default({ searchParams: Promise.resolve({}) });
    assert.equal(route.dynamic, 'force-dynamic'); assert.equal(route.revalidate, 0);
    assert.equal(route.calls.length, 1); assert.equal(route.calls[0].slug, slug);
    assert.ok(nodes(tree).some(n => n.type === 'live-workspace'));
    assert.ok(!nodes(tree).some(n => n.type === 'public-preview'));
    assert.ok(!nodes(tree).some(n => n.type === 'button'), 'header status is not a dead button');
  });
  for (const kind of ['data', 'import', 'redirect', 'not-found']) {
    test(`${slug}: ${kind} failure propagates intact instead of mounting synthetic data`, async () => {
      const failure = new Error(`${kind}: SQL=private_person_data token=private_secret`);
      if (kind === 'redirect') failure.digest = 'NEXT_REDIRECT;replace;/auth/sign-in;307;';
      if (kind === 'not-found') failure.digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
      const route = fixture(slug, kind === 'import' ? { importFail: failure } : { fail: failure });
      await assert.rejects(route.default({ searchParams: Promise.resolve({}) }), error => error === failure);
    });
  }
  for (const locale of ['en', 'tr']) {
    test(`${slug}: dedicated page heading uses ${locale} server preference`, async () => {
      const route = fixture(slug, { locale });
      const tree = await route.default({ searchParams: Promise.resolve({}) });
      const copy = load('lib/core-workspace-copy.ts').coreWorkspaceCopy(slug, locale);
      assert.equal(text(nodes(tree).find(n => n.type === 'h1')), copy.title);
      assert.ok(text(tree).includes(copy.description));
    });
  }
  test(`${slug}: real route error boundary is client-side and wired to the shared safe panel`, () => {
    const path = `app/module/${slug}/error.tsx`;
    assert.match(readFileSync(path, 'utf8'), /^"use client"/);
    const boundary = load(path, { '@/components/core-workspace-error': { CoreWorkspaceError: 'error-panel' } });
    const tree = boundary.default({ error: new Error('private'), reset: () => assert.fail('not called on render') });
    assert.equal(tree.type, 'error-panel'); assert.equal(tree.props.slug, slug);
    assert.equal(tree.props.error, undefined);
    const source = readFileSync(`app/module/${slug}/page.tsx`, 'utf8');
    assert.doesNotMatch(source, /@\/components\/core-hr-workspace|@\/lib\/demo-data|catch\s*\(/);
  });
}
for (const slug of ['people', 'positions']) {
  const prefix = slug;
  for (const [read, write] of [[true, true], [true, false], [false, true], [false, false]]) {
    test(`${slug}: create link requires read=${read}, write=${write}`, async () => {
      const capabilities = [...(read ? [`${prefix}:read`] : []), ...(write ? [`${prefix}:write`] : [])];
      const route = fixture(slug, { capabilities });
      const tree = await route.default({ searchParams: Promise.resolve({}) });
      const link = nodes(tree).find(n => n.type === 'a' && n.props.href === `/module/${slug}/new`);
      assert.equal(Boolean(link), read && write);
    });
  }
}
test('People search forwards an exact string, ignores duplicate/array query values', async () => {
  for (const q of ['Ayşe & Ömer', ['Ayşe', 'Ömer'], undefined]) {
    const route = fixture('people');
    await route.default({ searchParams: Promise.resolve({ q }) });
    assert.equal(route.calls[0].query, typeof q === 'string' ? q : '');
  }
});
test('Employee 360 preserves person/tab context and safely encodes its lifecycle link', async () => {
  const person = 'person A&tab=bad/#ö';
  const route = fixture('employee-360');
  const tree = await route.default({ searchParams: Promise.resolve({ person, tab: 'history' }) });
  assert.deepEqual(route.calls, [{ slug: 'employee-360', personId: person, tab: 'history' }]);
  assert.ok(nodes(tree).some(n => n.props.href === `/module/employee-360/lifecycle?person=${encodeURIComponent(person)}`));
  const repeated = fixture('employee-360');
  const repeatedTree = await repeated.default({ searchParams: Promise.resolve({ person: ['a', 'b'], tab: ['x'] }) });
  assert.deepEqual(repeated.calls, [{ slug: 'employee-360' }]);
  assert.ok(!nodes(repeatedTree).some(n => String(n.props.href).includes('/lifecycle')));
});
test('Employee 360 hides lifecycle navigation when people read is unavailable', async () => {
  const route = fixture('employee-360', { capabilities: [] });
  const tree = await route.default({ searchParams: Promise.resolve({ person: 'test-person' }) });
  assert.ok(!nodes(tree).some(n => String(n.props.href).includes('/lifecycle')));
});
function errorFixture(locale) {
  let index = 0, reloads = 0, provided = false;
  const hooks = [];
  const location = { href: 'https://example.invalid/module/people?q=Ay%C5%9Fe#record', reload: () => reloads++ };
  const component = load('components/core-workspace-error.tsx', {
    '@/components/locale-provider': { useLocale: () => {
      assert.equal(provided, true, 'Locale hook must execute beneath AppShell');
      return { locale };
    } },
    react: {
      useRef: initial => { const i = index++; return hooks[i] ??= { current: initial }; },
      useState: initial => { const i = index++; hooks[i] ??= initial; return [hooks[i], value => { hooks[i] = value; }]; }
    }
  }, { window: { location } });
  function resolve(tree) {
    if (Array.isArray(tree)) return tree.map(resolve);
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return resolve(tree.type(tree.props));
    const before = provided;
    if (tree.type === 'app-shell') provided = true;
    try { return { ...tree, props: { ...tree.props, children: resolve(tree.props.children) } }; }
    finally { provided = before; }
  }
  return { location, get reloads() { return reloads; }, render(slug) {
    index = 0;
    return resolve(component.CoreWorkspaceError({ slug, error: new Error('SQL/private-secret'), reset: () => assert.fail('no automatic retry') }));
  } };
}
for (const locale of ['en', 'tr']) for (const slug of slugs) {
  test(`${slug}: ${locale} failure panel has no samples, raw error or mutation surface`, () => {
    const fixture = errorFixture(locale);
    const tree = fixture.render(slug), all = nodes(tree);
    assert.equal(fixture.reloads, 0);
    assert.ok(all.some(n => n.props.role === 'alert'));
    assert.ok(all.some(n => n.props['data-core-workspace-state'] === 'unavailable'));
    assert.equal(text(all.find(n => n.type === 'h1')), locale === 'tr'
      ? `${load('lib/core-workspace-copy.ts').coreWorkspaceCopy(slug, locale).title} şu anda yüklenemiyor`
      : `${load('lib/core-workspace-copy.ts').coreWorkspaceCopy(slug, locale).title} is temporarily unavailable`);
    assert.doesNotMatch(text(tree), /SQL|private-secret|512|548|98\.6/);
    assert.ok(!all.some(n => ['table', 'form', 'input', 'select'].includes(n.type)));
    const links = all.filter(n => n.type === 'a').map(n => n.props.href);
    assert.deepEqual(links, slug === 'employee-360' ? ['/module/people', '/'] : ['/']);
    const button = all.find(n => n.type === 'button');
    assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, false);
  });
}
test('Recovery is one explicit page read, preserves URL, and blocks repeated clicks', () => {
  const fixture = errorFixture('tr');
  const before = fixture.location.href;
  const first = nodes(fixture.render('people')).find(n => n.type === 'button');
  first.props.onClick(); first.props.onClick();
  assert.equal(fixture.reloads, 1); assert.equal(fixture.location.href, before);
  const pending = nodes(fixture.render('people')).find(n => n.type === 'button');
  assert.equal(pending.props.disabled, true); assert.equal(pending.props['aria-busy'], true);
  assert.equal(text(pending), 'Yeniden yükleniyor…');
});
