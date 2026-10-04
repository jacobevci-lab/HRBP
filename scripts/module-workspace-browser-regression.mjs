/** Live-render smoke plus a real, reversible data-table fault in disposable PostgreSQL.
 * Never runs against production or a database other than hrbp_audit on loopback. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import pg from 'pg';

const origin = 'http://localhost:3100';
const connectionString = process.env.DATABASE_URL || '';
const database = new URL(connectionString || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.equal(database.protocol, 'postgresql:');
assert.ok(['localhost','127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const roles = {admin:'TENANT_ADMIN',employee:'EMPLOYEE',manager:'MANAGER',hrbp:'HRBP'};
const slugs = ['documents','hr-service','employee-relations','policies','workflows','recruiting','onboarding','offboarding'];
const report = {healthy:[],faults:[],navigation:[],failures:[],scope:'Chromium and disposable PostgreSQL; selected generic renders and HR-service table outage, not every provider or business workflow'};
await mkdir('.audit', {recursive:true});
const browser = await chromium.launch();
async function identity(context, role) {
  const response = await context.request.get(origin+'/api/auth/session',{timeout:15000});
  assert.equal(response.status(),200);
  const session=await response.json();
  assert.equal(session.authenticated,true);assert.equal(session.user.id,`qa-audit-${role}`);assert.equal(session.user.role,roles[role]);
}
async function sessionFor(role, locale) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try {
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const login=await context.request.post(origin+'/api/auth/local',{
      headers:{origin,'content-type':'application/json'},data:{identifier:`audit.${role}`,password:process.env.HRBP_TEST_ADMIN_PASSWORD},timeout:15000
    });
    assert.equal(login.status(),200);
    await context.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);
    await context.addInitScript(selected=>localStorage.setItem('hrbp-locale',selected),locale);
    await identity(context,role);
    return context;
  } catch(error) {await context.close();throw error;}
}
async function healthy(page, role, slug) {
  const response=await page.goto(origin+'/module/'+slug,{waitUntil:'load',timeout:25000});
  assert.equal(response.status(),200);
  await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:10000});
  assert.equal(await page.locator('[data-module-workspace-state="unavailable"]').count(),0,'Error shell is not a successful render');
  assert.equal(await page.locator('.module-degraded-banner').count(),0,'Healthy generic paths must not substitute protected fallback');
  // A capability denial is an intentional read boundary, not a failed CRUD test.
  const module=page.locator('[data-module-workspace]');
  if(await module.count()) assert.ok(['rendered','restricted'].includes(await module.first().getAttribute('data-module-workspace-state')));
  await identity(page.context(),role);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
}
try {
  for(const role of Object.keys(roles)) for(const locale of ['en','tr']) {
    const context=await sessionFor(role,locale);
    try {
      const page=await context.newPage();
      for(const slug of slugs) {
        try {await healthy(page,role,slug);assert.equal(await page.evaluate(()=>document.documentElement.lang),locale);report.healthy.push({role,locale,slug,passed:true});}
        catch(error){const failure={role,locale,slug,passed:false,message:String(error.message).slice(0,300)};report.healthy.push(failure);report.failures.push(failure);}
      }
    }finally{await context.close();}
  }

  // Do not fault the identity store: this intentionally tests failure AFTER a
  // valid principal is resolved. Rename preserves table data and foreign keys.
  const admin=new pg.Client({connectionString,connectionTimeoutMillis:5000});
  await admin.connect();
  let renamed=false,locked=false;
  async function renameTable(restore) {
    await admin.query('BEGIN');
    try {
      await admin.query("SET LOCAL lock_timeout = '2s'");
      await admin.query("SET LOCAL statement_timeout = '5s'");
      await admin.query(restore
        ? 'ALTER TABLE public."_qa_hrservice_unavailable" RENAME TO "HRServiceRequest"'
        : 'ALTER TABLE public."HRServiceRequest" RENAME TO "_qa_hrservice_unavailable"');
      await admin.query('COMMIT');renamed=!restore;
    }catch(error){await admin.query('ROLLBACK');throw error;}
  }
  try {
    assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,'hrbp_audit');
    locked=(await admin.query('SELECT pg_try_advisory_lock(74193021) AS locked')).rows[0].locked;
    assert.equal(locked,true,'Another disposable outage test is already running');
    const before=(await admin.query('SELECT count(*)::int AS count FROM public."HRServiceRequest"')).rows[0].count;
    assert.equal((await admin.query(`SELECT to_regclass('public."_qa_hrservice_unavailable"') AS name`)).rows[0].name,null);
    for(const locale of ['en','tr']) {
      const context=await sessionFor('admin',locale);
      try {
        const page=await context.newPage();const address=origin+'/module/hr-service?q=qa-preserve-filter#request-detail';
        await renameTable(false);
        await page.goto(address,{waitUntil:'load',timeout:25000});
        await page.locator('[data-module-workspace-state="unavailable"]').waitFor({timeout:15000});
        await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:10000});
        await identity(context,'admin');
        const panel=page.locator('[data-module-workspace-state="unavailable"]');
        assert.equal(await panel.locator('table,form,input,select').count(),0);
        assert.equal(await page.locator('.page-content .services-metrics,.page-content .create-button').count(),0,'No sample business metrics or create actions survive the boundary');
        assert.equal(await panel.locator('h1').textContent(),locale==='tr'?'Çalışma alanı şu anda yüklenemiyor':'This workspace is temporarily unavailable');
        assert.doesNotMatch(await panel.innerText(),/HRServiceRequest|_qa_hrservice|P2021|SELECT|DATABASE_URL|disposable-audit-only/);
        assert.equal(page.url(),address);
        const reload=panel.locator('button');assert.equal(await reload.count(),1);
        assert.equal(await reload.isEnabled(),true);
        // Restore before the user's explicit reload; no request interception,
        // automatic app retries or fake responses are used to simulate recovery.
        await renameTable(true);
        await Promise.all([page.waitForEvent('load',{timeout:25000}),reload.click()]);
        await page.locator('[data-module-workspace="hr-service"][data-module-workspace-state="rendered"]').waitFor({timeout:15000});
        assert.equal(await page.locator('[data-module-workspace-state="unavailable"]').count(),0);
        assert.equal(page.url(),address);await identity(context,'admin');
        report.faults.push({locale,passed:true,principalRetained:true,urlPreserved:true,recoveredByExplicitReload:true});
      }finally{if(renamed)await renameTable(true);await context.close();}
    }
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM public."HRServiceRequest"')).rows[0].count,before,'Outage simulation must preserve service records');
    assert.equal((await admin.query(`SELECT to_regclass('public."_qa_hrservice_unavailable"') AS name`)).rows[0].name,null);
  } finally {
    try {if(renamed)await renameTable(true);if(locked)await admin.query('SELECT pg_advisory_unlock(74193021)');}
    finally {await admin.end();}
  }
  const context=await sessionFor('admin','en');
  try {
    for(const path of ['/module/not-a-real-hrbp-module','/module/__proto__']) {
      const response=await context.request.get(origin+path,{maxRedirects:0,timeout:15000});
      assert.equal(response.status(),404);report.navigation.push({path,status:response.status()});
    }
    const dashboard=await context.request.get(origin+'/module/dashboard',{maxRedirects:0,timeout:15000});
    assert.equal(dashboard.status(),307);assert.equal(dashboard.headers().location,'/');report.navigation.push({path:'/module/dashboard',status:307});
  }finally{await context.close();}
} catch(error) {
  report.failures.push({phase:'outage-or-route-validation',message:String(error.message).slice(0,300)});
} finally {
  await browser.close();await writeFile('.audit/module-workspace-browser.json',JSON.stringify(report,null,2));
  console.log('MODULE_WORKSPACE_BROWSER '+JSON.stringify(report));
}
assert.equal(report.healthy.length,64,'All eight generic modules, four roles and two locales must run');
assert.equal(report.faults.length,2,'Both real database-fault/recovery locale cases must pass');
assert.equal(report.navigation.length,3,'Unknown routes and dashboard canonicalization must pass');
assert.deepEqual(report.failures,[],'Generic workspace regression failed; inspect evidence before merge');
