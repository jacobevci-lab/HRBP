import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from './load-ts.mjs';
requireDisposableDatabase();
const BASE = 'http://127.0.0.1:3100';
const requireBrowser = createRequire(process.env.HRBP_AUDIT_BROWSER_PACKAGE);
const { chromium } = requireBrowser('playwright');
const fixture = JSON.parse(await readFile('audit-results/fixtures.json', 'utf8'));
const inventory = JSON.parse(await readFile('audit-results/inventory.json', 'utf8'));
const db = new PrismaClient();
const report = { version: 1, target: 'disposable CI Next.js/Chromium/PostgreSQL', source: process.env.GITHUB_SHA, pages: [], links: [], api: [], scenarios: [], failures: [], externalBlocked: [], limitations: ['Page-load and link checks are not exhaustive feature coverage.', 'Synthetic role fixtures are not real OIDC/SSO integration.', 'Object storage, document scanning, AI provider and third-party integrations have no live credentials.', 'Chromium only; not Firefox/WebKit or production Cloudflare load testing.'] };
await mkdir('audit-results/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = new Map();
function failure(kind, detail) { report.failures.push({ kind, ...detail }); }
async function scenario(name, action) {
  try { await action(); report.scenarios.push({ name, status: 'passed' }); }
  catch (e) { report.scenarios.push({ name, status: 'failed', error: String(e.message).slice(0, 350) }); failure('scenario', { name, error: String(e.message).slice(0,350) }); }
}
async function contextFor(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC' });
  await context.addInitScript(() => { localStorage.setItem('hrbp-locale', 'en'); localStorage.setItem('hrbp-theme', 'light'); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === BASE) return route.continue();
    report.externalBlocked.push(new URL(route.request().url()).origin); return route.abort();
  });
  if (account) {
    const r = await context.request.post(BASE + '/api/auth/local', { data: { identifier: account.subject, password: process.env.HRBP_TEST_ADMIN_PASSWORD, returnTo: '/' }, headers: { origin: BASE } });
    assert.equal(r.status(), 200, `Login failed for ${account.role}`);
    const session = await (await context.request.get(BASE + '/api/auth/session')).json();
    assert.equal(session.authenticated, true, `Session cookie failed for ${account.role}`);
    assert.equal(session.user.role, account.role);
  }
  return context;
}
async function inspectPage(context, role, path, responsive = false) {
  const page = await context.newPage(), errors = [], httpErrors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0,200)));
  page.on('response', r => { if (r.status() >= 500 && r.url().startsWith(BASE)) httpErrors.push({ path: new URL(r.url()).pathname, status:r.status() }); });
  let row;
  try {
    const response = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
    await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:10000});
    const text = await page.locator('body').innerText();
    const hrefs = await page.locator('a[href]').evaluateAll(nodes => nodes.map(n=>n.getAttribute('href')));
    const nav = await page.locator('a.nav-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    const deferred = /protected fallback|temporarily unavailable|safe fallback|could not be loaded/i.test(text);
    const denied = /Access is restricted|Access denied|does not include|not authorized/i.test(text);
    row = {role,path,http:response?.status(),heading:await page.locator('h1').first().textContent().catch(()=>''),pageErrors:errors,serverErrors:httpErrors,deferred,denied,nav,links:hrefs,controls:await page.locator('button:not([disabled])').count()};
    if (row.http !== 200 || errors.length || httpErrors.length || deferred) failure('page', {role,path,http:row.http,errors,httpErrors,deferred});
    if (responsive) {
      row.layouts=[];
      for (const [theme,width] of [['light',1440],['dark',1440],['light',390],['dark',390]]) {
        await page.setViewportSize({width,height:900});
        await page.evaluate(t=>{document.documentElement.dataset.theme=t;localStorage.setItem('hrbp-theme',t);},theme);
        await page.waitForTimeout(60);
        const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
        row.layouts.push({theme,width,...dimensions});
        if(dimensions.document>width+2) failure('layout-overflow',{role,path,theme,...dimensions});
      }
      if(role==='TENANT_ADMIN') await page.screenshot({path:`audit-results/screenshots/${path.replace(/[^a-z0-9]/gi,'_')}-mobile-dark.png`,fullPage:true});
    }
  } catch(e) { row={role,path,error:e.message.slice(0,300),pageErrors:errors};failure('page-load',{role,path,error:row.error}); }
  finally { await page.close(); }
  report.pages.push(row);
  console.log('AUDIT_PAGE '+JSON.stringify({role,path,http:row.http,error:row.error,deferred:row.deferred,denied:row.denied,pageErrors:errors.length}));
  return row;
}
const pathFor=slug=>slug==='dashboard'?'/':`/module/${slug}`;
const publicApis = new Set(['/api/auth/session','/api/auth/local','/api/auth/login','/api/auth/callback','/api/auth/logout','/api/search','/api/health/runtime','/api/health/db','/api/health/auth','/api/health/hyperdrive']);
const apiRole = path => {
 if(path.startsWith('/api/payroll')) return 'PAYROLL_ADMIN';
 if(path.startsWith('/api/compensation')) return 'COMPENSATION_ADMIN';
 if(/^\/api\/(talent|performance|succession)/.test(path)) return 'TALENT_ADMIN';
 if(path.startsWith('/api/employee-relations')) return 'ER_INVESTIGATOR';
 if(path.startsWith('/api/privacy')) return 'PRIVACY_OFFICER';
 if(/^\/api\/(onboarding|offboarding|learning|time|leave|benefits|engagement|workforce-planning|workflows|policies)/.test(path)) return 'HR_OPERATIONS';
 return 'TENANT_ADMIN';
};
try {
  const publicContext=await contextFor(null);contexts.set('PUBLIC',publicContext);
  for(const slug of inventory.modules) await inspectPage(publicContext,'PUBLIC',pathFor(slug),true);
  for(const account of fixture.accounts) {
    let context;
    try { context=await contextFor(account);contexts.set(account.role,context); }
    catch(e) {failure('login',{role:account.role,error:e.message});continue;}
    let checkedNavigation=false;
    for(const slug of account.expectedModules) {
      const row=await inspectPage(context,account.role,pathFor(slug),account.role==='TENANT_ADMIN');
      const expected=account.expectedModules.map(pathFor).sort();
      if(!checkedNavigation && row.nav) {
        checkedNavigation=true;
        if(JSON.stringify([...row.nav].sort())!==JSON.stringify(expected)) failure('navigation-capabilities',{role:account.role,path:row.path,missing:expected.filter(p=>!row.nav.includes(p)),unexpected:row.nav.filter(p=>!expected.includes(p))});
      }
    }
    await inspectPage(context,account.role,'/module/notifications');
  }
  for(const [role,context] of contexts) {
    const inspected=new Set(report.pages.filter(p=>p.role===role&&p.http===200).map(p=>p.path));
    const links=new Set(report.pages.filter(p=>p.role===role).flatMap(p=>p.links||[]));
    for(const href of links) {
      if(!href || href==='#') { report.links.push({role,href,status:'placeholder'});continue; }
      const url=new URL(href,BASE);
      if(url.origin!==BASE || url.pathname.startsWith('/api/')) { report.links.push({role,href,status:'external-or-action-not-followed'});continue; }
      const path=url.pathname+url.search;
      if(inspected.has(path)) {report.links.push({role,href,status:'covered-by-browser-page'});continue;}
      try {
        const res=await context.request.get(url.href,{maxRedirects:0,timeout:15000});
        report.links.push({role,href,status:res.status()});
        if(res.status()>=400) failure('link',{role,href,http:res.status()});
      }catch(e){failure('link',{role,href,error:e.message.slice(0,120)});}
    }
  }
  for(const route of inventory.apis) for(const method of route.methods) {
    if(publicApis.has(route.path)) continue;
    const path=route.path.replace(/\[[^\]]+\]/g,'audit-missing');
    const options={method,maxRedirects:0,timeout:10000,...(!['GET','HEAD'].includes(method)?{data:{}}:{})};
    const res=await publicContext.request.fetch(BASE+path,options);
    report.api.push({path:route.path,method,test:'anonymous',http:res.status()});
    if(![401,403].includes(res.status())) failure('anonymous-api',{path:route.path,method,http:res.status()});
    if(['POST','PUT','PATCH'].includes(method)&&!path.startsWith('/api/internal/')) {
      const role=apiRole(path),ctx=contexts.get(role);
      if(!ctx) continue;
      const malformed=await ctx.request.fetch(BASE+path,{method,data:'{',headers:{'content-type':'application/json',origin:BASE},timeout:10000});
      report.api.push({path:route.path,method,test:'malformed-authenticated',role,http:malformed.status()});
      if(malformed.status()>=500)failure('malformed-api',{path:route.path,method,role,http:malformed.status()});
    }
  }
  await scenario('unknown module returns real 404',async()=>assert.equal((await publicContext.request.get(BASE+'/module/audit-definitely-unknown')).status(),404));
  await scenario('malformed session cookie never becomes HTTP 500',async()=>assert.equal((await publicContext.request.get(BASE+'/api/people',{headers:{cookie:'hrbp_session=%ZZ'}})).status(),401));
  await scenario('local login rejects malformed JSON without server error',async()=>assert.equal((await publicContext.request.post(BASE+'/api/auth/local',{data:'{',headers:{'content-type':'application/json',origin:BASE}})).status(),400));
  await scenario('staging local-admin password is verifiable',async()=>assert.equal(fixture.seedPasswordVerified,true));
  const admin=contexts.get('TENANT_ADMIN');
  if(admin) {
    await scenario('theme and language controls change actual browser state',async()=>{
      const p=await admin.newPage();try{await p.goto(BASE,{waitUntil:'networkidle'});await p.locator('.theme-toggle').click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');await p.locator('.locale-toggle').getByRole('button',{name:'TR',exact:true}).click();await p.waitForFunction(()=>document.documentElement.lang==='tr');await p.locator('.locale-toggle').getByRole('button',{name:'EN',exact:true}).click();await p.waitForFunction(()=>document.documentElement.lang==='en');}finally{await p.close();}
    });
    await scenario('create position -> create future employee -> linked onboarding plan',async()=>{
      const p=await admin.newPage();try{
        await p.goto(BASE+'/module/positions/new',{waitUntil:'networkidle'});
        await p.locator('#positionCode').fill(fixture.prefix.toUpperCase());await p.locator('#title').fill('Synthetic Audit Position');await p.locator('#orgUnitId').selectOption('org-engineering');
        const createdPosition=p.waitForResponse(r=>r.url()===BASE+'/api/positions'&&r.request().method()==='POST');await p.getByRole('button',{name:'Create position',exact:true}).click();const pr=await createdPosition;assert.equal(pr.status(),201);const position=(await pr.json()).data;
        await p.goto(BASE+'/module/people/new',{waitUntil:'networkidle'});
        await p.locator('#employeeNumber').fill(fixture.prefix);await p.locator('#givenName').fill('Synthetic');await p.locator('#familyName').fill('Browser Audit');await p.locator('#workEmail').fill(fixture.prefix+'@audit.invalid');await p.locator('#startDate').fill(new Date(Date.now()+5*86400000).toISOString().slice(0,10));await p.locator('#positionId').selectOption(position.id);
        const createdPerson=p.waitForResponse(r=>r.url()===BASE+'/api/people'&&r.request().method()==='POST');await p.getByRole('button',{name:'Create employee',exact:true}).click();const pe=await createdPerson;assert.equal(pe.status(),201);const data=(await pe.json()).data;
        const plan=await db.onboardingPlan.findFirst({where:{tenantId:fixture.tenantId,personId:data.person.id}});assert.ok(plan);assert.equal(data.employment.status,'PREBOARDING');assert.equal(plan.employmentId,data.employment.id);
      }finally{await p.close();}
    });
    await scenario('onboarding editor assigns missing deadline and creates audited task',async()=>{
      const p=await admin.newPage();try{
        await p.goto(BASE+`/module/onboarding?plan=${fixture.planId}`,{waitUntil:'networkidle'});
        await p.getByRole('button',{name:'Plan a task',exact:true}).click();await p.getByLabel('Plan on this page',{exact:true}).selectOption(fixture.planId);await p.getByLabel('Operation',{exact:true}).selectOption('deadline');await p.getByLabel('Open task without a deadline',{exact:true}).selectOption(fixture.taskId);await p.locator('input[type=datetime-local]').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await p.getByLabel('Reason (10–500 characters)',{exact:true}).fill('Synthetic browser audit deadline assignment');
        const deadline=p.waitForResponse(r=>r.url().includes(`/tasks/${fixture.taskId}/deadline`));await p.getByRole('button',{name:'Save with audit record',exact:true}).click();assert.equal((await deadline).status(),200);assert.ok((await db.onboardingTask.findUnique({where:{id:fixture.taskId}})).dueDate);
        await p.getByRole('button',{name:'Plan a task',exact:true}).click();await p.getByLabel('Plan on this page',{exact:true}).selectOption(fixture.planId);await p.getByLabel('Task title',{exact:true}).fill('Synthetic browser-created task');await p.locator('input[type=datetime-local]').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await p.getByLabel('Reason (10–500 characters)',{exact:true}).fill('Synthetic browser audit task creation');
        const creation=p.waitForResponse(r=>r.url().includes(`/plans/${fixture.planId}/tasks`)&&r.request().method()==='POST');await p.getByRole('button',{name:'Save with audit record',exact:true}).click();const response=await creation;assert.equal(response.status(),201);const data=(await response.json()).data;assert.equal(await db.auditEvent.count({where:{tenantId:fixture.tenantId,resourceId:data.id}}),1);
      }finally{await p.close();}
    });
  }
} catch(e) {failure('audit-execution',{error:String(e.message).slice(0,400)});}
finally {
  await db.$disconnect();await browser.close();
  report.externalBlocked=[...new Set(report.externalBlocked)];
  report.counts={pages:report.pages.length,links:report.links.length,apiChecks:report.api.length,scenarios:report.scenarios.length,failures:report.failures.length};
  await writeFile('audit-results/browser.json',JSON.stringify(report,null,2));
  const summary=['# HRBP product audit','',`Commit: ${report.source}`,`Target: ${report.target}`,'',JSON.stringify(report.counts),'','## Findings',...report.failures.map(f=>'- '+JSON.stringify(f)),'','## Scenarios',...report.scenarios.map(s=>'- '+JSON.stringify(s)),'','## Limits',...report.limitations.map(s=>'- '+s),''].join('\n');
  await writeFile('audit-results/summary.md',summary);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary.slice(0,60000));
  console.log('AUDIT_TOTAL '+JSON.stringify(report.counts));
  for(const f of report.failures)console.log('AUDIT_FAILURE '+JSON.stringify(f));
  if(report.failures.length)process.exitCode=1;
}
