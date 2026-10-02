import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from './load-ts.mjs';
import { auditDomainFlows } from './domain-flows.mjs';
requireDisposableDatabase();
const BASE = 'http://localhost:3100';
const { chromium } = createRequire(process.env.HRBP_AUDIT_BROWSER_PACKAGE)('playwright');
const fixture = JSON.parse(await readFile('audit-results/fixtures.json', 'utf8'));
const inventory = JSON.parse(await readFile('audit-results/inventory.json', 'utf8'));
const db = new PrismaClient();
const report = { version: 3, target: 'disposable CI Next.js/Chromium/PostgreSQL', source: process.env.GITHUB_SHA, pages: [], links: [], api: [], scenarios: [], failures: [], externalBlocked: [], limitations: ['Page-load and link checks are not exhaustive feature coverage.', 'Each authenticated page separately verifies the continuing signed session.', 'Synthetic role fixtures are not real OIDC/SSO integration.', 'Object storage, document scanning, AI provider and third-party integrations have no live credentials.', 'Chromium only; not Firefox/WebKit or production Cloudflare load testing.'] };
await mkdir('audit-results/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = new Map();
function failure(kind, detail) { report.failures.push({ kind, ...detail }); }
async function checkpoint() { await writeFile('audit-results/browser.json', JSON.stringify(report, null, 2)); }
async function scenario(name, action) {
  try { await action(); report.scenarios.push({ name, status: 'passed' }); }
  catch (e) { const error = String(e.message).slice(0,350); report.scenarios.push({ name, status: 'failed', error }); failure('scenario', { name, error }); }
  await checkpoint();
}
async function sessionOf(context) {
  const response = await context.request.get(BASE + '/api/auth/session', { timeout: 10000 });
  assert.equal(response.status(), 200);
  return response.json();
}
async function contextFor(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC' });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => { localStorage.setItem('hrbp-locale','en'); localStorage.setItem('hrbp-theme','light'); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === BASE) return route.continue();
    report.externalBlocked.push(new URL(route.request().url()).origin); return route.abort();
  });
  if (account) {
    const r = await context.request.post(BASE + '/api/auth/local', { data: { identifier: account.subject, password: process.env.HRBP_TEST_ADMIN_PASSWORD, returnTo: '/' }, headers: { origin: BASE }, timeout:15000 });
    if (r.status() !== 200) { const body = await r.json().catch(()=>({})); await context.close(); throw new Error(`Login ${account.role}: HTTP ${r.status()}; ${String(body.error||'').slice(0,100)}`); }
    const session = await sessionOf(context);
    assert.equal(session.authenticated,true); assert.equal(session.user.role,account.role);
  }
  return context;
}
async function inspectPage(context, role, path, responsive=false) {
  const page = await context.newPage(), errors=[], httpErrors=[], logoutRequests=[];
  page.on('pageerror', e=>errors.push(e.message.slice(0,200)));
  page.on('request', r=>{if(new URL(r.url()).pathname==='/api/auth/logout')logoutRequests.push({method:r.method(),prefetch:r.headers()['next-router-prefetch']||null});});
  page.on('response', r=>{if(r.status()>=500&&r.url().startsWith(BASE))httpErrors.push({path:new URL(r.url()).pathname,status:r.status()});});
  let row;
  try {
    const before = await sessionOf(context);
    const response = await page.goto(BASE+path,{waitUntil:'networkidle',timeout:20000});
    await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:10000});
    const after = await sessionOf(context);
    const text = await page.locator('body').innerText();
    const hrefs=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    const nav=await page.locator('a.nav-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    const deferred=role!=='PUBLIC'&&/protected fallback|temporarily unavailable|safe fallback|could not be loaded/i.test(text);
    row={role,path,http:response?.status(),heading:await page.locator('h1').first().textContent({timeout:2000}).catch(()=>''),authenticatedBefore:before.authenticated,authenticatedAfter:after.authenticated,roleAfter:after.user?.role||null,logoutRequests,pageErrors:errors,serverErrors:httpErrors,deferred,denied:/Access is restricted|Access denied|does not include|not authorized/i.test(text),nav,links:hrefs,controls:await page.locator('button:not([disabled])').count()};
    if(role!=='PUBLIC'&&(!before.authenticated||!after.authenticated||after.user?.role!==role))failure('session-loss',{role,path,logoutRequests});
    if(row.http!==200||errors.length||httpErrors.length||deferred)failure('page',{role,path,http:row.http,errors,httpErrors,deferred});
    if(responsive) {
      row.layouts=[];
      for(const [theme,width] of [['light',1440],['dark',1440],['light',390],['dark',390]]) {
        await page.setViewportSize({width,height:900});
        await page.evaluate(t=>{document.documentElement.dataset.theme=t;localStorage.setItem('hrbp-theme',t);},theme);
        await page.waitForTimeout(60);
        const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
        row.layouts.push({theme,width,...dimensions});
        if(dimensions.document>width+2)failure('layout-overflow',{role,path,theme,...dimensions});
      }
      if(role==='TENANT_ADMIN')await page.screenshot({path:`audit-results/screenshots/${path.replace(/[^a-z0-9]/gi,'_')}-mobile-dark.png`,fullPage:true});
    }
  } catch(e){row={role,path,error:e.message.slice(0,300),pageErrors:errors};failure('page-load',{role,path,error:row.error});}
  finally{await page.close();}
  report.pages.push(row);
  console.log('AUDIT_PAGE '+JSON.stringify({role,path,http:row.http,authenticated:row.authenticatedAfter,error:row.error,deferred:row.deferred,denied:row.denied}));
  return row;
}
const pathFor=slug=>slug==='dashboard'?'/':`/module/${slug}`;
const publicApis=new Set(['/api/auth/session','/api/auth/local','/api/auth/login','/api/auth/callback','/api/auth/logout','/api/search','/api/health/runtime','/api/health/db','/api/health/auth','/api/health/hyperdrive']);
const apiRole=path=>path.startsWith('/api/payroll')?'PAYROLL_ADMIN':path.startsWith('/api/compensation')?'COMPENSATION_ADMIN':/^\/api\/(talent|performance|succession)/.test(path)?'TALENT_ADMIN':path.startsWith('/api/employee-relations')?'ER_INVESTIGATOR':path.startsWith('/api/privacy')?'PRIVACY_OFFICER':/^\/api\/(onboarding|offboarding|learning|time|leave|benefits|engagement|workforce-planning|workflows|policies)/.test(path)?'HR_OPERATIONS':'TENANT_ADMIN';
try {
  const publicContext=await contextFor(null);contexts.set('PUBLIC',publicContext);
  await scenario('logout link never prefetches; only explicit click clears session',async()=>{
    const context=await contextFor(fixture.accounts.find(a=>a.role==='EMPLOYEE')),p=await context.newPage(),requests=[];
    p.on('request',r=>{if(new URL(r.url()).pathname==='/api/auth/logout')requests.push(r.url());});
    try {
      await p.goto(BASE,{waitUntil:'networkidle'});await p.locator('.topbar-logout').hover();await p.waitForTimeout(700);
      assert.equal(requests.length,0,'Logout endpoint was requested without a click');assert.equal((await sessionOf(context)).authenticated,true);
      await p.goto(BASE+'/module/people',{waitUntil:'networkidle'});assert.equal((await sessionOf(context)).authenticated,true);
      await p.locator('.topbar-logout').click();await p.waitForURL('**/auth/sign-in?signedOut=1');assert.equal((await sessionOf(context)).authenticated,false);
      assert.ok(requests.length>=1);
    }finally{await context.close();}
  });
  for(const slug of inventory.modules)await inspectPage(publicContext,'PUBLIC',pathFor(slug),true);
  for(const account of fixture.accounts) {
    let context;try{context=await contextFor(account);contexts.set(account.role,context);}catch(e){failure('login',{role:account.role,error:e.message});continue;}
    let checkedNavigation=false;
    for(const slug of account.expectedModules) {
      const row=await inspectPage(context,account.role,pathFor(slug),account.role==='TENANT_ADMIN');
      if(!checkedNavigation&&row.nav) {
        checkedNavigation=true;const expected=account.expectedModules.map(pathFor).sort();
        if(JSON.stringify([...row.nav].sort())!==JSON.stringify(expected))failure('navigation-capabilities',{role:account.role,missing:expected.filter(p=>!row.nav.includes(p)),unexpected:row.nav.filter(p=>!expected.includes(p))});
      }
    }
    await inspectPage(context,account.role,'/module/notifications');await checkpoint();
  }
  for(const [role,context] of contexts) {
    const inspected=new Set(report.pages.filter(p=>p.role===role&&p.http===200).map(p=>p.path));
    for(const href of new Set(report.pages.filter(p=>p.role===role).flatMap(p=>p.links||[]))) {
      if(!href||href==='#'){report.links.push({role,href,status:'placeholder'});continue;}
      const url=new URL(href,BASE),path=url.pathname+url.search;
      if(url.origin!==BASE||url.pathname.startsWith('/api/')){report.links.push({role,href,status:'external-or-action-not-followed'});continue;}
      if(inspected.has(path)){report.links.push({role,href,status:'covered-by-browser-page'});continue;}
      try{const res=await context.request.get(url.href,{maxRedirects:0,timeout:15000});report.links.push({role,href,status:res.status()});if(res.status()>=400)failure('link',{role,href,http:res.status()});}catch(e){failure('link',{role,href,error:e.message.slice(0,120)});}
    }
  }
  for(const route of inventory.apis)for(const method of route.methods) {
    if(publicApis.has(route.path))continue;
    const path=route.path.replace(/\[[^\]]+\]/g,'audit-missing');
    const res=await publicContext.request.fetch(BASE+path,{method,maxRedirects:0,timeout:10000,...(!['GET','HEAD'].includes(method)?{data:{}}:{})});
    report.api.push({path:route.path,method,test:'anonymous',http:res.status()});
    if(![401,403].includes(res.status()))failure('anonymous-api',{path:route.path,method,http:res.status()});
    if(['POST','PUT','PATCH'].includes(method)&&!path.startsWith('/api/internal/')) {
      const role=apiRole(path),context=contexts.get(role);if(!context)continue;
      // Buffer preserves the invalid bytes: Playwright otherwise JSON-quotes invalid string data.
      const malformed=await context.request.fetch(BASE+path,{method,data:Buffer.from('{'),headers:{'content-type':'application/json',origin:BASE},timeout:10000});
      report.api.push({path:route.path,method,test:'malformed-authenticated',role,http:malformed.status()});
      if(malformed.status()>=500)failure('malformed-api',{path:route.path,method,role,http:malformed.status()});
      if(malformed.status()===401)failure('session-loss-api',{path:route.path,method,role});
    }
  }
  await checkpoint();
  await scenario('unknown module returns real 404',async()=>assert.equal((await publicContext.request.get(BASE+'/module/audit-definitely-unknown')).status(),404));
  await scenario('malformed session cookie never becomes HTTP 500',async()=>assert.equal((await publicContext.request.get(BASE+'/api/people',{headers:{cookie:'hrbp_session=%ZZ'}})).status(),401));
  await scenario('local login rejects malformed JSON without server error',async()=>assert.equal((await publicContext.request.post(BASE+'/api/auth/local',{data:Buffer.from('{'),headers:{'content-type':'application/json',origin:BASE}})).status(),400));
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
    await scenario('real local-sign-in form authenticates the synthetic employee',async()=>{
      const guest=await contextFor(null),p=await guest.newPage();try{
        await p.goto(BASE+'/auth/sign-in',{waitUntil:'networkidle'});await p.locator('#local-identifier').fill(fixture.accounts.find(a=>a.role==='EMPLOYEE').subject);await p.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        const pending=p.waitForResponse(r=>r.url()===BASE+'/api/auth/local'&&r.request().method()==='POST');await p.getByRole('button',{name:'Sign in with local account',exact:true}).click();assert.equal((await pending).status(),200);await p.waitForURL(BASE+'/',{waitUntil:'networkidle'});assert.equal((await sessionOf(guest)).authenticated,true);
      }finally{await guest.close();}
    });
    await auditDomainFlows({contexts,fixture,db,report,scenario,BASE,inventory});
  }
}catch(e){failure('audit-execution',{error:String(e.message).slice(0,400)});}
finally {
  await db.$disconnect();await browser.close();report.externalBlocked=[...new Set(report.externalBlocked)];
  report.counts={pages:report.pages.length,links:report.links.length,apiChecks:report.api.length,scenarios:report.scenarios.length,authenticatedRoles:contexts.size-1,failures:report.failures.length};
  await checkpoint();
  const summary=['# HRBP product audit','',`Commit: ${report.source}`,`Target: ${report.target}`,'',JSON.stringify(report.counts),'','## Findings',...report.failures.map(f=>'- '+JSON.stringify(f)),'','## Scenarios',...report.scenarios.map(s=>'- '+JSON.stringify(s)),'','## Limits',...report.limitations.map(s=>'- '+s),''].join('\n');
  await writeFile('audit-results/summary.md',summary);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary.slice(0,60000));
  console.log('AUDIT_TOTAL '+JSON.stringify(report.counts));for(const f of report.failures)console.log('AUDIT_FAILURE '+JSON.stringify(f));if(report.failures.length)process.exitCode=1;
}
