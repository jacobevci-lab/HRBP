/** Actual TS dispatcher/boundary code, isolated dependencies. Not a database outage test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

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
    if (name === '@/components/public-module-landing') return { PublicModuleLanding: 'public-preview' };
    if (name === '@/lib/navigation') return load('lib/navigation.ts');
    if (Object.hasOwn(mocks, name)) {
      const value = mocks[name];
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`Unexpected dependency (including demo fallback): ${name}`);
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
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const registry = [
  ['core-hr-live-workspace','CoreHRLiveWorkspace',['people','organization','positions','employee-360']],
  ['governance-live-workspace','GovernanceLiveWorkspace',['documents','audit']],
  ['compensation-live-workspace','CompensationLiveWorkspace',['compensation']],
  ['employee-services-live-workspace','EmployeeServicesLiveWorkspace',['employee-relations','hr-service','policies','workflows']],
  ['recruiting-workspace','RecruitingWorkspace',['recruiting','onboarding']],
  ['offboarding-workspace','OffboardingWorkspace',['offboarding']]
];
function fixture({ ctx = { tenantId: 'qa-tenant', actorId: 'qa-user' }, locale = 'en', denied = [], fail, importFail, empty = false } = {}) {
  const calls = [];
  const mocks = {
    '@/lib/server-session': { getServerRequestContext: async () => ctx },
    '@/lib/i18n-server': { getServerLocale: async () => locale },
    '@/lib/i18n': { translate: (selected, key) => `${selected}:${key}` },
    '@/lib/authorization': { can: (actual, capability) => {
      assert.equal(actual, ctx); return !denied.includes(capability);
    } }
  };
  for (const [file, symbol] of registry) mocks[`@/components/${file}`] = importFail || {
    [symbol]: async args => {
      calls.push({ symbol, args });
      if (fail) throw fail;
      return empty ? null : jsx('live-data', { children: 'Actual test data' });
    }
  };
  return { ...load('components/module-landing.tsx', mocks), calls };
}
for (const [, symbol, slugs] of registry) for (const slug of slugs) {
  test(`${slug}: calls only the existing live implementation`, async () => {
    const route = fixture();
    const tree = await route.ModuleLanding({ slug, query: 'filter & Ö', personId: 'person-a', tab: 'history' });
    assert.equal(route.calls.length, 1); assert.equal(route.calls[0].symbol, symbol);
    assert.ok(nodes(tree).some(n => n.type === 'live-data'));
    assert.ok(!nodes(tree).some(n => n.type === 'public-preview' || n.type === 'button' || n.type === 'input'));
    if (symbol === 'EmployeeServicesLiveWorkspace') assert.equal(route.calls[0].args.focusId, 'filter & Ö');
    if (symbol === 'GovernanceLiveWorkspace') assert.equal(route.calls[0].args.query, 'filter & Ö');
    if (symbol === 'CoreHRLiveWorkspace') assert.deepEqual(JSON.parse(JSON.stringify(route.calls[0].args)), {slug,query:'filter & Ö',personId:'person-a',tab:'history'});
    if (symbol === 'RecruitingWorkspace') assert.equal(route.calls[0].args.slug, slug);
  });
  for (const kind of ['data', 'import', 'redirect', 'not-found']) {
    test(`${slug}: ${kind} failure is not hidden behind sample data`, async () => {
      const failure = new Error('private SQL and credentials must never be displayed');
      if (kind === 'redirect') failure.digest = 'NEXT_REDIRECT;replace;/auth/sign-in;307;';
      if (kind === 'not-found') failure.digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
      const route = fixture(kind === 'import' ? {importFail:failure} : {fail:failure});
      await assert.rejects(route.ModuleLanding({slug}), actual => actual === failure);
    });
  }
}
test('Anonymous dispatch short-circuits before any live dependency', async () => {
  for (const slug of registry.flatMap(([, , slugs]) => slugs)) {
    const route = fixture({ctx:null,importFail:new Error('live import must not run')});
    const tree = await route.ModuleLanding({slug});
    assert.equal(tree.type,'public-preview'); assert.equal(tree.props.slug,slug); assert.equal(route.calls.length,0);
  }
});
test('Denied roles see no live loader, records, mutation or live-success label', async () => {
  const entries = load('lib/navigation.ts').navigation.flatMap(group=>group.items);
  for (const slug of registry.flatMap(([, , slugs]) => slugs)) {
    const capability = slug === 'workflows' ? 'workflows:read' : entries.find(item=>item.slug===slug).requiredCapability;
    const route = fixture({denied:[capability],importFail:new Error('unauthorized loader must not run')});
    const tree = await route.ModuleLanding({slug});
    assert.equal(tree.props['data-module-workspace-state'],'restricted'); assert.equal(route.calls.length,0);
    assert.ok(!nodes(tree).some(n=>n.type==='a'||n.type==='live-data'));
    assert.ok(!text(tree).includes('Live data view'));
  }
});
for (const slug of ['people','positions']) test(`${slug}: create navigation requires write capability`, async () => {
  const denied=fixture({denied:[`${slug}:write`]});
  assert.ok(!nodes(await denied.ModuleLanding({slug})).some(n=>n.props.href===`/module/${slug}/new`));
  const allowed=fixture();
  assert.ok(nodes(await allowed.ModuleLanding({slug})).some(n=>n.props.href===`/module/${slug}/new`));
});
test('Unsupported dispatch and empty live result are explicit failures, not success placeholders', async () => {
  for(const slug of ['not-a-module','__proto__','constructor','learning']) {
    const route=fixture();
    await assert.rejects(route.ModuleLanding({slug}), /Unsupported live workspace/);
    assert.equal(route.calls.length,0);
  }
  await assert.rejects(fixture({empty:true}).ModuleLanding({slug:'documents'}), /no content/);
});
test('Known module metadata follows the resolved locale and preserves focus routing', async () => {
  for(const locale of ['en','tr']) {
    const route=fixture({locale});
    const tree=await route.ModuleLanding({slug:'policies',query:'policy-123',tab:'review'});
    assert.equal(text(nodes(tree).find(n=>n.type==='h1')),`${locale}:nav.policies`);
    assert.equal(route.calls[0].args.focusId,'policy-123'); assert.equal(route.calls[0].args.mode,'review');
  }
});
test('Generic route layout keeps catalog entries, rejects unknowns and canonicalizes dashboard', async () => {
  const missing=new Error('not-found'), redirect=new Error('redirect'); let target;
  const layout=load('app/module/[slug]/layout.tsx',{'next/navigation':{notFound(){throw missing;},redirect(path){target=path;throw redirect;}}});
  const children=jsx('children',{});
  for(const slug of [...load('lib/navigation.ts').navigation.flatMap(g=>g.items.map(i=>i.slug)).filter(s=>s!=='dashboard'),'notifications']) {
    assert.equal(await layout.default({params:Promise.resolve({slug}),children}),children);
  }
  for(const slug of ['unknown','__proto__','constructor','documents-no','Documents','']) {
    await assert.rejects(layout.default({params:Promise.resolve({slug}),children}),e=>e===missing);
  }
  await assert.rejects(layout.default({params:Promise.resolve({slug:'dashboard'}),children}),e=>e===redirect); assert.equal(target,'/');
});
test('Generic error boundary passes no raw error object into its recovery screen', () => {
  const boundary=load('app/module/[slug]/error.tsx',{'@/components/module-workspace-error':{ModuleWorkspaceError:'panel'}});
  const tree=boundary.default({error:new Error('private'),reset(){assert.fail('not used');}});
  assert.equal(tree.type,'panel'); assert.deepEqual(Object.keys(tree.props),[]);
});
for(const locale of ['en','tr']) test(`Recovery in ${locale} renders no data/write controls and reloads only on explicit click`, () => {
  let index=0,reloads=0,provided=false;const hooks=[];
  const location={href:'https://example.invalid/module/hr-service?request=a#detail',reload:()=>reloads++};
  const component=load('components/module-workspace-error.tsx',{
    '@/components/locale-provider':{useLocale:()=>{assert.equal(provided,true,'Locale hook must execute beneath AppShell');return {locale};}},
    react:{useRef(initial){const i=index++;return hooks[i]??={current:initial};},useState(initial){const i=index++;hooks[i]??=initial;return[hooks[i],v=>{hooks[i]=v;}];}}
  },{window:{location}});
  function resolve(tree) {
    if(Array.isArray(tree))return tree.map(resolve);
    if(!tree||typeof tree!=='object')return tree;
    if(typeof tree.type==='function')return resolve(tree.type(tree.props));
    const before=provided;if(tree.type==='app-shell')provided=true;
    try{return {...tree,props:{...tree.props,children:resolve(tree.props.children)}};}finally{provided=before;}
  }
  const render=()=>{index=0;return resolve(component.ModuleWorkspaceError({error:new Error('private_sql')}));};
  const tree=render(),all=nodes(tree); assert.equal(reloads,0);
  assert.ok(all.some(n=>n.props['data-module-workspace-state']==='unavailable')); assert.ok(all.some(n=>n.props.role==='alert'));
  assert.doesNotMatch(text(tree),/private_sql|512|98\.6/);
  assert.ok(!all.some(n=>['table','form','input','select'].includes(n.type)));
  assert.deepEqual(all.filter(n=>n.type==='a').map(n=>n.props.href),['/']);
  const button=all.find(n=>n.type==='button');assert.equal(button.props.type,'button');
  const before=location.href;button.props.onClick();button.props.onClick();assert.equal(reloads,1);assert.equal(location.href,before);
  assert.equal(nodes(render()).find(n=>n.type==='button').props.disabled,true);
});
test('Authenticated dispatcher cannot import a demo workspace or silence framework exceptions', () => {
  const source=readFileSync('components/module-landing.tsx','utf8');
  assert.doesNotMatch(source,/catch\s*\(|demo-data|@\/components\/(core-hr-workspace|work-pay-workspace|growth-workspace|employee-services-workspace|governance-planning-workspace|platform-admin-workspace)/);
  assert.doesNotMatch(source,/SlidersHorizontal|View architecture|New record/);
});
test('Browser fault/healthy gate is mandatory and restricted to the disposable loopback database', () => {
  const browser=readFileSync('scripts/module-workspace-browser-regression.mjs','utf8');
  assert.match(browser,/HRBP_DISPOSABLE_AUDIT/);assert.match(browser,/database\.pathname, '\/hrbp_audit'/);
  assert.match(browser,/assert\.ok\(\['localhost','127\.0\.0\.1'\]\.includes\(database\.hostname\)\)/);
  assert.match(browser,/pg_try_advisory_lock/);assert.match(browser,/if\(renamed\)await renameTable\(true\)/);
  assert.match(browser,/report\.healthy\.length,64/);assert.match(browser,/report\.faults\.length,2/);assert.match(browser,/report\.failures,\[\]/);
  const workflow=readFileSync('.github/workflows/platform-regression.yml','utf8');
  assert.match(workflow,/node scripts\/module-workspace-browser-regression\.mjs\s*node scripts\/core-workspace-browser-regression\.mjs\s*node scripts\/platform-remediation-gate\.mjs/);
});
