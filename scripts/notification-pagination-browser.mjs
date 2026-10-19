/** Real notification pagination acceptance; separate synthetic tenant and loopback app.
 * Never starts a notification dispatcher or sends SMTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { createRetryTestBindings } from './notification-retry-fixture.mjs';
const database=new URL(process.env.DATABASE_URL||'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true');assert.ok(['postgres:','postgresql:'].includes(database.protocol));
assert.ok(['127.0.0.1','localhost'].includes(database.hostname));assert.equal(database.pathname,'/hrbp_audit');
const password=process.env.HRBP_TEST_ADMIN_PASSWORD;assert.ok(password);
const origin='http://localhost:3103',retryPath='/api/settings/notifications/retry',opsPath='/api/settings/notifications/operations',out='.audit/notification-pagination';
await mkdir(out,{recursive:true});
const db=new PrismaClient(),browser=await chromium.launch(),contexts=[];
const marker='qaretry'+randomUUID().replaceAll('-','').slice(0,12),tenantId=marker,foreignTenant=marker+'foreign',accounts={};
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tests:[],scope:'Production Next.js, signed sessions, Chromium and disposable PostgreSQL in a synthetic tenant.',limitations:['No dispatcher, SMTP, external notification delivery or production data.','Reviewed snapshots are not durable idempotency keys.','Only Chromium and listed scenarios; not universal module acceptance.']};
let child,sequence=0,trigger=false,removeBindings;
let setupStage='binding-lease';
const fn=marker+'_fault',trg=marker+'_trigger';
const snapshot=r=>({id:r.id,status:r.status,attempts:r.attempts,updatedAt:new Date(r.updatedAt).toISOString()});
const command=(items,mode='SINGLE')=>({commandId:randomUUID(),mode,items:items.map(snapshot)});
async function fixture(status='DEAD_LETTER',tenant=tenantId){const id=marker+'-'+(++sequence);return db.notificationOutbox.create({data:{id,tenantId:tenant,eventType:'QA_RETRY_'+sequence,channel:'IN_APP',resourceType:'QA',resourceId:id,dedupeKey:id,status,attempts:5,lastError:'PRIVATE_SENTINEL secret=do-not-display',payload:{synthetic:'PRIVATE_SENTINEL'},readAt:new Date('2026-01-01T00:00:00Z')}});}
async function context(role='TENANT_ADMIN',locale='en',theme='light',width=1280){
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});contexts.push(ctx);
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 if(role){
  setupStage='session-'+role;
  const r=await ctx.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier:accounts[role],password}});
  assert.equal(r.status(),200,'Synthetic session HTTP '+r.status());
  const response=await ctx.request.get(origin+'/api/auth/session');assert.equal(response.status(),200);
  const identity=await response.json();assert.equal(identity.authenticated,true);
  assert.equal(identity.user.id,accounts[role]);assert.equal(identity.user.tenantId,tenantId);assert.equal(identity.user.role,role);
 }
 await ctx.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);
 await ctx.addInitScript(({locale,theme})=>{localStorage.setItem('hrbp-locale',locale);localStorage.setItem('hrbp-theme',theme);},{locale,theme});return ctx;
}
const post=(ctx,data,headers={})=>ctx.request.post(origin+retryPath,{headers:{origin,...headers},data});
const current=id=>db.notificationOutbox.findUniqueOrThrow({where:{id}});
const auditCount=id=>db.auditEvent.count({where:{tenantId,resourceId:id,action:'settings.notification-requeued'}});
async function screen(ctx){const p=await ctx.newPage();await p.goto(origin+'/module/settings');await p.locator('[data-notification-operations]').waitFor();await p.locator('[data-notification-operations] table').waitFor();return p;}
async function check(name,fn){const t={name,passed:false};try{Object.assign(t,await fn(),{passed:true});}catch(e){t.error=String(e.message).replaceAll(password,'[redacted]').slice(0,900);}report.tests.push(t);console.log('NOTIFICATION_PAGINATION_SCENARIO '+JSON.stringify(t));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
async function removeFault(){await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trg}" ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);trigger=false;}
try{
 removeBindings=await createRetryTestBindings(process.cwd(),tenantId);
 setupStage='fixtures';
 const template=await db.userAccount.findUniqueOrThrow({where:{id:'user-local-test-admin'}});assert.ok(template.localPasswordHash);
 for(const id of [tenantId,foreignTenant])await db.tenant.create({data:{id,name:'Synthetic notification retry',region:'QA'}});
 for(const [role,suffix] of [['TENANT_ADMIN','a'],['HR_OPERATIONS','h'],['EMPLOYEE','e']]){const id=marker+'-'+suffix;assert.ok(id.length<=24,'Synthetic account id must remain short');accounts[role]=id;await db.userAccount.create({data:{id,tenantId,subject:id,email:id+'@example.test',displayName:'Synthetic '+role,role,active:true,localAuthEnabled:true,localPasswordHash:template.localPasswordHash}});}
 setupStage='application-start';
 const log=createWriteStream(out+'/server.log');
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3103'],{env:{...process.env,HRBP_AUTH_TENANT_ID:tenantId,HRBP_SMTP_ENABLED:'false'},stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);
 let ready=false;for(let n=0;n<40;n++){try{if((await fetch(origin+'/api/health/runtime')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Isolated app did not start');
 const admin=await context(),staff=await context('HR_OPERATIONS'),employee=await context('EMPLOYEE'),anonymous=await context(null);
 setupStage='scenarios';
 report.isolation={bindingLease:true,signedTenantAndRoleVerified:true,dispatcherStarted:false};

 const tied=new Date('2026-01-01T12:00:00.000Z');
 const failedIds=Array.from({length:205},(_,i)=>marker+'-f'+String(i).padStart(3,'0'));
 const pendingIds=Array.from({length:7},(_,i)=>marker+'-p'+String(i).padStart(3,'0'));
 const seedRow=(id,status,tenant=tenantId)=>({id,tenantId:tenant,eventType:'QA_PAGE',channel:'IN_APP',resourceType:'QA',resourceId:id,dedupeKey:id,status,attempts:3,createdAt:tied,updatedAt:tied,nextAttemptAt:tied,lastError:'PRIVATE_SENTINEL',payload:{secret:'PRIVATE_SENTINEL'}});
 await db.notificationOutbox.createMany({data:[...failedIds.map(id=>seedRow(id,'FAILED')),...pendingIds.map(id=>seedRow(id,'PENDING')),seedRow(marker+'-foreign','FAILED',foreignTenant)]});
 const url=(after=null,filter='FAILED',limit=100)=>origin+opsPath+`?status=${filter}&limit=${limit}&after=${encodeURIComponent(after??'')}`;
 const getPage=async(ctx=admin,after=null,filter='FAILED',limit=100)=>{const r=await ctx.request.get(url(after,filter,limit));assert.equal(r.status(),200);assert.match(r.headers()['cache-control'],/private.*no-store/);return (await r.json()).data;};
 const records=panel=>panel.locator('[data-notification-row]');
 async function pageRows(panel,count){await panel.page().waitForFunction(({count})=>document.querySelectorAll('[data-notification-operations] [data-notification-row]').length===count,{count});}
 async function failedView(ctx=admin){const p=await screen(ctx),panel=p.locator('[data-notification-operations]');await panel.getByRole('button',{name:/^Failed\s/}).click();await pageRows(panel,100);return {p,panel};}
 await check('API: 205 tied records paginate 100/100/5 without duplicates or foreign tenant rows',async()=>{let after=null;const seen=[];for(const n of [100,100,5]){const d=await getPage(admin,after);assert.equal(d.page.after,after);assert.equal(d.items.length,n);assert.equal(d.counts.failed,205);seen.push(...d.items.map(i=>i.id));after=d.page.next;}assert.equal(after,null);assert.deepEqual(seen,failedIds);assert.equal(new Set(seen).size,205);return {pages:[100,100,5],unique:205};});
 await check('API: status filter and true tenant counters apply on every page',async()=>{const d=await getPage(admin,null,'PENDING',5);assert.equal(d.items.length,5);assert.ok(d.items.every(i=>i.status==='PENDING'));assert.equal(d.counts.pending,7);assert.equal(d.counts.failed,205);const end=await getPage(admin,d.page.next,'PENDING',5);assert.equal(end.items.length,2);assert.equal(end.page.next,null);});
 await check('API: cursor cannot transfer actor, tenant, role, filter or limit scope',async()=>{const d=await getPage(),v=JSON.parse(d.page.next);for(const index of [1,2,3,4,5]){const changed=[...v];changed[index]=index===5?50:'foreign';const r=await admin.request.get(url(JSON.stringify(changed)));assert.equal(r.status(),400);assert.match(r.headers()['cache-control'],/no-store/);}assert.equal((await staff.request.get(url(d.page.next))).status(),400);assert.equal((await employee.request.get(url())).status(),403);assert.equal((await anonymous.request.get(url())).status(),401);});
 await check('API: legacy response stays capped, empty pages terminate and projections stay minimized',async()=>{const r=await admin.request.get(origin+opsPath+'?status=FAILED&limit=100');assert.equal(r.status(),200);const d=(await r.json()).data;assert.equal(d.items.length,100);assert.equal(d.page,undefined);const empty=await getPage(admin,null,'DEAD_LETTER');assert.equal(empty.items.length,0);assert.equal(empty.page.next,null);const str=JSON.stringify(await getPage());assert.ok(!str.includes('PRIVATE_SENTINEL'));assert.ok(!str.includes('recipientUserId'));assert.ok(!str.includes('payload'));});
 await check('UI: Older records opens all three pages and First page returns without a document reload',async()=>{const {p,panel}=await failedView();const markerId=randomUUID();await p.evaluate(id=>window.__pageMarker=id,markerId);const nav=panel.getByRole('navigation',{name:'Notification pages'});await nav.getByRole('button',{name:'Older records',exact:true}).click();await nav.getByRole('status').filter({hasText:'Page 2'}).waitFor();await panel.locator(`[data-notification-row="${failedIds[100]}"]`).waitFor();await nav.getByRole('button',{name:'Older records',exact:true}).click();await pageRows(panel,5);assert.ok(await nav.getByRole('button',{name:'Older records',exact:true}).isDisabled());await nav.getByRole('button',{name:'First page',exact:true}).click();await panel.locator(`[data-notification-row="${failedIds[0]}"]`).waitFor();assert.equal(await p.evaluate(()=>window.__pageMarker),markerId);await p.close();});
 await check('UI: changing status resets the cursor and Refresh returns to the latest page',async()=>{const {p,panel}=await failedView();const nav=panel.getByRole('navigation',{name:'Notification pages'});await nav.getByRole('button',{name:'Older records',exact:true}).click();await panel.locator(`[data-notification-row="${failedIds[100]}"]`).waitFor();await panel.getByRole('button',{name:/^Pending\s/}).click();await pageRows(panel,7);assert.ok(await nav.getByRole('button',{name:'First page',exact:true}).isDisabled());assert.ok(await nav.getByRole('button',{name:'Older records',exact:true}).isDisabled());await panel.getByRole('button',{name:/^Failed\s/}).click();await panel.locator(`[data-notification-row="${failedIds[0]}"]`).waitFor();await nav.getByRole('button',{name:'Older records',exact:true}).click();await panel.locator(`[data-notification-row="${failedIds[100]}"]`).waitFor();await panel.getByRole('button',{name:'Refresh',exact:true}).click();await panel.locator(`[data-notification-row="${failedIds[0]}"]`).waitFor();await p.close();});
 await check('UI: failed next-page read hides prior rows, disables paging and makes no automatic retry',async()=>{const {p,panel}=await failedView();let reads=0;await p.route('**/api/settings/notifications/operations?**',route=>{reads++;return route.fulfill({status:503,json:{error:'PRIVATE_SENTINEL'}});});await panel.getByRole('button',{name:'Older records',exact:true}).click();await panel.getByRole('alert').filter({hasText:'Records could not be verified'}).waitFor();assert.equal(await records(panel).count(),0);assert.ok(await panel.getByRole('button',{name:'Older records',exact:true}).isDisabled());await p.waitForTimeout(200);assert.equal(reads,1);assert.ok(!(await panel.innerText()).includes('PRIVATE_SENTINEL'));await p.close();});
 await check('UI: substituted first-page response cannot masquerade as the requested second page',async()=>{const {p,panel}=await failedView(),initial=await getPage();await p.route('**/api/settings/notifications/operations?**',route=>route.fulfill({status:200,json:{data:initial}}));await panel.getByRole('button',{name:'Older records',exact:true}).click();await panel.getByRole('alert').filter({hasText:'Records could not be verified'}).waitFor();assert.equal(await records(panel).count(),0);await p.close();});
 await check('UI: a retry from page two still posts only the reviewed row and records one audit',async()=>{const {p,panel}=await failedView();await panel.getByRole('button',{name:'Older records',exact:true}).click();const id=failedIds[120];const row=panel.locator(`[data-notification-row="${id}"]`);await row.waitFor();let sent;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(retryPath))sent=r.postDataJSON();});p.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Retry',exact:true}).click();await panel.getByRole('status').filter({hasText:'1 notifications requeued'}).waitFor();assert.equal(sent.mode,'SINGLE');assert.equal(sent.items.length,1);assert.equal(sent.items[0].id,id);assert.equal((await current(id)).status,'PENDING');assert.equal(await auditCount(id),1);await p.close();});
 await check('API: moving a cursor anchor does not require finding it again to read the following page',async()=>{const d=await getPage(),id=d.items.at(-1).id;await db.notificationOutbox.update({where:{id},data:{updatedAt:new Date()}});const next=await getPage(admin,d.page.next);assert.ok(next.items.length>0);assert.ok(!next.items.some(i=>i.id===id));assert.equal(next.page.after,d.page.next);});
 for(const[theme,width]of[['light',320],['dark',390]])await check(`UI: Turkish ${theme}/${width}px pagination controls fit and announce page state`,async()=>{const ctx=await context('TENANT_ADMIN','tr',theme,width),p=await screen(ctx),panel=p.locator('[data-notification-operations]');await panel.getByRole('button',{name:/^Bekliyor\s/}).click();await pageRows(panel,8);const nav=panel.getByRole('navigation',{name:'Bildirim sayfaları'});await nav.scrollIntoViewIfNeeded();const geometry=await nav.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,scroll:el.scrollWidth,client:el.clientWidth};});assert.ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1);assert.ok((await nav.innerText()).includes('Sayfa 1'));assert.ok(await nav.getByRole('button',{name:'Daha eski kayıtlar',exact:true}).isDisabled());await panel.screenshot({path:out+`/pagination-tr-${theme}-${width}.jpg`});await p.close();return {geometry,screenshot:`pagination-tr-${theme}-${width}.jpg`};});
}catch(error){
 // Record setup failure without dumping Prisma arguments or credential-bearing data.
 report.setupFailure={name:'Isolated retry acceptance could not complete',code:typeof error?.code==='string'&&/^P[0-9]{4}$/.test(error.code)?error.code:'SETUP_ERROR',completedCases:report.tests.length,stage:setupStage};
 console.error('NOTIFICATION_PAGINATION_SETUP '+JSON.stringify(report.setupFailure));process.exitCode=1;
}finally{
 if(trigger)await removeFault().catch(()=>{});
 await Promise.all(contexts.map(c=>c.close().catch(()=>{})));await browser.close();
 if(child&&child.exitCode===null&&child.signalCode===null){
  await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
 }
 try{await removeBindings?.();}catch{report.cleanupFailure='BINDING_LEASE_NOT_REMOVED';process.exitCode=1;}
 await db.$disconnect();
 report.summary={tests:report.tests.length,passed:report.tests.filter(t=>t.passed).length,failed:report.tests.filter(t=>!t.passed).length};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('NOTIFICATION_PAGINATION_SUMMARY '+JSON.stringify(report.summary));
}
if(report.tests.length!==12||report.tests.some(t=>!t.passed))process.exitCode=1;
