/** Actual policy assignment/exception form clicks, production Next.js and
 * persisted PostgreSQL rows. Guarded disposable loopback fixtures only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin='http://localhost:3100', database=new URL(process.env.DATABASE_URL||'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true');assert.ok(['postgres:','postgresql:'].includes(database.protocol));assert.ok(['localhost','127.0.0.1'].includes(database.hostname));assert.equal(database.pathname,'/hrbp_audit');
const password=process.env.HRBP_TEST_ADMIN_PASSWORD;assert.ok(password);
const out='.audit/policy-forms';await mkdir(out,{recursive:true});
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tests:[],scope:'Actual production Next.js, Chromium and disposable PostgreSQL. Form actions use signed local sessions. Fixtures are synthetic DB inserts.',limitations:['Not customer UAT or other browser coverage.','No create-policy UI, reminder delivery, revoke UI or automatic exception-to-waiver lifecycle is claimed.','UTC end-of-day dates are explicit; no tenant-timezone policy was added.','Client result guards survive mounted dialog close/reopen, not full navigation/session reconstruction.']};
const db=new PrismaClient(),browser=await chromium.launch(),contexts=[];
const marker='pfu-'+randomUUID().slice(0,8);let tenantId,ownEmployment,peerEmployment,sequence=0;
const authorId=marker+'-author',reviewerId=marker+'-reviewer',selfId=marker+'-self';
const label=(locale,en,tr)=>locale==='tr'?tr:en;
async function context(identifier,locale='en',theme='light',width=1440){
  const c=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});contexts.push(c);
  await c.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const r=await c.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier,password}});assert.equal(r.status(),200);
  const session=await(await c.request.get(origin+'/api/auth/session')).json();assert.equal(session.authenticated,true);
  await c.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);await c.addInitScript(({locale,theme})=>{localStorage.setItem('hrbp-locale',locale);localStorage.setItem('hrbp-theme',theme);},{locale,theme});return c;
}
async function ready(page){const r=await page.goto(origin+'/module/policies',{waitUntil:'load',timeout:25000});assert.equal(r.status(),200);await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:12000});await page.evaluate(()=>document.fonts.ready);}
const row=(page,p)=>page.locator(`[data-policy-id="${p.id}"]`);
async function open(page,p,kind,locale='en'){
  await ready(page);const button=row(page,p).getByRole('button',{name:kind==='assign'?label(locale,'Assign policy','Politika ata'):label(locale,'Request exception','İstisna talep et'),exact:true});await button.click();
  const d=page.getByRole('dialog',{name:kind==='assign'?label(locale,'Policy assignments','Politika atamaları'):label(locale,'Policy exception request','Politika istisna talebi'),exact:true});await d.waitFor();return d;
}
async function fixture(assignStatus=null){const code=marker+'-'+(++sequence),content='Synthetic policy form QA.';const p=await db.policyRecord.create({data:{tenantId,code,title:code,version:'1.0',ownerId:authorId,status:'PUBLISHED',contentMarkdown:content,contentHash:createHash('sha256').update(content).digest('hex'),effectiveFrom:new Date(Date.now()-86400000)}});if(assignStatus)await db.policyAssignment.create({data:{tenantId,policyId:p.id,employmentId:ownEmployment,status:assignStatus,dueAt:new Date('2099-01-01T00:00:00Z')}});return p;}
const assignments=p=>db.policyAssignment.findMany({where:{tenantId,policyId:p.id},orderBy:{employmentId:'asc'}});
const exceptions=p=>db.policyException.findMany({where:{tenantId,policyId:p.id}});
const audits=(id,action)=>db.auditEvent.count({where:{tenantId,resourceId:id,action}});
async function shot(page,name){const filename=name+'.jpg';await page.screenshot({path:`${out}/${filename}`,type:'jpeg',quality:80,fullPage:false});return filename;}
async function check(name,page,fn){try{report.tests.push({name,passed:true,...await fn()});}catch(error){report.tests.push({name,passed:false,error:String(error.message).replaceAll(password,'[redacted]').slice(0,600),screenshot:await shot(page,'failure-'+report.tests.length).catch(()=>null)});}console.log('POLICY_FORM_SCENARIO '+JSON.stringify(report.tests.at(-1)));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
async function selectPeer(d,locale='en'){await d.getByLabel(label(locale,'Search employees','Çalışan ara'),{exact:true}).fill(marker);await d.getByLabel(label(locale,`Select Synthetic ${marker}-peer`,`Synthetic ${marker}-peer seç`),{exact:true}).check();}
async function submit(page,d,labelText,path,status){page.once('dialog',x=>x.accept());const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST'),d.getByRole('button',{name:labelText,exact:true}).click()]);assert.equal(r.status(),status);return(await r.json()).data;}
try{
  const template=await db.userAccount.findUniqueOrThrow({where:{id:'user-local-test-admin'}});tenantId=template.tenantId;assert.ok(template.localPasswordHash);
  for(const[id,role]of[[authorId,'HR_OPERATIONS'],[reviewerId,'LEGAL'],[selfId,'EMPLOYEE']])await db.userAccount.create({data:{id,tenantId,subject:id,email:id+'@example.test',displayName:'Synthetic Policy Form QA',role,active:true,localAuthEnabled:true,localPasswordHash:template.localPasswordHash}});
  for(const suffix of ['self','peer']){const person=await db.person.create({data:{tenantId,employeeNumber:marker+'-'+suffix,givenName:'Synthetic',familyName:marker+'-'+suffix,workEmail:(suffix==='self'?selfId:marker+'-peer')+'@example.test'}});const e=await db.employment.create({data:{tenantId,personId:person.id,status:'ACTIVE',startDate:new Date(Date.now()-86400000)}});if(suffix==='self')ownEmployment=e.id;else peerEmployment=e.id;}
  const author=await context(authorId),self=await context(selfId),reviewer=await context(reviewerId);
  const ap=await author.newPage(),sp=await self.newPage(),rp=await reviewer.newPage();
  await check('assignment options: private scoped identity binding and unchanged write capability',ap,async()=>{const p=await fixture();const r=await author.request.get(`${origin}/api/policies/${p.id}/assignment-options`);assert.equal(r.status(),200);const b=await r.json();assert.equal(b.data.policyId,p.id);assert.equal(b.data.tenantId,tenantId);assert.match(r.headers()['cache-control'],/private/);assert.match(r.headers()['cache-control'],/no-store/);assert.match(r.headers().vary,/Cookie/i);assert.equal((await self.request.get(`${origin}/api/policies/${p.id}/assignment-options`)).status(),403);assert.equal((await assignments(p)).length,0);});
  await check('assignment form: invalid date and cancellation send no POST',ap,async()=>{const p=await fixture(),d=await open(ap,p,'assign');await selectPeer(d);await d.getByLabel('Due date (optional)',{exact:true}).fill('2000-01-01');let n=0;const listener=r=>{if(r.method()==='POST'&&r.url().endsWith('/assignments'))n++;};ap.on('request',listener);try{await d.getByRole('button',{name:'Assign selected',exact:true}).click();await d.getByRole('alert').waitFor();assert.equal(n,0);await d.getByLabel('Due date (optional)',{exact:true}).fill('2099-03-01');ap.once('dialog',x=>x.dismiss());await d.getByRole('button',{name:'Assign selected',exact:true}).click();assert.equal(n,0);assert.equal((await assignments(p)).length,0);}finally{ap.off('request',listener);}});
  await check('assignment form: confirmed selected employee persists; waiver and existing deadline survive',ap,async()=>{const p=await fixture('WAIVED'),before=await assignments(p),d=await open(ap,p,'assign');await selectPeer(d);await d.getByLabel('Due date (optional)',{exact:true}).fill('2099-03-01');const data=await submit(ap,d,'Assign selected',`/api/policies/${p.id}/assignments`,201);assert.equal(data.policyId,p.id);assert.equal(data.assigned,1);const after=await assignments(p);assert.deepEqual(after.find(e=>e.employmentId===ownEmployment),before[0]);assert.equal(after.find(e=>e.employmentId===peerEmployment).dueAt.toISOString(),'2099-03-01T23:59:59.000Z');assert.equal(await audits(p.id,'policy.assignments-created'),1);await ready(ap);assert.equal((await assignments(p)).length,2);});
  await check('assignment form: failed options read stops and requires explicit retry',ap,async()=>{const p=await fixture(),path=`**/api/policies/${p.id}/assignment-options`;let reads=0;await ap.route(path,r=>{reads++;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"PRIVATE_DETAIL"}'});});try{const d=await open(ap,p,'assign');await d.getByRole('alert').waitFor();assert.equal(await d.getByRole('button',{name:'Assign selected',exact:true}).isDisabled(),true);await ap.waitForTimeout(250);assert.equal(reads,1);assert.ok(!(await d.innerText()).includes('PRIVATE_DETAIL'));await ap.unroute(path);await d.getByRole('button',{name:'Refresh employees',exact:true}).click();await selectPeer(d);assert.equal(await d.getByRole('button',{name:'Assign selected',exact:true}).isDisabled(),false);}finally{await ap.unroute(path);}});
  await check('assignment form: a different policy options response cannot enable selection',ap,async()=>{const p=await fixture(),path=`**/api/policies/${p.id}/assignment-options`;await ap.route(path,async r=>{const response=await r.fetch(),b=await response.json();b.data.policyId='other-policy';await r.fulfill({response,body:JSON.stringify(b)});});try{const d=await open(ap,p,'assign');await d.getByRole('alert').waitFor();assert.equal(await d.getByRole('checkbox').count(),0);assert.equal((await assignments(p)).length,0);}finally{await ap.unroute(path);}});
  await check('assignment form: lost response after real commit remains blocked after dialog reopen/read',ap,async()=>{const p=await fixture(),d=await open(ap,p,'assign');await selectPeer(d);const path=`**/api/policies/${p.id}/assignments`;let writes=0;await ap.route(path,async r=>{writes++;const response=await r.fetch();assert.equal(response.status(),201);await r.abort('failed');});try{ap.once('dialog',x=>x.accept());await d.getByRole('button',{name:'Assign selected',exact:true}).click();await d.getByText('The result could not be confirmed.',{exact:false}).waitFor();const saved=await assignments(p);assert.equal(saved.length,1);await d.getByRole('button',{name:'Close',exact:true}).click();await row(ap,p).getByRole('button',{name:'Assign policy',exact:true}).click();await d.waitFor();await d.getByRole('button',{name:'Refresh employees',exact:true}).click();assert.equal(await d.getByRole('button',{name:'Assign selected',exact:true}).isDisabled(),true);assert.equal(writes,1);assert.deepEqual(await assignments(p),saved);assert.equal(await audits(p.id,'policy.assignments-created'),1);}finally{await ap.unroute(path);}});
  await check('exception form: required reason and past date reject locally; close retains draft',sp,async()=>{const p=await fixture('PENDING'),d=await open(sp,p,'request');await d.getByRole('button',{name:'Submit',exact:true}).click();await d.getByRole('alert').waitFor();await d.getByLabel('Business reason',{exact:true}).fill('Synthetic business reason');await d.getByLabel('Expiry date (optional)',{exact:true}).fill('2000-01-01');await d.getByRole('button',{name:'Submit',exact:true}).click();assert.equal((await exceptions(p)).length,0);await d.getByRole('button',{name:'Close',exact:true}).click();await row(sp,p).getByRole('button',{name:'Request exception',exact:true}).click();assert.equal(await d.getByLabel('Business reason',{exact:true}).inputValue(),'Synthetic business reason');await d.getByLabel('Expiry date (optional)',{exact:true}).fill('2099-03-01');sp.once('dialog',x=>x.dismiss());await d.getByRole('button',{name:'Submit',exact:true}).click();assert.equal((await exceptions(p)).length,0);});
  await check('exception form: selected expiry, own employment and one request audit persist without waiver',sp,async()=>{const p=await fixture('PENDING'),before=await assignments(p),d=await open(sp,p,'request');await d.getByLabel('Business reason',{exact:true}).fill('Synthetic business reason');await d.getByLabel('Compensating control (optional)',{exact:true}).fill('Synthetic control');await d.getByLabel('Expiry date (optional)',{exact:true}).fill('2099-03-01');const b=await submit(sp,d,'Submit',`/api/policies/${p.id}/exceptions`,201);assert.equal(b.employmentId,ownEmployment);const rows=await exceptions(p);assert.equal(rows.length,1);assert.equal(rows[0].requestedById,selfId);assert.equal(rows[0].expiresAt.toISOString(),'2099-03-01T23:59:59.000Z');assert.equal(await audits(rows[0].id,'policy.exception-requested'),1);assert.deepEqual(await assignments(p),before);await ready(sp);assert.equal((await exceptions(p)).length,1);});
  await check('exception form: dropped committed response preserves draft and prevents close/reopen replay',sp,async()=>{const p=await fixture('PENDING'),d=await open(sp,p,'request');await d.getByLabel('Business reason',{exact:true}).fill('Retained synthetic reason');const path=`**/api/policies/${p.id}/exceptions`;let writes=0;await sp.route(path,async r=>{writes++;const response=await r.fetch();assert.equal(response.status(),201);await r.abort('failed');});try{sp.once('dialog',x=>x.accept());await d.getByRole('button',{name:'Submit',exact:true}).click();await d.getByText('The result could not be confirmed.',{exact:false}).waitFor();const saved=await exceptions(p);assert.equal(saved.length,1);await d.getByRole('button',{name:'Close',exact:true}).click();await row(sp,p).getByRole('button',{name:'Request exception',exact:true}).click();assert.equal(await d.getByLabel('Business reason',{exact:true}).inputValue(),'Retained synthetic reason');assert.equal(await d.getByRole('button',{name:'Submit',exact:true}).isDisabled(),true);assert.equal(writes,1);assert.deepEqual(await exceptions(p),saved);}finally{await sp.unroute(path);}});
  for(const decision of ['APPROVE','REJECT'])await check(`exception decision form: independent ${decision} persists once without changing assignment`,rp,async()=>{const p=await fixture('PENDING'),before=await assignments(p),e=await db.policyException.create({data:{tenantId,policyId:p.id,employmentId:ownEmployment,requestedById:selfId,reason:'Synthetic decision request',status:'REQUESTED',active:false}});await ready(rp);const rr=rp.getByRole('row').filter({hasText:p.code}).filter({has:rp.getByRole('button',{name:'Approve',exact:true})});rp.once('dialog',x=>x.dismiss());await rr.getByRole('button',{name:decision==='APPROVE'?'Approve':'Reject',exact:true}).click();assert.equal((await exceptions(p))[0].status,'REQUESTED');await submit(rp,rr,decision==='APPROVE'?'Approve':'Reject',`/api/policies/${p.id}/exceptions/${e.id}/decision`,200);const saved=(await exceptions(p))[0];assert.equal(saved.status,decision==='APPROVE'?'APPROVED':'REJECTED');assert.equal(saved.approvedById,reviewerId);assert.equal(await audits(e.id,decision==='APPROVE'?'policy.exception-approved':'policy.exception-rejected'),1);assert.deepEqual(await assignments(p),before);});
  await check('exception decision form: requester has no own approve/reject buttons and API denies',rp,async()=>{const p=await fixture('PENDING'),e=await db.policyException.create({data:{tenantId,policyId:p.id,employmentId:ownEmployment,requestedById:reviewerId,reason:'Synthetic self decision forbidden',status:'REQUESTED',active:false}});await ready(rp);const rr=rp.getByRole('row').filter({hasText:p.code}).filter({hasText:'Requester cannot approve or reject'});assert.equal(await rr.count(),1);assert.equal(await rr.getByRole('button').count(),0);const r=await reviewer.request.post(`${origin}/api/policies/${p.id}/exceptions/${e.id}/decision`,{headers:{origin},data:{decision:'APPROVE'}});assert.equal(r.status(),403);assert.equal((await exceptions(p))[0].status,'REQUESTED');});
  await check('exception decision form: wrong-id reply after real commit is not reported as success',rp,async()=>{const p=await fixture('PENDING'),e=await db.policyException.create({data:{tenantId,policyId:p.id,employmentId:ownEmployment,requestedById:selfId,reason:'Synthetic mismatched response',status:'REQUESTED',active:false}});await ready(rp);const rr=rp.getByRole('row').filter({hasText:p.code}).filter({has:rp.getByRole('button',{name:'Approve',exact:true})}),path=`**/api/policies/${p.id}/exceptions/${e.id}/decision`;let writes=0;await rp.route(path,async r=>{writes++;const response=await r.fetch(),b=await response.json();b.data.id='wrong-id';await r.fulfill({response,body:JSON.stringify(b)});});try{rp.once('dialog',x=>x.accept());await rr.getByRole('button',{name:'Approve',exact:true}).click();await rr.getByText('The result could not be confirmed.',{exact:false}).waitFor();assert.equal(await rr.getByRole('button',{name:'Approve',exact:true}).isDisabled(),true);assert.equal(await rr.getByRole('button',{name:'Reject',exact:true}).isDisabled(),true);assert.equal((await exceptions(p))[0].status,'APPROVED');assert.equal(writes,1);assert.equal(await audits(e.id,'policy.exception-approved'),1);}finally{await rp.unroute(path);}});

  // The owning endpoint really commits first. Only the browser-facing reply is
  // changed, so the UI must not infer rollback or send another mutation.
  for (const altered of ['employees', 'deadline']) {
    await check(`assignment form: same-policy ${altered} mismatch after commit stays unconfirmed`, ap, async () => {
      const p = await fixture('WAIVED'), d = await open(ap, p, 'assign');
      const chosen = d.getByLabel(`Select Synthetic ${marker}-peer`, { exact: true });
      await chosen.check();
      await d.getByLabel('Due date (optional)', { exact: true }).fill('2099-03-01');
      const path = `**/api/policies/${p.id}/assignments`; let writes = 0;
      await ap.route(path, async route => {
        writes++;
        const response = await route.fetch(); assert.equal(response.status(), 201);
        const body = await response.json();
        assert.deepEqual(body.data.request, { employmentIds: [peerEmployment], dueAt: '2099-03-01T23:59:59.000Z' });
        if (altered === 'employees') body.data.request.employmentIds = [ownEmployment];
        else body.data.request.dueAt = '2099-03-02T23:59:59.000Z';
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      try {
        ap.once('dialog', prompt => prompt.accept());
        await d.getByRole('button', { name: 'Assign selected', exact: true }).click();
        await d.getByText('The result could not be confirmed.', { exact: false }).waitFor();
        const saved = await assignments(p);
        assert.equal(saved.filter(x => x.employmentId === peerEmployment).length, 1);
        assert.equal(saved.find(x => x.employmentId === ownEmployment).status, 'WAIVED');
        await d.getByRole('button', { name: 'Close', exact: true }).click();
        await row(ap, p).getByRole('button', { name: 'Assign policy', exact: true }).click();
        assert.equal(await d.getByRole('button', { name: 'Assign selected', exact: true }).isDisabled(), true);
        assert.equal(await d.getByLabel('Due date (optional)', { exact: true }).inputValue(), '2099-03-01');
        assert.equal(writes, 1); assert.equal(await audits(p.id, 'policy.assignments-created'), 1);
        assert.deepEqual(await assignments(p), saved);
      } finally { await ap.unroute(path); }
    });
  }
  for (const altered of ['reason', 'compensatingControl', 'expiresAt']) {
    await check(`exception form: same-principal ${altered} mismatch after commit preserves the draft`, sp, async () => {
      const p = await fixture('PENDING'), d = await open(sp, p, 'request');
      await d.getByLabel('Business reason', { exact: true }).fill('Original synthetic reason');
      await d.getByLabel('Compensating control (optional)', { exact: true }).fill('Original synthetic control');
      await d.getByLabel('Expiry date (optional)', { exact: true }).fill('2099-03-01');
      const path = `**/api/policies/${p.id}/exceptions`; let writes = 0;
      await sp.route(path, async route => {
        writes++;
        const response = await route.fetch(); assert.equal(response.status(), 201);
        const body = await response.json();
        body.data[altered] = altered === 'expiresAt' ? '2099-03-02T23:59:59.000Z' : 'Not the submitted text';
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      try {
        sp.once('dialog', prompt => prompt.accept());
        await d.getByRole('button', { name: 'Submit', exact: true }).click();
        await d.getByText('The result could not be confirmed.', { exact: false }).waitFor();
        const saved = await exceptions(p);
        assert.equal(saved.length, 1); assert.equal(saved[0].reason, 'Original synthetic reason');
        assert.equal(saved[0].compensatingControl, 'Original synthetic control');
        assert.equal(saved[0].expiresAt.toISOString(), '2099-03-01T23:59:59.000Z');
        await d.getByRole('button', { name: 'Close', exact: true }).click();
        await row(sp, p).getByRole('button', { name: 'Request exception', exact: true }).click();
        assert.equal(await d.getByLabel('Business reason', { exact: true }).inputValue(), 'Original synthetic reason');
        assert.equal(await d.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
        assert.equal(writes, 1); assert.equal(await audits(saved[0].id, 'policy.exception-requested'), 1);
        assert.deepEqual(await exceptions(p), saved);
      } finally { await sp.unroute(path); }
    });
  }
  for(const[locale,theme,width]of[['en','light',320],['en','dark',390],['tr','light',320],['tr','dark',390]]){
    const ac=await context(authorId,locale,theme,width),sc=await context(selfId,locale,theme,width),a=await ac.newPage(),s=await sc.newPage();
    await check(`forms: ${locale}/${theme}/${width}px labelled dialogs, keyboard focus and Escape`,a,async()=>{const p=await fixture('PENDING'),images=[];for(const[page,kind]of[[a,'assign'],[s,'request']]){const d=await open(page,p,kind,locale);if(kind==='assign'){await d.getByLabel(label(locale,'Search employees','Çalışan ara'),{exact:true}).fill(marker);await d.getByLabel(label(locale,`Select Synthetic ${marker}-peer`,`Synthetic ${marker}-peer seç`),{exact:true}).waitFor();}else await d.getByLabel(label(locale,'Business reason','İş gerekçesi'),{exact:true}).fill('Synthetic <b>plain text</b> reason');const size=await d.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(size.left>=0&&size.right<=size.width+1);assert.ok(size.scroll<=size.client+1,JSON.stringify(size));assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY),'hidden');const pageScroll=await page.evaluate(()=>scrollY);await page.mouse.move(1,999);await page.mouse.wheel(0,650);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>scrollY),pageScroll);for(const key of [...Array(40).fill('Tab'),...Array(40).fill('Shift+Tab')]){await page.keyboard.press(key);assert.equal(await d.evaluate(el=>el.contains(document.activeElement)),true);}images.push(await shot(page,`${kind}-${locale}-${theme}-${width}`));await page.keyboard.press('Escape');assert.equal(await d.isVisible(),false);const opener=row(page,p).getByRole('button',{name:kind==='assign'?label(locale,'Assign policy','Politika ata'):label(locale,'Request exception','İstisna talep et'),exact:true});assert.equal(await opener.evaluate(el=>el===document.activeElement),true);}return{screenshots:images};});
  }
}finally{for(const c of contexts)await c.close();await browser.close();await db.$disconnect();}
report.summary={tests:report.tests.length,passed:report.tests.filter(x=>x.passed).length,failed:report.tests.filter(x=>!x.passed).length};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('POLICY_FORM_SUMMARY '+JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
