/** Production application + real disposable PostgreSQL + loopback TLS SMTP
 * capture server. No external relay, mailbox or customer configuration is used. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:tls';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost','127.0.0.1'].includes(database.hostname));assert.equal(database.pathname,'/hrbp_audit');
const password=process.env.HRBP_TEST_ADMIN_PASSWORD;assert.ok(password);
const origin='http://localhost:3101',path='/api/settings/notifications/smtp-test',out='.audit/smtp-verification';
await mkdir(out,{recursive:true});const temp=await mkdtemp(join(tmpdir(),'hrbp-smtp-'));
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tests:[],
 scope:'Production Next.js + Chromium + disposable PostgreSQL + authenticated TLS SMTP on loopback only.',
 limitations:['No external provider, relay, mailbox arrival or delivery confirmation.','The 60-second reservation is not durable command idempotency.','SMTP acceptance cannot be rolled back by a later database failure.']};
const db=new PrismaClient(),browser=await chromium.launch(),contexts=[],accounts=[],sockets=new Set(),messages=[];
const marker='qasmtp'+randomUUID().replaceAll('-','').slice(0,12),smtpUser=marker,smtpPassword=randomUUID()+randomUUID();
let mode='accept',child,server,tenantId,trigger=false;
const fn=marker+'_fault',trg=marker+'_trigger';
async function injectAuditFault(actor,action){
 assert.match(actor,/^[a-z0-9-]+$/);assert.ok(['settings.smtp-test-requested','settings.smtp-test-succeeded'].includes(action));
 await db.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorId" = '${actor}' AND NEW."action" = '${action}' THEN RAISE EXCEPTION 'Synthetic SMTP audit failure'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER "${trg}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);trigger=true;
}
async function removeFault(){await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trg}" ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);trigger=false;}
async function account(role='TENANT_ADMIN'){
 const base=await db.userAccount.findUniqueOrThrow({where:{id:'user-local-test-admin'}});tenantId=base.tenantId;assert.ok(base.localPasswordHash);
 const id=marker+'-'+accounts.length;accounts.push(id);
 await db.userAccount.create({data:{id,tenantId,subject:id,email:id+'@example.test',displayName:'Synthetic SMTP administrator',role,active:true,localAuthEnabled:true,localPasswordHash:base.localPasswordHash}});
 return id;
}
async function context(id,locale='en',theme='light',width=1280){
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});contexts.push(ctx);
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 if(id){const login=await ctx.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier:id,password}});
  assert.equal(login.status(),200,`Synthetic local sign-in: ${login.status()} ${JSON.stringify(await login.json()).slice(0,300)}`);}
 await ctx.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);
 await ctx.addInitScript(({locale,theme})=>{localStorage.setItem('hrbp-locale',locale);localStorage.setItem('hrbp-theme',theme);},{locale,theme});
 return ctx;
}
async function post(ctx,extra={}){return ctx.request.post(origin+path,{headers:{origin,'x-hrbp-test-id':randomUUID(),...extra}});}
async function count(id,action){return db.auditEvent.count({where:{tenantId,actorId:id,action}});}
async function check(name,fn){let r={name,passed:false};try{Object.assign(r,await fn(),{passed:true});}catch(e){r.error=String(e.message).replaceAll(password,'[redacted]').replaceAll(smtpPassword,'[redacted]').slice(0,600);const page=contexts.at(-1)?.pages().at(-1);if(page){r.screenshot=`failure-${report.tests.length}.jpg`;await page.screenshot({path:out+'/'+r.screenshot,type:'jpeg',quality:80}).catch(()=>{delete r.screenshot;});}}report.tests.push(r);console.log('SMTP_VERIFICATION_SCENARIO '+JSON.stringify(r));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
 server=createServer({key:await readFile(join(temp,'key.pem')),cert:await readFile(join(temp,'cert.pem')),minVersion:'TLSv1.2'},socket=>{
  sockets.add(socket);socket.setEncoding('utf8');socket.setTimeout(30000,()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  let buffer='',authed=false,dataMode=false,recipient='',parts=[];const reply=s=>socket.write(s+'\r\n');reply('220 localhost synthetic SMTP');
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>131072){socket.destroy();return;}let i;
   while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
    if(dataMode){if(line==='.'){
      messages.push({recipient,content:parts.join('\n'),tls:socket.getProtocol()});dataMode=false;parts=[];
      if(mode==='drop')socket.destroy();else reply('250 2.0.0 Stored by synthetic capture server');
     }else parts.push(line);continue;}
    if(/^EHLO |^HELO /i.test(line))reply('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 65536');
    else if(/^AUTH PLAIN /i.test(line)){
      const auth=Buffer.from(line.slice(11),'base64').toString().split('\0');authed=auth[1]===smtpUser&&auth[2]===smtpPassword;reply(authed?'235 2.7.0 Authenticated':'535 5.7.8 Rejected');
    }else if(!authed)reply('530 5.7.0 Authentication required');
    else if(/^MAIL FROM:/i.test(line))reply('250 2.1.0 Ok');
    else if(/^RCPT TO:/i.test(line)){const m=/<([^>]+)>/.exec(line);recipient=m?.[1]||'';reply(recipient.endsWith('@example.test')?'250 2.1.5 Ok':'550 5.1.1 Synthetic recipients only');}
    else if(line==='DATA'){dataMode=true;reply('354 End with dot');}
    else if(line==='QUIT'){reply('221 Closing');socket.end();}
    else if(line==='RSET'||line==='NOOP')reply('250 Ok');else reply('500 Unsupported');
   }
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const logfile=createWriteStream(out+'/server.log');
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3101'],{env:{...process.env,
   APP_URL:origin,NODE_EXTRA_CA_CERTS:join(temp,'cert.pem'),HRBP_SMTP_ENABLED:'true',HRBP_SMTP_HOST:'127.0.0.1',HRBP_SMTP_TLS_SERVERNAME:'localhost',
   HRBP_SMTP_PORT:String(server.address().port),HRBP_SMTP_SECURE:'true',HRBP_SMTP_USERNAME:smtpUser,HRBP_SMTP_PASSWORD:smtpPassword,
   HRBP_SMTP_FROM:'sender@example.test',HRBP_NOTIFICATION_EMAIL_EVENTS:'SMTP_CONFIGURATION_TEST'},stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(logfile);child.stderr.pipe(logfile);let ready=false;
 for(let i=0;i<40;i++){if(child.exitCode!==null)throw Error('Isolated application exited');try{if((await fetch(origin+'/api/health/runtime')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'Isolated runtime not ready');
 await check('real TLS SMTP: own-account receipt is bound; arbitrary body recipient is ignored',async()=>{
  const id=await account(),ctx=await context(id),testId=randomUUID(),before=messages.length;
  const res=await ctx.request.post(origin+path,{headers:{origin,'x-hrbp-test-id':testId},data:{recipient:'not-allowed@example.test'}}),body=await res.json();
  assert.equal(res.status(),200);assert.equal(messages.length,before+1);assert.equal(messages.at(-1).recipient,id+'@example.test');assert.match(messages.at(-1).tls,/TLSv1\.[23]/);
  assert.equal(body.data.testId,testId);assert.equal(body.data.actorId,id);assert.equal(body.data.tenantId,tenantId);assert.equal(body.data.mailboxDeliveryConfirmed,false);assert.equal(body.data.auditRecorded,true);
  assert.equal(await count(id,'settings.smtp-test-requested'),1);assert.equal(await count(id,'settings.smtp-test-succeeded'),1);assert.match(res.headers()['cache-control'],/private.*no-store/);
  return {smtpMessages:1,mailboxDeliveryVerified:false};
 });
 await check('real PostgreSQL: eight concurrent tests send one message and seven 429 responses',async()=>{
  const id=await account(),ctx=await context(id),before=messages.length,rs=await Promise.all(Array.from({length:8},()=>post(ctx)));
  assert.equal(rs.filter(r=>r.status()===200).length,1);assert.equal(rs.filter(r=>r.status()===429).length,7);assert.equal(messages.length,before+1);
  assert.equal(await count(id,'settings.smtp-test-requested'),1);assert.equal(await count(id,'settings.smtp-test-succeeded'),1);
  for(const r of rs.filter(r=>r.status()===429))assert.equal(r.headers()['retry-after'],'60');return {requests:8,smtpMessages:1};
 });
 await check('actual SMTP accepted then outcome-audit failure returns 202 without false failed-send event',async()=>{
  const id=await account(),ctx=await context(id),before=messages.length;await injectAuditFault(id,'settings.smtp-test-succeeded');
  try{const r=await post(ctx),b=await r.json();assert.equal(r.status(),202);assert.equal(b.data.sent,true);assert.equal(b.data.auditRecorded,false);assert.equal(messages.length,before+1);assert.equal(await count(id,'settings.smtp-test-failed'),0);assert.equal((await post(ctx)).status(),429);}finally{await removeFault();}
 });
 await check('failed reservation audit prevents any SMTP connection/message',async()=>{
  const id=await account(),ctx=await context(id),before=messages.length;await injectAuditFault(id,'settings.smtp-test-requested');
  try{assert.equal((await post(ctx)).status(),503);assert.equal(messages.length,before);assert.equal(await count(id,'settings.smtp-test-requested'),0);}finally{await removeFault();}
 });
 await check('connection dropped after DATA is unknown and cannot immediately resend',async()=>{
  const id=await account(),ctx=await context(id),before=messages.length;mode='drop';
  try{const r=await post(ctx),b=await r.json();assert.equal(r.status(),502);assert.equal(b.code,'SMTP_TEST_RESULT_UNKNOWN');assert.equal(messages.length,before+1);assert.equal((await post(ctx)).status(),429);}finally{mode='accept';}
 });
 await check('anonymous, employee, foreign-origin and invalid-correlation calls cannot send',async()=>{
  const anon=await context(null),employee=await context(await account('EMPLOYEE')),admin=await context(await account()),before=messages.length;
  assert.equal((await post(anon)).status(),401);assert.equal((await post(employee)).status(),403);assert.equal((await post(admin,{origin:'https://untrusted.example.test'})).status(),403);assert.equal((await post(admin,{'x-hrbp-test-id':'bad'})).status(),400);assert.equal(messages.length,before);
 });
 async function settings(locale='en',theme='light',width=1280){const id=await account(),ctx=await context(id,locale,theme,width),page=await ctx.newPage();assert.equal((await page.goto(origin+'/module/settings',{waitUntil:'load',timeout:30000})).status(),200);await page.locator('.app-shell[data-session-loading="false"]').waitFor();const root=page.locator('[data-smtp-verification]');await root.waitFor();return{id,ctx,page,root};}
 const sendName=locale=>locale==='tr'?'Test e-postası gönder':'Send test email';
 async function clickSend(page,root,locale='en'){page.once('dialog',d=>d.accept());const [r]=await Promise.all([page.waitForResponse(r=>r.url()===origin+path&&r.request().method()==='POST'),root.getByRole('button',{name:sendName(locale),exact:true}).click()]);return r;}
 await check('settings UI: cancelled test never opens SMTP; confirmed test reports acceptance not mailbox delivery',async()=>{
  const {page,root}=await settings(),before=messages.length;page.once('dialog',d=>d.dismiss());await root.getByRole('button',{name:sendName('en'),exact:true}).click();assert.equal(messages.length,before);
  assert.equal((await clickSend(page,root)).status(),200);await root.getByRole('status').waitFor();assert.match(await root.innerText(),/mailbox delivery is not verified/);assert.equal(messages.length,before+1);assert.equal(await root.getByRole('button',{name:sendName('en'),exact:true}).isDisabled(),true);
 });
 for(const fault of ['correlation','upstream503'])await check(`settings UI: ${fault} after actual commit is unknown and not replayed`,async()=>{
  const {page,root}=await settings(),before=messages.length;
  await page.route('**/api/settings/notifications/smtp-test',async route=>{const response=await route.fetch();const b=await response.json();if(fault==='correlation'){b.data.testId=randomUUID();await route.fulfill({response,json:b});}else await route.fulfill({response,status:503,json:{error:'Synthetic upstream failure'}});});
  await clickSend(page,root);await root.getByRole('alert').waitFor();assert.match(await root.innerText(),/result is unknown/);assert.equal(messages.length,before+1);assert.equal(await root.getByRole('button',{name:sendName('en'),exact:true}).isDisabled(),true);
 });
 await check('settings UI: actual audit failure shows partial-success warning without another send',async()=>{
  const {id,page,root}=await settings(),before=messages.length;await injectAuditFault(id,'settings.smtp-test-succeeded');
  try{assert.equal((await clickSend(page,root)).status(),202);await root.getByRole('alert').waitFor();assert.match(await root.innerText(),/outcome audit/);assert.equal(messages.length,before+1);assert.equal(await count(id,'settings.smtp-test-failed'),0);}finally{await removeFault();}
 });
 for(const [locale,theme,width] of [['tr','light',320],['tr','dark',390]])await check(`settings UI: ${locale}/${theme}/${width}px translated accepted feedback and no control overflow`,async()=>{
  const {page,root}=await settings(locale,theme,width);assert.equal((await clickSend(page,root,locale)).status(),200);await root.getByRole('status').waitFor();assert.match(await root.innerText(),/teslim doğrulanmadı/);
  const geometry=await root.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,screen:innerWidth,overflow:el.scrollWidth-el.clientWidth};});
  assert.ok(geometry.left>=0&&geometry.right<=width+1&&geometry.overflow<=1,JSON.stringify(geometry));
  await root.scrollIntoViewIfNeeded();const screenshot=`smtp-${locale}-${theme}-${width}.jpg`;await page.screenshot({path:out+'/'+screenshot,type:'jpeg',quality:80});return{screenshot,geometry};
 });
}finally{
 if(trigger)await removeFault().catch(()=>{});await Promise.all(contexts.map(c=>c.close().catch(()=>{})));await browser.close();
 if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(()=>{child.kill('SIGKILL');r();},3000))]);}
 for(const socket of sockets)socket.destroy();if(server)await new Promise(r=>server.close(r));
 // Preserve audit ledger rows; only disposable account fixtures are removed.
 if(accounts.length)await db.userAccount.deleteMany({where:{id:{in:accounts},tenantId}}).catch(()=>{});await db.$disconnect();await rm(temp,{recursive:true,force:true});
 report.summary={tests:report.tests.length,passed:report.tests.filter(t=>t.passed).length,failed:report.tests.filter(t=>!t.passed).length};
 await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('SMTP_VERIFICATION_SUMMARY '+JSON.stringify(report.summary));
}
if(report.tests.length!==12||report.tests.some(t=>!t.passed))process.exitCode=1;
