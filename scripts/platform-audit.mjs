/** Inventory and black-box checks of the unchanged application on disposable localhost only. */
import { readdir, readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from 'playwright';
import { PrismaClient, PlatformRole } from '@prisma/client';

const origin = 'http://127.0.0.1:3100';
const url = new URL(process.env.DATABASE_URL || 'about:blank');
if (process.env.HRBP_DISPOSABLE_AUDIT !== 'true' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hrbp_audit') throw Error('Disposable loopback hrbp_audit database required');
const out = '.audit';
await mkdir(out, { recursive: true });
const report = { source: 'c1f20ba92e13021977886d63733078e95818ecef', testedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(), inventory: {}, checks: [], pages: [], links: [], controls: [], limitations: [ 'Only disposable seeded data; not a production or external-provider test.', 'API enumeration checks authorization and invalid input, not every valid business transition.', 'Browser page checks are render/read/link checks, not every enabled button action.', 'Only explicitly listed workflows receive happy-path write verification.', 'External links/integrations are inventoried but not contacted.' ] };
const emit = (category, data) => { report.checks.push({ category, ...data }); console.log('AUDIT_CHECK ' + JSON.stringify({ category, ...data })); };
const req = createRequire(import.meta.url);
function loadTS(file) { const code = ts.transpileModule(execFileSync('cat', [file], { encoding: 'utf8' }), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const m = { exports: {} }; new Function('require', 'module', 'exports', code)(req, m, m.exports); return m.exports; }
async function walk(dir) { const rows = await readdir(dir, { withFileTypes: true }); const lists = await Promise.all(rows.map(x => x.isDirectory() ? walk(`${dir}/${x.name}`) : [`${dir}/${x.name}`])); return lists.flat(); }
const files = [...await walk('app'), ...await walk('components'), ...await walk('lib')].filter(x => /\.(tsx?|mjs)$/.test(x));
const endpoints = []; const pageFiles = []; const literals = []; const dynamicCalls = [];
const navSource = await readFile('lib/navigation.ts', 'utf8');
const slugs = [...new Set([...navSource.matchAll(/slug:\s*"([^"]+)"/g)].map(x => x[1]))];
const routes = slugs.map(x => x === 'dashboard' ? '/' : `/module/${x}`);
routes.push('/auth/sign-in', '/module/notifications', '/module/people/new', '/module/positions/new', '/module/employee-360/lifecycle');
function fileRoute(file, terminal) { return '/' + file.replace(/^app\//, '').replace(new RegExp(`/?${terminal}\\.tsx?$`), '').split('/').filter(x => !x.startsWith('(') && !x.startsWith('@')).join('/'); }
function lineOf(sf, node) { return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1; }
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (/\/page\.tsx$/.test(file)) pageFiles.push({ file, route: fileRoute(file, 'page') });
  if (/\/route\.ts$/.test(file)) {
    const methods = [];
    for (const n of sf.statements) {
      if (ts.isFunctionDeclaration(n) && n.name && n.modifiers?.some(x => x.kind === ts.SyntaxKind.ExportKeyword) && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(n.name.text)) methods.push(n.name.text);
    }
    endpoints.push({ file, route: fileRoute(file, 'route'), methods });
  }
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'href' && n.initializer) {
      let v = n.initializer;
      if (ts.isJsxExpression(v)) v = v.expression;
      if (v && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v))) literals.push({ file, line: lineOf(sf, n), kind: 'href', value: v.text });
    }
    if (ts.isCallExpression(n) && n.arguments.length && /(^fetch$|\.(push|replace)$)/.test(n.expression.getText(sf))) {
      const v = n.arguments[0]; const kind = n.expression.getText(sf) === 'fetch' ? 'fetch' : 'navigation';
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) literals.push({ file, line: lineOf(sf, n), kind, value: v.text });
      else if (ts.isTemplateExpression(v)) dynamicCalls.push({ file, line: lineOf(sf, n), kind, expression: v.getText(sf) });
    }
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'button') {
      const attrs = n.openingElement.attributes.properties.filter(ts.isJsxAttribute);
      const names = attrs.map(x => x.name.getText(sf));
      let form = false; let p = n.parent;
      while (p) { if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === 'form') form = true; p = p.parent; }
      if (!names.includes('onClick') && !names.includes('disabled') && !names.includes('formAction') && !form) report.controls.push({ file, line: lineOf(sf, n), review: 'possible-unwired-button', excerpt: n.getText(sf).slice(0, 180) });
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
function matches(pattern, path) { const re = pattern.split('/').map(x => x.startsWith('[') ? '[^/]+' : x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/'); return new RegExp(`^${re}/?$`).test(path); }
function pageExists(path) { if (path.startsWith('/module/') && path.split('/').length === 3) return slugs.includes(path.split('/')[2]) || path === '/module/notifications'; return pageFiles.some(x => x.route !== '/module/[slug]' && matches(x.route, path)); }
const staticMissing = [];
for (const l of literals) {
  if (!l.value.startsWith('/') || l.value.startsWith('//') || l.value.includes('${')) continue;
  const path = l.value.split(/[?#]/)[0];
  const exists = path.startsWith('/api/') ? endpoints.some(x => matches(x.route, path)) : pageExists(path);
  if (!exists && !/\.[a-z0-9]+$/i.test(path)) staticMissing.push(l);
}
report.inventory = { sourceFiles: files.length, navigationModules: slugs.length, moduleSlugs: slugs, pageFiles: pageFiles.length, apiFiles: endpoints.length, apiMethods: endpoints.reduce((s,x)=>s+x.methods.length,0), literalLinks: literals.length, dynamicCalls: dynamicCalls.length, possibleUnwiredButtons: report.controls.length, staticMissing, endpoints, pages: pageFiles, literals, dynamicCalls };
console.log('AUDIT_INVENTORY ' + JSON.stringify({ ...report.inventory, endpoints: undefined, pages: undefined, literals: undefined, dynamicCalls: undefined }));
async function http(path, { method = 'GET', cookie, body, raw, headers = {} } = {}) {
  const start = Date.now();
  try {
    const res = await fetch(origin + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' && method !== 'HEAD' ? { 'content-type': 'application/json', origin } : {}), ...headers }, body: method === 'GET' || method === 'HEAD' ? undefined : raw ?? JSON.stringify(body ?? {}), signal: AbortSignal.timeout(12000) });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { /* html is recorded by status, not dumped */ }
    return { status: res.status, ms: Date.now()-start, data, error: data?.error, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie'), textLength: text.length };
  } catch(e) { return { status: 0, ms: Date.now()-start, error: e.name }; }
}
const db = new PrismaClient();
const { hashLocalPassword, verifyLocalPassword } = loadTS('lib/local-auth.ts');
const pass = process.env.HRBP_TEST_ADMIN_PASSWORD;
const seeded = await db.userAccount.findUnique({ where: { id: 'user-local-test-admin' } });
emit('seed-password', { expected: true, actual: verifyLocalPassword(pass, seeded?.localPasswordHash), fieldCount: seeded?.localPasswordHash?.split('$').length });
const seededLogin = await http('/api/auth/local', { method: 'POST', body: { identifier: 'local.admin', password: pass } });
emit('seed-admin-login', { expected: 200, actual: seededLogin.status });
const users = [
  { key: 'admin', role: PlatformRole.TENANT_ADMIN, email: 'qa.admin@acme.example' },
  { key: 'employee', role: PlatformRole.EMPLOYEE, email: 'sofia.marin@acme.example' },
  { key: 'manager', role: PlatformRole.MANAGER, email: 'maya.rao@acme.example' },
  { key: 'hrbp', role: PlatformRole.HRBP, email: 'noah.williams@acme.example' }
];
const cookies = {};
for (const u of users) {
  const id = `qa-audit-${u.key}`;
  await db.userAccount.create({ data: { id, tenantId: 'tenant-acme-global', subject: `audit.${u.key}`, displayName: `QA ${u.key}`, email: u.email, role: u.role, active: true, localAuthEnabled: true, localPasswordHash: hashLocalPassword(pass) } });
  const r = await http('/api/auth/local', { method: 'POST', body: { identifier: `audit.${u.key}`, password: pass } });
  emit('qa-login', { role: u.key, expected: 200, actual: r.status });
  if (r.status !== 200 || !r.setCookie) throw Error(`QA login failed: ${u.key}`);
  cookies[u.key] = r.setCookie.split(';')[0];
}
const anonAllow = new Set(['/api/search','/api/auth/session','/api/auth/login','/api/auth/logout','/api/auth/local','/api/auth/callback','/api/health/auth','/api/health/db','/api/health/hyperdrive','/api/health/runtime']);
const apiResults = [];
for (const endpoint of endpoints) for (const method of endpoint.methods) {
  const path = endpoint.route.replace(/\[[^\]]+\]/g,'qa-record-does-not-exist');
  const r = await http(path, { method });
  apiResults.push({ path: endpoint.route, method, anonymous: r.status, expectedProtected: !anonAllow.has(endpoint.route) });
  if (r.status >= 500 || !r.status || (!anonAllow.has(endpoint.route) && ![401,403,404].includes(r.status))) emit('api-anonymous-anomaly', { path: endpoint.route, method, actual: r.status, error: r.error });
}
for (const endpoint of endpoints) {
  if (!endpoint.methods.includes('GET') || /\/auth\//.test(endpoint.route) || endpoint.route.includes('[')) continue;
  const r = await http(endpoint.route, { cookie: cookies.admin });
  apiResults.push({ path: endpoint.route, method: 'GET', admin: r.status, error: r.error });
  if (r.status >= 500 || !r.status) emit('api-admin-read-anomaly', { path: endpoint.route, actual: r.status, error: r.error });
}
report.apiResults = apiResults;
for (const raw of ['{', 'null', '[]']) {
  const r = await http('/api/auth/local', { method: 'POST', raw });
  emit('malformed-login-body', { input: raw, actual: r.status, expected: 'controlled 4xx, never 500' });
}
for (const cookie of ['unrelated=%ZZ', 'hrbp_session=%ZZ', cookies.admin + '; unrelated=%ZZ']) {
  const r = await http('/api/people', { cookie });
  emit('malformed-cookie', { variant: cookie.startsWith('unrelated') ? 'unrelated-anonymous' : cookie.includes(';') ? 'valid-session-plus-unrelated' : 'invalid-session', actual: r.status, expected: 'controlled status, never 500' });
}
const redir = await http('/api/auth/local', { method: 'POST', body: { identifier:'audit.admin', password: pass, returnTo:'/\\example.invalid' } });
emit('return-to', { actual: redir.status, returned: redir.data?.data?.returnTo, leavesOrigin: redir.data?.data?.returnTo ? new URL(redir.data.data.returnTo, origin).origin !== origin : null });
const fake = await http('/api/settings/local-accounts', { headers: { 'x-tenant-id':'tenant-acme-global','x-user-id':'qa-audit-admin','x-role':'TENANT_ADMIN' } });
emit('production-header-spoof', { expected:401, actual:fake.status });
for (const role of ['employee','manager','hrbp']) for (const path of ['/api/settings/local-accounts','/api/audit/events','/api/onboarding/operations']) {
  const r = await http(path, { cookie:cookies[role] }); emit('role-boundary', { role,path,actual:r.status });
}
// Happy-path checks use a dedicated fixture, not the standard seed plans.
const fixture = 'qa-flow-' + randomUUID(); const due = new Date(Date.now()-60000); const future = new Date(Date.now()+86400000).toISOString();
await db.person.create({ data: { id:fixture,tenantId:'tenant-acme-global',givenName:'QA',familyName:'Lifecycle',employeeNumber:fixture } });
await db.employment.create({ data: { id:fixture,tenantId:'tenant-acme-global',personId:fixture,status:'PREBOARDING',startDate:due } });
await db.onboardingPlan.create({ data: { id:fixture,tenantId:'tenant-acme-global',personId:fixture,employmentId:fixture,status:'NOT_STARTED',targetStartDate:due,ownerId:'qa-audit-admin' } });
const creation = { title:'QA device preparation',ownerType:'IT',sensitive:false,dueDate:future,reason:'Disposable end-to-end verification',requestId:randomUUID(),expectedPlanStatus:'NOT_STARTED' };
const created = await http(`/api/onboarding/plans/${fixture}/tasks`, { method:'POST',cookie:cookies.admin,body:creation });
emit('onboarding-create', { expected:201,actual:created.status });
const duplicate = await http(`/api/onboarding/plans/${fixture}/tasks`, { method:'POST',cookie:cookies.admin,body:creation });
emit('onboarding-duplicate', { expected:409,actual:duplicate.status });
const taskId = created.data?.data?.id;
if (taskId) {
  const early = await http(`/api/onboarding/plans/${fixture}/activate`, { method:'POST',cookie:cookies.admin }); emit('onboarding-incomplete-activation', { expected:409,actual:early.status });
  const finish = await http(`/api/onboarding/tasks/${taskId}/status`, { method:'POST',cookie:cookies.admin,body:{status:'COMPLETED'} }); emit('onboarding-complete', { expected:200,actual:finish.status });
  const activate = await http(`/api/onboarding/plans/${fixture}/activate`, { method:'POST',cookie:cookies.admin }); emit('onboarding-activate', { expected:200,actual:activate.status });
  const employment = await db.employment.findUnique({where:{id:fixture}}); emit('onboarding-persisted', { expected:'ACTIVE',actual:employment?.status });
}
const browser = await chromium.launch({ headless:true });
const linkSet = new Map();
try {
  for (const role of ['anonymous','admin','employee','manager','hrbp']) {
    const context = await browser.newContext({ viewport:{width:1440,height:1000} });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (role !== 'anonymous') {
      const token = decodeURIComponent(cookies[role].slice(cookies[role].indexOf('=')+1));
      await context.addCookies([{name:'hrbp_session',value:token,url:origin,httpOnly:true,secure:false,sameSite:'Lax'}]);
    }
    const page = await context.newPage(); let errors=[]; let failures=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,240)));
    page.on('response',r=>{if(r.status()>=500) failures.push({url:new URL(r.url()).pathname,status:r.status()});});
    for (const path of [...new Set(routes)]) {
      errors=[]; failures=[];
      const started=Date.now();
      try {
        const response=await page.goto(origin+path,{waitUntil:'networkidle',timeout:20000});
        await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:3000}).catch(()=>{});
        const dom=await page.evaluate(()=>{
          const area=document.querySelector('.page-content')||document.body;
          const text=area.innerText||'';
          return { title:document.title,heading:area.querySelector('h1,h2')?.textContent?.trim().slice(0,120), textSize:text.length, fallback:/could not|unable to|unavailable|failed to|yüklenemedi|erişilemiyor/i.test(text), denied:/access denied|not authorized|not permitted|permission|yetkiniz yok|erişim reddedildi/i.test(text), overflow:document.documentElement.scrollWidth>innerWidth+2, buttons:area.querySelectorAll('button').length,disabledButtons:area.querySelectorAll('button:disabled').length,unnamedButtons:[...area.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length,links:[...document.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),text:a.textContent.trim().slice(0,80)})) };
        });
        const row={role,path,status:response?.status(),ms:Date.now()-started,...dom,errors:[...new Set(errors)],serverFailures:failures}; delete row.links;
        report.pages.push(row);
        if(role==='admin'||role==='anonymous') for(const link of dom.links) if(link.href?.startsWith('/')&&!link.href.startsWith('//')) linkSet.set(`${role}:${link.href}`,{role,...link,source:path});
        if(row.errors.length||row.serverFailures.length||row.status>=500) console.log('AUDIT_PAGE_ANOMALY '+JSON.stringify(row));
      }catch(e){ report.pages.push({role,path,status:0,error:e.name});console.log('AUDIT_PAGE_ANOMALY '+JSON.stringify({role,path,error:e.message.slice(0,220)})); }
    }
    // Responsive render checks are additional to desktop, not an accessibility certification.
    if(role==='admin') {
      await page.setViewportSize({width:390,height:844});
      for(const path of [...new Set(routes)].filter(x=>x!=='/auth/sign-in')) {
        try { const r=await page.goto(origin+path,{waitUntil:'networkidle',timeout:15000}); const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,width:document.documentElement.scrollWidth,viewport:innerWidth})); report.pages.push({role:'admin-mobile',path,status:r?.status(),...m}); }catch(e){report.pages.push({role:'admin-mobile',path,status:0,error:e.name});}
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
for(const entry of linkSet.values()) {
  if(/^\/api\/auth\/(login|logout)/.test(entry.href)) {report.links.push({...entry,status:'not-followed-auth-action'});continue;}
  const r=await http(entry.href,{cookie:cookies[entry.role]});
  report.links.push({...entry,status:r.status,location:r.location});
}
// Cookie revocation probe: a real successful local session, then administrative disable.
await db.userAccount.update({where:{id:'qa-audit-employee'},data:{active:false}});
const disabled=await http('/api/people',{cookie:cookies.employee});
emit('disabled-user-existing-session',{actual:disabled.status,expected:'session revoked or documented TTL exposure'});
await db.$disconnect();
const summary={ source:report.source, navigationModules:slugs.length,pageFiles:pageFiles.length,apiFiles:endpoints.length,apiMethods:report.inventory.apiMethods,sourceFiles:files.length,staticMissing,possibleUnwiredButtons:report.controls.length,browserChecks:report.pages.length,browser500:report.pages.filter(x=>x.status>=500||x.status===0),browserJsErrors:report.pages.filter(x=>x.errors?.length),serverFailurePages:report.pages.filter(x=>x.serverFailures?.length),mobileOverflow:report.pages.filter(x=>x.role==='admin-mobile'&&x.overflow).map(x=>x.path),fallbackPages:report.pages.filter(x=>x.role==='admin'&&x.fallback).map(x=>x.path),checkedLinks:report.links.length,brokenLinks:report.links.filter(x=>x.status===404||x.status>=500||x.status===0),apiRequests:apiResults.length,api500:apiResults.filter(x=>x.anonymous>=500||x.admin>=500||x.anonymous===0||x.admin===0),checks:report.checks,modules:slugs.map(slug=>({slug,views:report.pages.filter(x=>x.path===(slug==='dashboard'?'/':`/module/${slug}`)).map(x=>({role:x.role,status:x.status,denied:x.denied,fallback:x.fallback,errors:x.errors?.length,overflow:x.overflow}))})) };
await writeFile(`${out}/platform-report.json`,JSON.stringify(report,null,2));
await writeFile(`${out}/platform-summary.json`,JSON.stringify(summary,null,2));
console.log('AUDIT_SUMMARY '+JSON.stringify(summary));
console.log('AUDIT_CONTROL_CANDIDATES '+JSON.stringify(report.controls));
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,`## HRBP platform audit\n\nSource: \`${report.source}\`\n\n${slugs.length} navigation entries, ${pageFiles.length} page files, ${endpoints.length} API files, ${report.inventory.apiMethods} API methods.\n\n${report.pages.length} browser renders; ${report.links.length} internal links checked; ${apiResults.length} API boundary/read requests.\n\nThis is an audit, not a declaration that every business workflow passed. Full findings and test limitations are in the attached JSON artifacts.\n`);
