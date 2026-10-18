/** Execute real route/provider/UI sources with controlled dependencies. Network
 * and PostgreSQL acceptance are separate in smtp-verification-browser.mjs. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(output.diagnostics.filter(d => d.category === 1).length, 0);
  const m = { exports: {} };
  new Function('module', 'exports', 'require', output.outputText)(m, m.exports, n => { assert.ok(n in mocks, n); return mocks[n]; });
  return m.exports;
}
const roles = readFileSync('prisma/schema.prisma', 'utf8').match(/enum PlatformRole \{([\s\S]*?)\}/)[1].trim().split(/\s+/);
const values = list => Object.fromEntries(list.map(v => [v, v]));
const enums = { PlatformRole: values(roles), DataClassification: values(['PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED','HIGHLY_RESTRICTED']),
  Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } };
const auth = compile('lib/authorization.ts', { '@prisma/client': enums });
const config = { HRBP_SMTP_FROM: 'sender@example.test', HRBP_SMTP_HOST: 'localhost', HRBP_SMTP_USERNAME: 'synthetic', HRBP_SMTP_PASSWORD: 'synthetic-long-password' };
const runtime = { runtimeString: n => config[n], runtimeNumber: (_n,v) => v, runtimeBoolean: (_n,v) => v };
const provider = compile(process.env.SMTP_PROVIDER_SOURCE || 'lib/smtp-notification-provider.ts', {
  nodemailer: { default: { createTransport() { throw Error('Unexpected real network'); } } }, '@prisma/client': enums,
  '@/lib/notification-display': { notificationDisplayTitle: () => 'Synthetic test', notificationDisplayResourceHref: () => '/', notificationDisplaySummary: () => 'Synthetic content' },
  '@/lib/notification-email-config': { smtpConfigurationStatus: () => ({ enabled:true, configured:true }) }, '@/lib/runtime-env': runtime
});
const message = { outboxId: 'test-id',tenantId:'tenant-a',eventType:'SMTP_CONFIGURATION_TEST',recipient:'Admin@Example.test',resourceType:'Settings',resourceId:'tenant-a',classification:'INTERNAL',payload:null };
for (const cleanup of ['throw','reject']) test(`provider: ${cleanup} during cleanup cannot undo accepted SMTP`, async () => {
  let sends=0;
  const result=await provider.sendSmtpNotification(message,{createTransport: options=>{
    assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.requireTLS,true);
    return { sendMail:async data=>{sends++;assert.equal(data.disableFileAccess,true);assert.equal(data.disableUrlAccess,true);return {accepted:['admin@example.test'],rejected:[]};},
      close(){if(cleanup==='throw')throw Error('CLEANUP_PRIVATE');return Promise.reject(Error('CLEANUP_PRIVATE'));} };
  }});assert.equal(result.accepted,1);assert.equal(sends,1);
});
test('provider: cleanup cannot replace the original bounded delivery error',async()=>{
  await assert.rejects(()=>provider.sendSmtpNotification(message,{createTransport:()=>({sendMail:async()=>{throw Error('CREDENTIAL_PRIVATE');},close(){throw Error('CLEANUP_PRIVATE');}})}),{message:'SMTP_DELIVERY_FAILED'});
});
for (const accepted of [[],['other@example.test'],['admin@example.test','other@example.test']]) test('provider: only the intended accepted address counts '+JSON.stringify(accepted),async()=>{
  await assert.rejects(()=>provider.sendSmtpNotification(message,{createTransport:()=>({sendMail:async()=>({accepted,rejected:[]}),close(){}})}),{message:'SMTP_RECIPIENT_REJECTED'});
});
function routeHarness({role='TENANT_ADMIN',origin=true,configured=true,recent=false,userRole=role,email='administrator@example.test',active=true,fault=null}={}){
  const ctx=role?{tenantId:'tenant-a',actorId:'admin-a',role}:null, audits=[],calls=[];
  let tail=Promise.resolve(),activeTx=0;
  const readUser=async()=> active?{id:'admin-a',email,role:userRole}:null;
  const findRecent=async()=>recent||audits.some(a=>a.action==='settings.smtp-test-requested')?{id:'recent'}:null;
  const db={userAccount:{findFirst:readUser},auditEvent:{findFirst:findRecent},$transaction:async(fn,options)=>{
    let release;const staged=[];activeTx++;
    const tx={userAccount:db.userAccount,auditEvent:db.auditEvent,staged,$queryRaw:async(strings,...args)=>{
      calls.push('lock');assert.match(strings.join('?'),/FOR UPDATE/);assert.deepEqual(args,['admin-a','tenant-a']);
      assert.equal(options.isolationLevel,'ReadCommitted');const wait=tail;tail=new Promise(r=>release=r);await wait;
    }};
    try { const r=await fn(tx);audits.push(...staged);return r; } finally {activeTx--;release?.();}
  }};
  const route=compile(process.env.SMTP_ROUTE_SOURCE||'app/api/settings/notifications/smtp-test/route.ts',{
    'node:crypto':{randomUUID},'@prisma/client':enums,'@/lib/db':{db},'@/lib/authorization':auth,
    '@/lib/notification-email-config':{smtpConfigurationStatus:()=>({enabled:configured,configured,missing:['DO_NOT_EXPOSE']})},
    '@/lib/request-context':{getRequestContext:async()=>ctx,mutationOriginAllowed:()=>origin,unauthorized:()=>Response.json({}, {status:401})},
    '@/lib/smtp-notification-provider':{validEmailAddress:provider.validEmailAddress,sendSmtpNotification:async data=>{calls.push('smtp');if(fault==='smtp')throw Error('SECRET_PROVIDER');return {accepted:1};}},
    '@/lib/audit':{appendAudit:async(tx,_ctx,data)=>{
      calls.push(data.action);
      if(fault===data.action)throw Error('SECRET_AUDIT');tx.staged.push(data);return {id:'audit-'+tx.staged.length};
    }}
  });
  return {audits,calls,async send({id=randomUUID(),body}={}){
    const req=new Request('http://localhost/api/settings/notifications/smtp-test',{method:'POST',headers:id===null?{}:{'x-hrbp-test-id':id},...(body?{body:JSON.stringify(body)}:{})});
    const res=await route.POST(req);return {res,body:await res.json(),id};
  }};
}
for(const c of [{role:null,status:401},{role:'EMPLOYEE',status:403},{origin:false,status:403}])test('route: access denied before any send '+JSON.stringify(c),async()=>{
 const h=routeHarness(c),r=await h.send();assert.equal(r.res.status,c.status);assert.deepEqual(h.calls,[]);assert.match(r.res.headers.get('cache-control')||'',/private.*no-store/);
});
test('route: configuration failure is private and excludes missing-secret metadata',async()=>{
 const h=routeHarness({configured:false}),r=await h.send();assert.equal(r.res.status,409);assert.ok(!JSON.stringify(r.body).includes('DO_NOT_EXPOSE'));assert.deepEqual(h.calls,[]);
});
for(const id of ['', 'not-a-uuid','01234567-1234-1234-1234-012345678901'])test('route: rejects malformed correlation '+JSON.stringify(id),async()=>{
 const h=routeHarness(),r=await h.send({id});assert.equal(r.res.status,400);assert.deepEqual(h.calls,[]);
});
test('route: eight concurrent requests reserve once, not eight independent sends',async()=>{
 const h=routeHarness(),rs=await Promise.all(Array.from({length:8},()=>h.send()));
 assert.equal(rs.filter(r=>r.res.status===200).length,1);assert.equal(rs.filter(r=>r.res.status===429).length,7);
 assert.equal(h.calls.filter(c=>c==='smtp').length,1);assert.equal(h.audits.filter(a=>a.action==='settings.smtp-test-requested').length,1);
 for(const r of rs.filter(r=>r.res.status===429))assert.equal(r.res.headers.get('retry-after'),'60');
});
for(const options of [{active:false},{userRole:'EMPLOYEE'},{email:null},{email:'bad\naddress'}])test('route: current account/recipient eligibility '+JSON.stringify(options),async()=>{
 const h=routeHarness(options),r=await h.send();assert.ok([403,409].includes(r.res.status));assert.equal(h.calls.includes('smtp'),false);assert.equal(h.audits.length,0);
});
test('route: request-audit failure prevents all network delivery',async()=>{
 const h=routeHarness({fault:'settings.smtp-test-requested'}),r=await h.send();assert.equal(r.res.status,503);assert.equal(h.calls.includes('smtp'),false);assert.equal(h.audits.length,0);
});
test('route: accepted test binds the principal and correlation, not an arbitrary recipient body',async()=>{
 const h=routeHarness(),r=await h.send({body:{recipient:'attacker@example.test'}});assert.equal(r.res.status,200);
 assert.deepEqual(r.body.data,{sent:true,deliveryStatus:'SMTP_ACCEPTED',mailboxDeliveryConfirmed:false,auditRecorded:true,testId:r.id,actorId:'admin-a',tenantId:'tenant-a',recipient:'ad***@example.test'});
 assert.equal(h.audits.length,2);assert.ok(h.audits.every(a=>a.purpose.includes(r.id)));
});
test('route: SMTP acceptance followed by failed audit is 202 warning, never failed-send evidence',async()=>{
 const h=routeHarness({fault:'settings.smtp-test-succeeded'}),r=await h.send();assert.equal(r.res.status,202);assert.equal(r.body.data.sent,true);assert.equal(r.body.data.auditRecorded,false);
 assert.equal(h.calls.filter(c=>c==='smtp').length,1);assert.ok(!h.calls.includes('settings.smtp-test-failed'));
 assert.equal((await h.send()).res.status,429);
});
test('route: provider failure stays unknown and never auto-retries',async()=>{
 const h=routeHarness({fault:'smtp'}),r=await h.send();assert.equal(r.res.status,502);assert.equal(r.body.code,'SMTP_TEST_RESULT_UNKNOWN');assert.ok(!JSON.stringify(r.body).includes('SECRET'));assert.equal(h.calls.filter(c=>c==='smtp').length,1);assert.equal(h.audits.at(-1).action,'settings.smtp-test-failed');
});
const nodes=v=>Array.isArray(v)?v.flatMap(nodes):!v||typeof v!=='object'?[]:[v,...nodes(v.props?.children)];
const text=v=>Array.isArray(v)?v.map(text).join(''):!v?'':typeof v==='object'?text(v.props?.children):String(v);
function ui(){
 const old={fetch:globalThis.fetch,window:globalThis.window};let slots=[],cursor=0,effects=[],tree,locale='en',enabled=true,loading=false,identity={id:'admin-a',tenantId:'tenant-a',role:'TENANT_ADMIN'},confirmed=true;
 const calls=[];let transport=async(_url,o)=>({status:200,json:async()=>({data:{sent:true,deliveryStatus:'SMTP_ACCEPTED',mailboxDeliveryConfirmed:false,auditRecorded:true,testId:o.headers['x-hrbp-test-id'],actorId:identity.id,tenantId:identity.tenantId}})});
 globalThis.fetch=(u,o)=>{calls.push(o);return transport(u,o);};globalThis.window={confirm:()=>confirmed,location:{reload(){calls.push('reload');}}};
 const react={useRef(v){const i=cursor++;return slots[i]??={current:v};},useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props});
 const C=compile(process.env.SMTP_UI_SOURCE||'components/smtp-test-action.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{MailCheck:'svg'},'@/components/locale-provider':{useLocale:()=>({locale})},
  '@/components/session-provider':{useSessionContext:()=>({session:{authenticated:true,user:identity},loading})}
 }).SmtpTestAction;
 function render(){cursor=0;tree=C({enabled});effects.splice(0).forEach(fn=>fn());return tree;}
 async function settle(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));render();}}
 render();return {calls,render,settle,get tree(){return tree;},get text(){return text(tree);},send:()=>nodes(tree).find(n=>n.type==='button'),
 confirm(v){confirmed=v;},transport(fn){transport=fn;},set(v){if(v.locale)locale=v.locale;if('loading'in v)loading=v.loading;if('enabled'in v)enabled=v.enabled;if(v.identity)identity={...identity,...v.identity};render();},
 async click(){const result=nodes(tree).find(n=>n.type==='button').props.onClick();render();await result;await settle();},close(){globalThis.fetch=old.fetch;globalThis.window=old.window;}}
}
test('UI: cancelled confirmation sends nothing',async()=>{const h=ui();try{h.confirm(false);await h.click();assert.equal(h.calls.length,0);assert.equal(h.send().props.disabled,false);}finally{h.close();}});
test('UI: two callbacks in the same turn send one correlated request',async()=>{const h=ui();try{const cb=h.send().props.onClick;cb();cb();await h.settle();assert.equal(h.calls.length,1);assert.match(h.calls[0].headers['x-hrbp-test-id'],/^[a-f0-9-]{36}$/);assert.ok(h.text.includes('mailbox delivery is not verified'));assert.equal(h.send().props.disabled,true);}finally{h.close();}});
for(const field of ['testId','actorId','tenantId','sent','mailboxDeliveryConfirmed'])test('UI: mismatched '+field+' never confirms or enables replay',async()=>{
 const h=ui();try{h.transport(async(_u,o)=>{const d={sent:true,deliveryStatus:'SMTP_ACCEPTED',mailboxDeliveryConfirmed:false,auditRecorded:true,testId:o.headers['x-hrbp-test-id'],actorId:'admin-a',tenantId:'tenant-a'};d[field]='wrong';return {status:200,json:async()=>({data:d})};});await h.click();assert.ok(h.text.includes('result is unknown'));assert.equal(h.send().props.disabled,true);h.set({loading:true});assert.equal(h.tree,null);h.set({loading:false,locale:'tr'});assert.equal(h.send().props.disabled,true);assert.ok(h.text.includes('doğrulanamadı'));assert.equal(h.calls.length,1);}finally{h.close();}
});
test('UI: 202 exposes audit warning without claiming failed delivery',async()=>{const h=ui();try{h.transport(async(_u,o)=>({status:202,json:async()=>({data:{sent:true,deliveryStatus:'SMTP_ACCEPTED',mailboxDeliveryConfirmed:false,auditRecorded:false,testId:o.headers['x-hrbp-test-id'],actorId:'admin-a',tenantId:'tenant-a'}})}));await h.click();assert.ok(h.text.includes('outcome audit'));assert.equal(h.send().props.disabled,true);}finally{h.close();}});
test('UI: raw provider diagnostics stay hidden and do not enable automatic retry',async()=>{const h=ui();try{h.transport(async()=>{throw Error('PASSWORD_RAW_DIAGNOSTIC');});await h.click();assert.ok(!h.text.includes('PASSWORD'));assert.ok(h.text.includes('result is unknown'));await h.click();assert.equal(h.calls.length,1);}finally{h.close();}});
test('UI: stale actor callback cannot send under a different signed-in account',async()=>{const h=ui();try{const cb=h.send().props.onClick;h.set({identity:{id:'admin-b'}});cb();await h.settle();assert.equal(h.calls.length,0);}finally{h.close();}});
test('UI: disabled integration and unprivileged roles expose no send control',()=>{const h=ui();try{h.set({identity:{role:'EMPLOYEE'}});assert.equal(h.tree,null);h.set({identity:{role:'TENANT_ADMIN'},enabled:false});assert.equal(h.tree,null);}finally{h.close();}});
