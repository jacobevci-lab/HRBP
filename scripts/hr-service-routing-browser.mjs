/** Full application routing acceptance. Disposable localhost PostgreSQL only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
const origin='http://localhost:3100', url=new URL(process.env.DATABASE_URL||'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true'); assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/hrbp_audit');assert.ok(['postgres:','postgresql:'].includes(url.protocol));
const password=process.env.HRBP_TEST_ADMIN_PASSWORD;assert.ok(password);
const out='.audit/hr-service-routing';await mkdir(out,{recursive:true});
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tests:[],limitations:['Synthetic localhost fixtures, not live delivery or customer UAT.','Choices capped at 100 queues / 200 eligible staff; not global directory search.','No durable command idempotency, instant permission revocation or attachment workflow.']};
const db=new PrismaClient(),browser=await chromium.launch(),contexts=[],tickets=[],queues=[],users=[];
const marker='qaroute-'+randomUUID().slice(0,8),hr=marker+'-hr',agent=marker+'-agent',employee=marker+'-employee',bp=marker+'-bp',other=marker+'-other';
let tenantId,foreignTenant,qa,qb,qc,count=0;
const c=(locale,en,tr)=>locale==='tr'?tr:en;
async function ctx(id,locale='en',theme='light',width=1440){const x=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});contexts.push(x);await x.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());if(id)assert.equal((await x.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier:id,password}})).status(),200);await x.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);await x.addInitScript(({locale,theme})=>{localStorage.setItem('hrbp-locale',locale);localStorage.setItem('hrbp-theme',theme);},{locale,theme});return x;}
async function ticket(status='IN_PROGRESS',extra={}){const r=await db.hRServiceRequest.create({data:{tenantId,requestNumber:marker+'-'+(++count),requestorId:employee,category:'QA',title:'Synthetic routing '+count,description:'Synthetic fixture only',priority:'MEDIUM',status,queue:qa.key,...extra}});tickets.push(r.id);return r;}
async function queue(key,name,extra={}){const q=await db.hRServiceQueue.create({data:{tenantId,key:marker.toUpperCase()+'-'+key,name,createdById:hr,...extra}});queues.push(q.id);return q;}
const current=id=>db.hRServiceRequest.findUniqueOrThrow({where:{id}});
const path=t=>`/api/hr-service/requests/${t.id}`;
async function ready(page,t){const r=await page.goto(origin+'/module/hr-service?request='+encodeURIComponent(t.id),{waitUntil:'load',timeout:25000});assert.equal(r.status(),200);await page.locator('.app-shell[data-session-loading="false"]').waitFor();await page.evaluate(()=>document.fonts.ready);}
const button=(page,t,locale='en')=>page.locator(`[data-hr-service-routing="${t.id}"]`).getByRole('button',{name:c(locale,'Route / assign','Yönlendir / ata'),exact:true});
const dialog=(page,locale='en')=>page.getByRole('dialog',{name:c(locale,'Request routing','Talep yönlendirme'),exact:true});
async function opened(page,t,locale='en'){await ready(page,t);await button(page,t,locale).click();const d=dialog(page,locale);await d.getByLabel(c(locale,'Queue','Kuyruk'),{exact:true}).waitFor();return d;}
async function choose(d,q,id,locale='en'){await d.getByLabel(c(locale,'Queue','Kuyruk'),{exact:true}).selectOption(q||'');await d.getByLabel(c(locale,'Assignee','Sorumlu'),{exact:true}).waitFor();if(id)await d.getByLabel(c(locale,'Assignee','Sorumlu'),{exact:true}).selectOption(id);}
async function post(x,t,extra={}){const r=await x.request.post(origin+path(t)+'/status',{headers:{origin},data:{status:t.status,expectedUpdatedAt:t.updatedAt instanceof Date?t.updatedAt.toISOString():t.updatedAt,queue:qb.key,assigneeId:agent,...extra}});return {status:r.status(),body:await r.json()};}
async function save(page,d,t,locale='en'){page.once('dialog',x=>x.accept());const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path(t)+'/status'&&r.request().method()==='POST'),d.getByRole('button',{name:c(locale,'Save routing','Yönlendirmeyi kaydet'),exact:true}).click()]);return r;}
async function shot(page,name){await page.screenshot({path:out+'/'+name+'.jpg',type:'jpeg',quality:82});return name+'.jpg';}
async function check(name,page,fn){let row={name,passed:false};try{row={...row,...await fn(),passed:true};}catch(e){row.error=String(e.message).replaceAll(password,'[redacted]').slice(0,800);if(page)row.screenshot=await shot(page,'failure-'+report.tests.length).catch(()=>null);}report.tests.push(row);console.log('ROUTING_SCENARIO '+JSON.stringify(row));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
try{
 const template=await db.userAccount.findUniqueOrThrow({where:{id:'user-local-test-admin'}});tenantId=template.tenantId;assert.ok(template.localPasswordHash);
 foreignTenant=marker+'-tenant';await db.tenant.create({data:{id:foreignTenant,name:'Synthetic foreign routing',region:'QA'}});
 for(const [id,role,tid] of [[hr,'HR_OPERATIONS',tenantId],[agent,'HR_OPERATIONS',tenantId],[employee,'EMPLOYEE',tenantId],[bp,'HRBP',tenantId],[other,'HR_OPERATIONS',foreignTenant]]){await db.userAccount.create({data:{id,tenantId:tid,subject:id,email:id+'@example.test',displayName:'Synthetic '+id,role,active:true,localAuthEnabled:true,localPasswordHash:template.localPasswordHash}});users.push(id);}
 qa=await queue('A','Synthetic source queue');qb=await queue('B','Synthetic target queue');qc=await queue('C','Synthetic restricted queue');
 for(const [q,id] of [[qa,hr],[qa,bp],[qa,agent],[qb,hr],[qb,agent]])await db.hRServiceQueueMembership.create({data:{tenantId,queueId:q.id,userId:id,role:'AGENT'}});
 const staff=await ctx(hr),self=await ctx(employee),scoped=await ctx(bp),anonymous=await ctx(null),hp=await staff.newPage(),sp=await self.newPage();
 await check('options: anonymous and employee cannot read routing directory; employee has no route button',sp,async()=>{const t=await ticket();for(const [x,status]of[[anonymous,401],[self,403]]){const r=await x.request.get(origin+path(t)+'/routing-options');assert.equal(r.status(),status);assert.match(r.headers()['cache-control'],/private.*no-store/);}await ready(sp,t);assert.equal(await sp.locator(`[data-hr-service-routing="${t.id}"]`).count(),0);});
 await check('options: HRBP receives only delegated queues and active queue members',hp,async()=>{const t=await ticket();const r=await scoped.request.get(origin+path(t)+'/routing-options');assert.equal(r.status(),200);const data=(await r.json()).data;assert.ok(data.queues.some(q=>q.key===qa.key));assert.ok(!data.queues.some(q=>q.key===qb.key||q.key===qc.key));assert.ok(data.assignees.some(a=>a.id===agent));assert.ok(!JSON.stringify(data.assignees).includes('@example.test'));assert.equal((await scoped.request.get(origin+path(t)+'/routing-options?queue='+qc.key)).status(),404);const unqueued=await scoped.request.get(origin+path(t)+'/routing-options?queue=');assert.deepEqual((await unqueued.json()).data.assignees.map(a=>a.id),[bp]);});
 await check('options: foreign request cannot reveal queues or names even to service staff',hp,async()=>{const t=await ticket('OPEN',{tenantId:foreignTenant});const r=await staff.request.get(origin+path(t)+'/routing-options');assert.equal(r.status(),404);assert.equal((await r.json()).data,undefined);});
 await check('routing UI: selected queue and assignee persist with one routing audit and assignment intent',hp,async()=>{const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);const r=await save(hp,d,t);assert.equal(r.status(),200);const row=await current(t.id);assert.equal(row.queue,qb.key);assert.equal(row.assigneeId,agent);assert.equal(row.status,t.status);assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);assert.equal(await db.notificationOutbox.count({where:{tenantId,resourceId:t.id,eventType:'HR_SERVICE_ASSIGNED',recipientUserId:agent}}),1);assert.equal(await db.hRServiceStatusTransition.count({where:{requestId:t.id}}),0);await ready(hp,row);assert.ok((await hp.locator(`[data-hr-service-routing="${t.id}"]`).locator('..').innerText()).includes(qb.key));});
 await check('routing UI: cancelled confirmation keeps routing and produces no POST',hp,async()=>{const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);let writes=0;const on=r=>{if(r.method()==='POST'&&new URL(r.url()).pathname===path(t)+'/status')writes++;};hp.on('request',on);try{hp.once('dialog',m=>m.dismiss());await d.getByRole('button',{name:'Save routing',exact:true}).click();assert.equal(writes,0);assert.equal((await current(t.id)).queue,qa.key);}finally{hp.off('request',on);}});
 await check('routing UI: selecting another queue explicitly clears proposed assignee',hp,async()=>{const t=await ticket('OPEN',{assigneeId:agent}),d=await opened(hp,t);assert.equal(await d.getByLabel('Assignee',{exact:true}).inputValue(),agent);await choose(d,qb.key,null);assert.equal(await d.getByLabel('Assignee',{exact:true}).inputValue(),'');assert.equal((await current(t.id)).assigneeId,agent);});
 await check('routing UI: explicit removal clears both queue and assignee without altering lifecycle',hp,async()=>{const t=await ticket('IN_PROGRESS',{assigneeId:agent}),d=await opened(hp,t);await choose(d,null,null);assert.equal((await save(hp,d,t)).status(),200);const row=await current(t.id);assert.equal(row.queue,null);assert.equal(row.assigneeId,null);assert.equal(row.status,'IN_PROGRESS');});
 await check('routing API: foreign or inactive assignees and nonmembers are rejected without changing version',hp,async()=>{const t=await ticket();for(const assigneeId of [other,employee,bp])assert.equal((await post(staff,t,{assigneeId})).status,400);assert.deepEqual(await current(t.id),t);});
 await check('routing-only waiting/resolved records preserve first-response, SLA, escalation and resolution evidence',hp,async()=>{for(const status of ['WAITING_EMPLOYEE','RESOLVED']){const time=new Date('2026-01-01');const t=await ticket(status,{resolvedAt:status==='RESOLVED'?time:null,firstResponseAt:null,slaDueAt:time,escalationLevel:2,escalatedAt:time,escalationReason:'Synthetic retained evidence'});assert.equal((await post(staff,t)).status,200);const row=await current(t.id);for(const field of ['status','firstResponseAt','slaDueAt','resolvedAt','escalationLevel','escalatedAt','escalationReason'])assert.deepEqual(row[field],t[field],field);assert.equal(await db.hRServiceStatusTransition.count({where:{requestId:t.id}}),0);}});
 await check('terminal requests expose no route controls and reject direct routing changes',hp,async()=>{for(const status of ['CLOSED','CANCELLED']){const t=await ticket(status);await ready(hp,t);assert.equal(await hp.locator(`[data-hr-service-routing="${t.id}"]`).count(),0);assert.equal((await post(staff,t)).status,409);assert.deepEqual(await current(t.id),t);}});
 await check('routing UI: stale displayed version rejects write and preserves winning routing',hp,async()=>{const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);assert.equal((await post(staff,t,{queue:null,assigneeId:null})).status,200);assert.equal((await save(hp,d,t)).status(),409);await d.getByRole('alert').waitFor();assert.equal((await current(t.id)).queue,null);assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);});
 for(const fault of ['lost','target'])await check('routing UI: '+fault+' reply after real commit blocks duplicate submission after reopening',hp,async()=>{const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);const pattern='**'+path(t)+'/status';let writes=0;await hp.route(pattern,async route=>{writes++;const response=await route.fetch();assert.equal(response.status(),200);if(fault==='lost')await route.abort('failed');else{const body=await response.json();body.data.writeReceipt.assigneeId=hr;await route.fulfill({response,body:JSON.stringify(body)});}});try{hp.once('dialog',m=>m.accept());await d.getByRole('button',{name:'Save routing',exact:true}).click();await d.getByText(/result could not be confirmed/).waitFor();await d.getByRole('button',{name:'Close',exact:true}).click();await button(hp,t).click();await dialog(hp).getByRole('alert').first().waitFor();assert.equal(writes,1);assert.equal((await current(t.id)).assigneeId,agent);assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);}finally{await hp.unroute(pattern);}});
 await check('routing UI: failed read stops and explicit read retry restores only authorized choices',hp,async()=>{const t=await ticket(),pattern='**'+path(t)+'/routing-options';let reads=0;await hp.route(pattern,r=>{reads++;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"PRIVATE_DATABASE"}'});});try{await ready(hp,t);await button(hp,t).click();const d=dialog(hp);await d.getByRole('alert').waitFor();assert.equal(reads,1);assert.ok(!(await d.innerText()).includes('PRIVATE_DATABASE'));await hp.unroute(pattern);await d.getByRole('button',{name:'Reload choices',exact:true}).click();await d.getByLabel('Queue',{exact:true}).waitFor();}finally{await hp.unroute(pattern);}});
 await check('routing UI: wrong viewer identity never renders candidate names',hp,async()=>{const t=await ticket(),pattern='**'+path(t)+'/routing-options';await hp.route(pattern,async route=>{const response=await route.fetch(),body=await response.json();body.data.viewer.actorId='other';body.data.assignees=[{id:agent,displayName:'MUST_NOT_RENDER'}];await route.fulfill({response,body:JSON.stringify(body)});});try{await ready(hp,t);await button(hp,t).click();const d=dialog(hp);await d.getByRole('alert').waitFor();assert.ok(!(await d.innerText()).includes('MUST_NOT_RENDER'));assert.equal(await d.locator('select').count(),0);}finally{await hp.unroute(pattern);}});
 await check('routing API: eight same-version assignments commit one target and one audit',hp,async()=>{const t=await ticket(),results=await Promise.all(Array.from({length:8},()=>post(staff,t)));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,7);assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);});
 for(const [locale,theme,width]of[['en','light',320],['en','dark',390],['tr','light',320],['tr','dark',390]])await check(`routing UI: ${locale}/${theme}/${width}px geometry, focus, Escape and opaque theme`,hp,async()=>{const x=await ctx(hr,locale,theme,width),p=await x.newPage(),t=await ticket(),d=await opened(p,t,locale);await choose(d,qb.key,agent,locale);const geometry=await d.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{left:r.left,right:r.right,width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth,background:s.backgroundColor,bodyOverflow:getComputedStyle(document.body).overflow};});assert.ok(geometry.left>=0&&geometry.right<=width&&geometry.scroll<=geometry.client+1);assert.notEqual(geometry.background,'rgba(0, 0, 0, 0)');assert.equal(geometry.bodyOverflow,'hidden');for(const key of ['Tab','Shift+Tab'])for(let i=0;i<12;i++){await p.keyboard.press(key);assert.equal(await d.evaluate(el=>el.contains(document.activeElement)),true);}const screenshot=await shot(p,`routing-${locale}-${theme}-${width}`);await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(await button(p,t,locale).evaluate(el=>el===document.activeElement),true);return{screenshot,geometry};});
 // Continuation: no document navigation or POST replay is needed after a
 // confirmed route, but only its freshly reauthorized exact receipt may rearm.
 async function reopenAfterSave(page, t, d, locale='en') {
   // A successful receipt does not imply router.refresh committed new props.
   // Explicitly close/open if still visible; either path performs a new GET.
   const message=page.locator(`[data-hr-service-routing="${t.id}"]`).getByRole('status');
   await message.waitFor();
   if (await d.isVisible()) await d.getByRole('button',{name:c(locale,'Close','Kapat'),exact:true}).click();
   await button(page,t,locale).click();
   return dialog(page,locale);
 }
 for(const [locale,theme] of [['en','light'],['tr','dark']]) {
   await check(`routing recovery: ${locale} prepares a second verified route without reloading the document`,hp,async()=>{
     const x=await ctx(hr,locale,theme,390),p=await x.newPage(),t=await ticket(),d=await opened(p,t,locale);
     const sentinel=marker+'-document-'+locale;
     await p.evaluate(value=>{window.__routingDocumentIdentity=value;},sentinel);
     await choose(d,qb.key,agent,locale);
     assert.equal((await save(p,d,t,locale)).status(),200);
     const committed=await current(t.id);
     const fresh=await reopenAfterSave(p,t,d,locale);
     await fresh.getByLabel(c(locale,'Queue','Kuyruk'),{exact:true}).waitFor();
     const prepare=fresh.getByRole('button',{name:c(locale,'Prepare new routing','Yeni yönlendirme hazırla'),exact:true});
     assert.equal(await prepare.isEnabled(),true);
     assert.equal(await fresh.getByRole('button',{name:c(locale,'Save routing','Yönlendirmeyi kaydet'),exact:true}).isDisabled(),true);
     assert.equal(await p.evaluate(()=>window.__routingDocumentIdentity),sentinel);
     await prepare.scrollIntoViewIfNeeded();
     const screenshot=await shot(p,`routing-recovery-${locale}-${theme}-390`);
     await prepare.click();
     assert.equal((await current(t.id)).updatedAt.toISOString(),committed.updatedAt.toISOString());
     assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);
     await fresh.getByLabel(c(locale,'Assignee','Sorumlu'),{exact:true}).selectOption('');
     const second=await save(p,fresh,t,locale);
     assert.equal(second.status(),200);
     assert.equal(second.request().postDataJSON().expectedUpdatedAt,committed.updatedAt.toISOString());
     const final=await current(t.id);
     assert.equal(final.queue,qb.key);assert.equal(final.assigneeId,null);assert.equal(final.status,t.status);
     assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),2);
     assert.equal(await db.hRServiceStatusTransition.count({where:{requestId:t.id}}),0);
     assert.equal(await db.notificationOutbox.count({where:{tenantId,resourceId:t.id,eventType:'HR_SERVICE_ASSIGNED'}}),1);
     assert.equal(await p.evaluate(()=>window.__routingDocumentIdentity),sentinel);
     return{screenshot};
   });
 }
 await check('routing recovery: denied options after committed assignment cannot enable another write',hp,async()=>{
   const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);
   assert.equal((await save(hp,d,t)).status(),200);
   const committed=await current(t.id),pattern='**'+path(t)+'/routing-options';
   await hp.route(pattern,r=>r.fulfill({status:403,contentType:'application/json',body:'{"error":"Denied"}'}));
   try{
     const fresh=await reopenAfterSave(hp,t,d);
     await fresh.getByText(/Choices could not be verified/).waitFor();
     assert.equal(await fresh.getByRole('button',{name:'Prepare new routing',exact:true}).isDisabled(),true);
     assert.equal(await fresh.locator('select').count(),0);
     assert.deepEqual(await current(t.id),committed);
     assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);
   }finally{await hp.unroute(pattern);}
 });
 await check('routing recovery: substituted same-revision targets cannot rearm a confirmed write',hp,async()=>{
   const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);
   assert.equal((await save(hp,d,t)).status(),200);
   const committed=await current(t.id),pattern='**'+path(t)+'/routing-options';
   await hp.route(pattern,async route=>{const response=await route.fetch(),body=await response.json();
     body.data.request.assigneeId=null;await route.fulfill({response,body:JSON.stringify(body)});});
   try{
     const fresh=await reopenAfterSave(hp,t,d);await fresh.getByLabel('Assignee',{exact:true}).waitFor();
     assert.equal(await fresh.getByRole('button',{name:'Prepare new routing',exact:true}).isDisabled(),true);
     assert.equal(await fresh.getByRole('button',{name:'Save routing',exact:true}).isDisabled(),true);
     assert.deepEqual(await current(t.id),committed);
     assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),1);
   }finally{await hp.unroute(pattern);}
 });
 await check('routing recovery: a newer independent routing change requires full review rather than reusing old proof',hp,async()=>{
   const t=await ticket(),d=await opened(hp,t);await choose(d,qb.key,agent);
   assert.equal((await save(hp,d,t)).status(),200);
   await hp.locator(`[data-hr-service-routing="${t.id}"]`).getByRole('status').waitFor();
   if (await d.isVisible()) await d.getByRole('button',{name:'Close',exact:true}).click();
   const saved=await current(t.id);
   assert.equal((await post(staff,saved,{queue:qa.key,assigneeId:null})).status,200);
   const moved=await current(t.id);
   // Existing server locale action refreshes props, not the whole document.
   await hp.getByRole('group',{name:'Language',exact:true}).getByRole('button',{name:'TR',exact:true}).click();
   await button(hp,t,'tr').click();
   const fresh=dialog(hp,'tr');await fresh.getByLabel('Kuyruk',{exact:true}).waitFor();
   assert.equal(await fresh.getByLabel('Kuyruk',{exact:true}).inputValue(),qa.key);
   assert.equal(await fresh.getByRole('button',{name:'Yeni yönlendirme hazırla',exact:true}).isDisabled(),true);
   assert.equal(await fresh.getByRole('button',{name:'Yönlendirmeyi kaydet',exact:true}).isDisabled(),true);
   assert.deepEqual(await current(t.id),moved);
   assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:t.id,action:'hr-service.routing-updated'}}),2);
 });
}finally{
 await Promise.all(contexts.map(x=>x.close().catch(()=>{})));await browser.close();
 if(tickets.length){await db.notificationOutbox.deleteMany({where:{resourceId:{in:tickets},tenantId}}).catch(()=>{});await db.hRServiceRequest.deleteMany({where:{id:{in:tickets}}}).catch(()=>{});}
 if(queues.length)await db.hRServiceQueue.deleteMany({where:{id:{in:queues}}}).catch(()=>{});
 if(users.length)await db.userAccount.deleteMany({where:{id:{in:users}}}).catch(()=>{});
 if(foreignTenant)await db.tenant.deleteMany({where:{id:foreignTenant}}).catch(()=>{});await db.$disconnect();
 report.summary={tests:report.tests.length,passed:report.tests.filter(t=>t.passed).length,failed:report.tests.filter(t=>!t.passed).length};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('ROUTING_SUMMARY '+JSON.stringify(report.summary));
}
if(report.tests.length!==25||report.tests.some(t=>!t.passed))process.exitCode=1;
