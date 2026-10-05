/** Employee form + real time APIs/PostgreSQL; response loss is injected only after commit. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100', path = '/module/time-attendance';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost','127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit'); assert.equal(database.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const report = { source: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), checks: [], failures: [],
  scope: 'Employee self-service EN desktop/TR mobile; real create/submit, disposable PostgreSQL, synthetic identities and controlled browser response failures. Not manager approval, payroll locking or external-provider QA.' };
const db = new PrismaClient(), browser = await chromium.launch({headless:true});
await mkdir('.audit',{recursive:true});
async function check(name, fn) {
  try { await fn(); report.checks.push({name,passed:true}); console.log('TIME_RECOVERY_PASS '+name); }
  catch(e) { report.checks.push({name,passed:false}); report.failures.push(name); throw e; }
}
try {
  const seed = await db.userAccount.findUniqueOrThrow({where:{id:'qa-audit-admin'}});
  for (const [locale,width] of [['en',1280],['tr',390]]) {
    async function principal(role) {
      const subject = `time-qa-${randomUUID()}`, email = subject+'@example.test';
      const person = await db.person.create({data:{tenantId:seed.tenantId,givenName:'Time QA',familyName:role,employeeNumber:subject,workEmail:email}});
      const employment = await db.employment.create({data:{tenantId:seed.tenantId,personId:person.id,status:'ACTIVE',startDate:new Date('2020-01-01')}});
      const user = await db.userAccount.create({data:{tenantId:seed.tenantId,subject,email,displayName:'Time QA '+role,role,active:true,localAuthEnabled:true,localPasswordHash:seed.localPasswordHash}});
      return {user,employment,subject};
    }
    const manager=await principal('MANAGER'), employee=await principal('EMPLOYEE');
    await db.employment.update({where:{id:employee.employment.id},data:{managerEmploymentId:manager.employment.id}});
    const context=await browser.newContext({viewport:{width,height:1000},locale:locale==='tr'?'tr-TR':'en-US',timezoneId:locale==='tr'?'Europe/Istanbul':'UTC'});
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    await context.addCookies([{name:'hrbp-locale',value:locale,url:origin,sameSite:'Lax'}]);
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const posts=[],errors=[];page.on('pageerror',e=>errors.push(e.name));
    page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/time/entries'))posts.push(new URL(r.url()).pathname);});
    const consoleView=page.locator('[data-time-console]'), form=consoleView.locator('form');
    const identity=async()=>{const r=await context.request.get(origin+'/api/auth/session');const b=await r.json();assert.equal(b.authenticated,true);assert.equal(b.user.id,employee.user.id);assert.equal(b.user.employmentId,employee.employment.id);};
    const date=(n)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    const fill=async n=>{await form.locator('[name=workDate]').fill(date(n));await form.locator('[name=minutes]').fill('480');await form.locator('[name=overtimeMinutes]').fill('30');};
    const entries=()=>db.timeEntry.findMany({where:{tenantId:seed.tenantId,employmentId:employee.employment.id},orderBy:{workDate:'asc'}});
    const audit=(id,action)=>db.auditEvent.count({where:{tenantId:seed.tenantId,resourceType:'TimeEntry',resourceId:id,action}});
    const reload=async()=>{await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),consoleView.locator('[data-time-reload]').click()]);await consoleView.waitFor();await identity();};
    let first;
    try {
      await check(`${locale}: real form login and employee binding`,async()=>{
        await page.goto(origin+'/auth/sign-in?returnTo='+encodeURIComponent(path),{waitUntil:'networkidle'});
        await page.locator('#local-identifier').fill(employee.subject);await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        await page.locator('.local-auth-card button[type=submit]').click();await page.waitForURL(origin+path);await consoleView.waitFor();await identity();
      });
      await check(`${locale}: create commits once despite same-turn clicks and lost receipt`,async()=>{
        await fill(1);const before=posts.length;
        const handler=async route=>{const response=await route.fetch();assert.equal(response.status(),201);await route.fulfill({status:201,contentType:'text/html',body:'<html>PRIVATE_FAULT</html>'});};
        await context.route(origin+'/api/time/entries',handler);
        await form.locator('[type=submit]').evaluate(el=>{el.click();el.click();});
        await consoleView.locator('[data-time-result=unknown]').waitFor();
        const rows=await entries();assert.equal(rows.length,1);first=rows[0];assert.equal(first.status,'DRAFT');assert.equal(first.minutes,480);
        assert.equal(await audit(first.id,'time-entry.self-created'),1);assert.equal(posts.length-before,1);
        assert.equal(await form.locator('[name=minutes]').inputValue(),'480');assert.equal(await form.locator('[type=submit]').isDisabled(),true);
        assert.ok(!(await consoleView.innerText()).includes('PRIVATE_FAULT'));await context.unroute(origin+'/api/time/entries',handler);
        await reload();assert.equal(posts.length-before,1);
      });
      await check(`${locale}: no schedule cannot submit draft`,async()=>{
        const button=consoleView.locator(`[data-time-entry-id="${first.id}"] [data-time-submit]`);assert.equal(await button.isDisabled(),true);
      });
      await check(`${locale}: active schedule allows submission; confirmation can be dismissed`,async()=>{
        const schedule=await db.workSchedule.create({data:{tenantId:seed.tenantId,code:`QT-${randomUUID()}`,name:'QA recovery',timezone:'UTC',weeklyMinutes:2400,effectiveFrom:new Date('2020-01-01'),active:true}});
        await db.workScheduleAssignment.create({data:{tenantId:seed.tenantId,employmentId:employee.employment.id,scheduleId:schedule.id,effectiveFrom:new Date('2020-01-01')}});
        await page.reload({waitUntil:'networkidle'});const before=posts.length;
        page.once('dialog',d=>d.dismiss());await consoleView.locator(`[data-time-entry-id="${first.id}"] [data-time-submit]`).click();assert.equal(posts.length,before);
      });
      await check(`${locale}: submission commits once before response loss; one manager notification`,async()=>{
        const endpoint=origin+`/api/time/entries/${first.id}/transition`,before=posts.length;
        const handler=async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');};
        await context.route(endpoint,handler);page.once('dialog',d=>d.accept());
        await consoleView.locator(`[data-time-entry-id="${first.id}"] [data-time-submit]`).evaluate(el=>{el.click();el.click();});
        await consoleView.locator('[data-time-result=unknown]').waitFor();
        const record=await db.timeEntry.findUniqueOrThrow({where:{id:first.id}});assert.equal(record.status,'SUBMITTED');assert.equal(record.approvedById,null);assert.equal(record.approvedAt,null);
        assert.equal(await audit(first.id,'time-entry.submitted'),1);assert.equal(posts.length-before,1);
        assert.equal(await db.notificationOutbox.count({where:{tenantId:seed.tenantId,resourceType:'TimeEntry',resourceId:first.id,eventType:'TIME_ENTRY_APPROVAL_REQUIRED',recipientUserId:manager.user.id}}),1);
        await context.unroute(endpoint,handler);
      });
      await check(`${locale}: explicit reload reads actual submitted record without replay`,async()=>{
        const before=posts.length;await reload();assert.equal(posts.length,before);assert.equal(await consoleView.locator(`[data-time-entry-id="${first.id}"] [data-time-submit]`).count(),0);
      });
      await check(`${locale}: explicit validation rejection preserves editable form`,async()=>{
        await fill(2);const handler=route=>route.fulfill({status:400,json:{error:'PRIVATE_REJECTION'}});
        await context.route(origin+'/api/time/entries',handler);await form.locator('[type=submit]').click();await consoleView.locator('[data-time-result=rejected]').waitFor();
        assert.equal(await form.locator('[name=minutes]').inputValue(),'480');assert.equal(await form.locator('[name=minutes]').isDisabled(),false);assert.equal((await entries()).length,1);
        assert.ok(!(await consoleView.innerText()).includes('PRIVATE_REJECTION'));await context.unroute(origin+'/api/time/entries',handler);
      });
      await check(`${locale}: corrected draft receipt resets input and cannot replay on refreshed props`,async()=>{
        const before=posts.length;await form.locator('[type=submit]').click();await consoleView.locator('[data-time-result=saved]').waitFor();assert.equal(await form.locator('[name=minutes]').inputValue(),'');
        assert.equal(await form.locator('[type=submit]').isDisabled(),true);assert.equal((await entries()).length,2);assert.equal(posts.length-before,1);await reload();assert.equal(posts.length-before,1);
      });
      await check(`${locale}: wrong receipt identity after commit is not success`,async()=>{
        await fill(3);const handler=async route=>{const response=await route.fetch();assert.equal(response.status(),201);const body=await response.json();body.data.employmentId='wrong-employee';await route.fulfill({status:201,json:body});};
        await context.route(origin+'/api/time/entries',handler);await form.locator('[type=submit]').click();await consoleView.locator('[data-time-result=unknown]').waitFor();
        assert.equal((await entries()).length,3);assert.equal(await form.locator('[name=minutes]').inputValue(),'480');assert.equal(await form.locator('[type=submit]').isDisabled(),true);await context.unroute(origin+'/api/time/entries',handler);
      });
      await check(`${locale}: no JavaScript crash, sized notices and preserved principal`,async()=>{
        assert.deepEqual(errors,[]);await identity();
        const fits=await consoleView.locator('[data-time-review]').evaluate(el=>{const r=el.getBoundingClientRect();return r.width<=innerWidth && el.scrollWidth<=el.clientWidth+2;});assert.equal(fits,true);
      });
    } finally {await context.close();}
  }
} catch(e) {report.failures.push(e instanceof Error?e.message:'Failure');process.exitCode=1;}
finally {await browser.close();await db.$disconnect();await writeFile('.audit/time-browser-regression.json',JSON.stringify(report,null,2));console.log('TIME_RECOVERY_REPORT',JSON.stringify({checks:report.checks.length,failures:report.failures}));}
