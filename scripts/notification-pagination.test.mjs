/** Real read handler and hooks, controlled database/React dependencies.
 * Separate browser suite supplies actual SQL, rendering and signed sessions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks={}) {
 const base=process.env.HRBP_PAGINATION_BASELINE;
 const source=readFileSync(base && path==='app/api/settings/notifications/operations/route.ts'?`${base}/${path}`:path,'utf8');
 const r=ts.transpileModule(source,{fileName:path,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
 assert.equal(r.diagnostics.filter(d=>d.category===1).length,0);
 const m={exports:{}};new Function('module','exports','require',r.outputText)(m,m.exports,n=>{assert.ok(n in mocks,n);return mocks[n];});return m.exports;
}
const contract=compile('lib/notification-retry-contract.ts');
const pages=contract;
const user={id:'admin-a',tenantId:'tenant-a',role:'TENANT_ADMIN'},stamp='2026-10-19T00:00:00.000Z';
const vals=s=>Object.fromEntries(s.trim().split(/\s+/).map(v=>[v,v]));
const enums={PlatformRole:vals(readFileSync('prisma/schema.prisma','utf8').match(/enum PlatformRole \{([\s\S]*?)\}/)[1]),NotificationOutboxStatus:vals('PENDING PROCESSING DELIVERED FAILED DEAD_LETTER'),Prisma:{TransactionIsolationLevel:{RepeatableRead:'RepeatableRead'}}};
const auth=compile('lib/authorization.ts',{'@prisma/client':enums});
const row=(n,status='FAILED')=>({id:'record-'+String(n).padStart(4,'0'),tenantId:user.tenantId,eventType:'QA_PAGE',channel:'IN_APP',resourceType:'QA',resourceId:'synthetic',status,attempts:3,nextAttemptAt:new Date(stamp),lockedAt:null,lastError:'password=PRIVATE_SENTINEL',createdAt:new Date(stamp),updatedAt:new Date(stamp),payload:{secret:'PRIVATE_SENTINEL'},recipientUserId:'hidden'});
function matches(row, where={}) {return Object.entries(where).every(([k,v])=>k==='OR'?v.some(w=>matches(row,w)):k==='AND'?v.every(w=>matches(row,w)):v instanceof Date?+row[k]===+v:v&&typeof v==='object'?Object.entries(v).every(([op,x])=>op==='in'?x.includes(row[k]):op==='lt'?row[k]<x:op==='gt'?row[k]>x:false):row[k]===v);}
function ordered(rows, order) {return [...rows].sort((a,b)=>{for(const rule of order)for(const[k,dir]of Object.entries(rule)){const c=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(c)return dir==='asc'?c:-c;}return 0;});}
function harness({role='TENANT_ADMIN',fail=false}={}) {
 const rows=Array.from({length:205},(_,n)=>row(n)),calls=[];rows.push({...row(9999),tenantId:'tenant-b'});
 const db={$transaction:async(fn,o)=>{calls.push('tx:'+o.isolationLevel);return fn({notificationOutbox:{
  groupBy:async o=>{if(fail)throw Error('PRIVATE_SENTINEL');calls.push('groups');const g={};rows.filter(r=>matches(r,o.where)).forEach(r=>g[r.status]=(g[r.status]??0)+1);return Object.entries(g).map(([status,n])=>({status,_count:{_all:n}}));},
  findMany:async o=>{calls.push({take:o.take,where:o.where});return ordered(rows.filter(r=>matches(r,o.where)),o.orderBy).slice(0,o.take).map(r=>Object.fromEntries(Object.keys(o.select).map(k=>[k,r[k]])));}
 }});}};
 const handler=compile('app/api/settings/notifications/operations/route.ts',{'@prisma/client':enums,'@/lib/authorization':auth,'@/lib/db':{db},'@/lib/notification-retry-contract':contract,'@/lib/request-context':{getRequestContext:async()=>role?{actorId:user.id,tenantId:user.tenantId,role}:null}}).GET;
 return {rows,calls,async get(after=null,filter='ALL',limit=100,raw){const q=raw??`?status=${filter}&limit=${limit}${after===undefined?'':`&after=${encodeURIComponent(after??'')}`}`;const response=await handler(new Request('http://localhost/api'+q));return {response,status:response.status,body:await response.json()};}};
}
const token=(r,filter='ALL',limit=100,viewer=user)=>pages.operationsCursor({...r,updatedAt:new Date(r.updatedAt).toISOString(),createdAt:new Date(r.createdAt).toISOString()},viewer,filter,limit);
test('page contract follows 205 tied records in 100/100/5 without duplicates or foreign rows',async()=>{const h=harness(),seen=[];let after=null;for(const count of [100,100,5]){const r=await h.get(after);assert.equal(r.status,200);assert.ok(pages.parsePagedOpsData(r.body.data,user,'ALL',100,after));assert.equal(r.body.data.items.length,count);seen.push(...r.body.data.items.map(i=>i.id));after=r.body.data.page.next;assert.equal(r.body.data.counts.failed,205);}assert.equal(after,null);assert.deepEqual(seen,h.rows.slice(0,205).map(r=>r.id));assert.equal(new Set(seen).size,205);});
test('cursor is a tuple, not a row lookup; deleting the boundary does not strand later records',async()=>{const h=harness(),a=(await h.get()).body.data;h.rows.splice(99,1);const b=(await h.get(a.page.next)).body.data;assert.equal(b.items[0].id,'record-0100');assert.equal(b.items.length,100);});
test('changing the boundary revision does not make later rows inaccessible',async()=>{const h=harness(),a=(await h.get()).body.data;h.rows[99].updatedAt=new Date('2026-10-19T01:00:00.000Z');const b=(await h.get(a.page.next)).body.data;assert.equal(b.items[0].id,'record-0100');});
test('each page applies status filtering and scope while counters remain tenant totals',async()=>{const h=harness();h.rows.forEach((r,i)=>{if(i%2)r.status='DEAD_LETTER';});const r=await h.get(null,'DEAD_LETTER',20);assert.equal(r.status,200);assert.equal(r.body.data.items.length,20);assert.ok(r.body.data.items.every(i=>i.status==='DEAD_LETTER'));assert.equal(r.body.data.counts.failed,103);assert.equal(r.body.data.counts.deadLetter,102);assert.ok(r.body.data.page.next);});
test('legacy unpaged clients retain the original envelope, limit and one snapshot transaction',async()=>{const h=harness(),r=await h.get(null,'ALL',100,'?status=ALL&limit=100');assert.equal(r.status,200);assert.equal(r.body.data.page,undefined);assert.equal(r.body.data.items.length,100);assert.equal(h.calls.at(-1).take,100);assert.deepEqual(h.calls.slice(0,2),['tx:RepeatableRead','groups']);});
test('paged reads have bounded lookahead and never project payloads or provider errors',async()=>{const h=harness(),r=await h.get();assert.equal(h.calls.at(-1).take,101);assert.equal(r.body.data.items.length,100);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_SENTINEL'));assert.ok(!('payload'in r.body.data.items[0]));assert.ok(!('recipientUserId'in r.body.data.items[0]));assert.match(r.response.headers.get('cache-control'),/private.*no-store/);});
for(const role of [null,'EMPLOYEE'])test('page access denies '+role+' before cursor/data queries',async()=>{const h=harness({role}),r=await h.get('invalid');assert.equal(r.status,role?403:401);assert.equal(h.calls.length,0);assert.match(r.response.headers.get('cache-control'),/no-store/);});
for(const raw of ['?after=x','?after=&after=','?after='+encodeURIComponent('x'.repeat(1025)), '?after='+encodeURIComponent('null')])test('malformed cursor denied before database '+raw.slice(0,45),async()=>{const h=harness(),r=await h.get(null,'ALL',100,raw);assert.equal(r.status,400);assert.equal(h.calls.length,0);});
for(const [name,alter]of [['actor',v=>v[1]='other'],['tenant',v=>v[2]='tenant-b'],['role',v=>v[3]='HR_OPERATIONS'],['filter',v=>v[4]='FAILED'],['limit',v=>v[5]=50],['version',v=>v[0]=2],['date',v=>v[6]='bad'],['id',v=>v[8]='bad\u0000id']])test('cursor cannot be reused with changed '+name,async()=>{const h=harness(),v=JSON.parse(token(row(99)));alter(v);const r=await h.get(JSON.stringify(v));assert.equal(r.status,400);assert.equal(h.calls.length,0);});
test('count and items are read-only in a shared scoped snapshot',async()=>{const h=harness(),before=structuredClone(h.rows);await h.get();assert.deepEqual(h.rows,before);assert.equal(h.calls[0],'tx:RepeatableRead');});
test('database failure is bounded, non-cacheable and does not return previous records',async()=>{const r=await harness({fail:true}).get();assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_SENTINEL'));assert.equal(r.body.data,undefined);assert.match(r.response.headers.get('cache-control'),/no-store/);});
for(const [name,change]of [['missing page',d=>delete d.page],['other position',d=>d.page.after='wrong'],['absent next',d=>delete d.page.next],['foreign next',d=>d.page.next=token(row(99),'ALL',100,{...user,tenantId:'tenant-b'})],['wrong boundary',d=>d.page.next=token(row(98))],['short page with next',d=>d.items.pop()]])test('UI page parser rejects '+name,async()=>{const h=harness(),r=await h.get();const d=r.body.data;change(d);assert.equal(pages.parsePagedOpsData(d,user,'ALL',100,null),null);});

function hookHarness(which='read'){
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;let slots=[],cursor=0,effects=[],result,authenticated=true,loading=false,identity={...user},filter='ALL',confirm=true,enabled=true,after=null;
 const calls=[];let transport=async(_url,opts)=>{const c=JSON.parse(opts.body);return {status:200,json:async()=>({data:{command:c,actorId:user.id,tenantId:user.tenantId,requeued:c.items.length,result:'PENDING'}})};};
 globalThis.fetch=async(url,opts)=>{calls.push({url,...opts});return transport(url,opts);};globalThis.window={confirm:()=>confirm};
 const react={useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(v){const i=cursor++;return slots[i]??={current:v};},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,fn};return slots[i].fn;}};
 const hooks=compile('components/use-notification-operations.ts',{react,'@/components/session-provider':{useSessionContext:()=>({session:{authenticated,user:identity},loading})},'@/lib/notification-retry-contract':contract});
 function render(){cursor=0;result=which==='retry'?hooks.useNotificationRetry(false):hooks.useOperationsRead(filter,100,enabled,after);const todo=effects;effects=[];todo.forEach(f=>f());return result;}
 async function settle(){for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));render();}}
 render();return {calls,render,settle,get result(){return result;},transport(fn){transport=fn;},confirm(v){confirm=v;},set(v){identity={...identity,...v.user};loading=v.loading??loading;authenticated=v.authenticated??authenticated;filter=v.filter??filter;enabled=v.enabled??enabled;if('after'in v)after=v.after;render();},close(){slots.forEach(s=>s?.cleanup?.());globalThis.fetch=oldFetch;globalThis.window=oldWindow;}};
}
async function loadedHook(h) {
 await h.settle();
 h.transport(async(url)=>{const q=new URL(url,'http://localhost').searchParams;
   const after=q.has('after')?q.get('after')||null:undefined;
   const r=await harness().get(after,q.get('status'),Number(q.get('limit')),after===undefined?'?'+q.toString():undefined);return {status:r.status,json:async()=>r.body};});
 await h.result.load();await h.settle();assert.ok(h.result.data);
}
test('page hook sends cursor, invalidates captured write eligibility and replaces rather than appends rows',async()=>{
 const h=hookHarness();try{await loadedHook(h);const previous=h.result.current,after=h.result.page.next;h.set({after});assert.equal(h.result.data,null);assert.equal(previous(),false);await h.settle();assert.equal(h.result.data.items[0].id,'record-0100');assert.equal(h.result.data.items.length,100);assert.equal(h.result.page.after,after);assert.equal(new URL(h.calls.at(-1).url,'http://localhost').searchParams.get('after'),after);}finally{h.close();}
});
test('a delayed old page cannot replace a new authorized page',async()=>{const h=hookHarness();let resolve;try{await loadedHook(h);const after=h.result.page.next;let first=true;h.transport(async()=>{if(first){first=false;return new Promise(r=>resolve=r);}const r=await harness().get(after);return {status:200,json:async()=>r.body};});h.result.load();h.render();const oldSignal=h.calls.at(-1).signal;h.set({after});assert.equal(oldSignal.aborted,true);await h.settle();assert.equal(h.result.data.items[0].id,'record-0100');resolve({status:200,json:async()=>(await harness().get()).body});await h.settle();assert.equal(h.result.data.items[0].id,'record-0100');}finally{resolve?.({status:403});h.close();}});
test('failed later-page read hides rows and cursor and never loops',async()=>{const h=hookHarness();try{await loadedHook(h);const after=h.result.page.next;h.transport(async()=>({status:503}));h.set({after});await h.settle();assert.equal(h.result.data,null);assert.equal(h.result.page,null);assert.ok(h.result.error);const n=h.calls.length;await h.settle();assert.equal(h.calls.length,n);}finally{h.close();}});
test('principal change hides the previous page and invalidates captured callbacks',async()=>{const h=hookHarness();try{await loadedHook(h);const callback=h.result.current;h.set({user:{id:'other'}});assert.equal(h.result.data,null);assert.equal(callback(),false);await h.settle();assert.equal(h.result.data,null);}finally{h.close();}});
test('legacy and first-page modes are separate read generations',async()=>{const h=hookHarness();try{await loadedHook(h);h.set({after:undefined});await h.settle();assert.ok(h.result.data);assert.equal(h.result.page,null);assert.ok(!h.calls.at(-1).url.includes('after='));h.set({after:null});await h.settle();assert.ok(h.result.page);assert.equal(h.result.page.after,null);}finally{h.close();}});
