/** Real handler/contract tests with controlled dependency doubles; SQL/browser
 * acceptance is separate. No production records or network access. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const r = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(r.diagnostics.filter(d => d.category === 1).length, 0);
  const m = { exports: {} };
  new Function('module','exports','require',r.outputText)(m,m.exports,n => { assert.ok(n in mocks,n); return mocks[n]; });
  return m.exports;
}
const input = compile('lib/input-validation.ts'), revision = compile('lib/hr-service-revision.ts');
const stamp = '2026-10-16T00:00:00.000Z', originalTime = '2026-10-15T00:00:00.000Z';
const vals = s => Object.fromEntries(s.split(' ').map(x => [x,x]));
const enums = { PlatformRole: vals('EMPLOYEE MANAGER HRBP HR_OPERATIONS TENANT_ADMIN'), DataClassification: vals('CONFIDENTIAL'),
  ServiceRequestStatus: vals('OPEN TRIAGE IN_PROGRESS WAITING_EMPLOYEE WAITING_THIRD_PARTY RESOLVED CLOSED CANCELLED'),
  Prisma: { TransactionIsolationLevel: { Serializable:'Serializable', RepeatableRead:'RepeatableRead' }, PrismaClientKnownRequestError: class extends Error {} } };
function harness({ role='HR_OPERATIONS', visible=true, capability=true, status='IN_PROGRESS', fault=null } = {}) {
  const ctx={ actorId:'actor-a',tenantId:'tenant-a',role };
  let state={ ticket:{id:'ticket-a',tenantId:'tenant-a',requestNumber:'QA-1',title:'Synthetic request',requestorId:'requester-a',status,queue:'OLD',assigneeId:null,
    priority:'MEDIUM',updatedAt:new Date(stamp),firstResponseAt:null,resolvedAt:status==='RESOLVED'?new Date(originalTime):null,
    closedAt:status==='CLOSED'?new Date(originalTime):null,slaDueAt:new Date('2026-10-17T00:00:00.000Z'),escalationLevel:2,escalatedAt:new Date(originalTime),escalationReason:'Previous'},
    audits:[],outbox:[],transitions:[],pauses:[],retired:0 };
  const calls=[];
  const tx={
    hRServiceRequest:{findFirst:async args=>{calls.push('request'); assert.ok(args.where.AND); return visible?structuredClone(state.ticket):null;},findUnique:async()=>structuredClone(state.ticket),
      updateMany:async({where,data})=>{calls.push('update'); if(+where.updatedAt!==+state.ticket.updatedAt)return {count:0}; Object.assign(state.ticket,data);return {count:1};}},
    hRServiceQueue:{findMany:async args=>{calls.push('queues'); assert.equal(args.take,101);if(role==='HRBP')assert.ok(args.where.memberships.some);return [{key:'NEW',name:'New queue'}];}},
    userAccount:{findFirst:async()=>({id:'agent-a'}),findMany:async args=>{calls.push('users');assert.equal(args.where.tenantId,ctx.tenantId);assert.equal(args.take,201);if(role==='HRBP')assert.equal(args.where.id,ctx.actorId);return [{id:'agent-a',displayName:'Agent'}];}},
    hRServiceQueueMembership:{findFirst:async()=>({id:'member-a'})},
    hRServiceStatusTransition:{create:async({data})=>{state.transitions.push(data);return data;}},
    hRServiceSlaPause:{create:async({data})=>{state.pauses.push(data);return data;},findFirst:async()=>null,updateMany:async()=>({count:1})},
    notificationOutbox:{updateMany:async()=>{state.retired++;return {count:1};}},
    $queryRaw:async(strings,...values)=>{calls.push('candidate-query');assert.ok(strings.raw);assert.ok(values.includes(ctx.tenantId));assert.match(strings.join('?'),/LIMIT 201/);return [{id:'agent-a',displayName:'Agent'}];}
  };
  const mocks={ '@prisma/client':enums, '@/lib/db':{db:{$transaction:async(fn,options)=>{calls.push(options.isolationLevel);const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}}}},
    '@/lib/input-validation':input, '@/lib/hr-service-revision':revision,
    '@/lib/request-context':{getRequestContext:async()=>role?ctx:null,mutationOriginAllowed:()=>true,unauthorized:()=>Response.json({}, {status:401})},
    '@/lib/authorization':{can:()=>capability,forbidden:()=>Response.json({}, {status:403})},
    '@/lib/hr-service-access':{hrServiceRequestWhere:async()=>({tenantId:ctx.tenantId}),canUseHRServiceQueue:async(_tx,_ctx,key)=>key==='FORBIDDEN'?null:{id:'queue-'+key,key,defaultSlaMinutes:1440},
      canManageHRServiceQueues:()=>role!=='HRBP',isHRServiceStaffRole:r=>['HRBP','HR_OPERATIONS','TENANT_ADMIN'].includes(r)},
    '@/lib/audit':{appendAudit:async(_tx,_ctx,e)=>{if(fault==='audit')throw Error('PRIVATE_DIAGNOSTIC');state.audits.push(e);}},
    '@/lib/notification-outbox':{enqueueNotificationOutbox:async(_tx,e)=>{if(fault==='outbox')throw Error('PRIVATE_DIAGNOSTIC');state.outbox.push(e);}}
  };
  const statusApi=compile('app/api/hr-service/requests/[id]/status/route.ts',mocks), options=compile('app/api/hr-service/requests/[id]/routing-options/route.ts',mocks);
  return {calls,get state(){return state;}, async post(extra={}){const res=await statusApi.POST(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status,expectedUpdatedAt:stamp,queue:'NEW',assigneeId:'agent-a',...extra})}),{params:Promise.resolve({id:'ticket-a'})});return {status:res.status,body:await res.json()};},
    async get(query='',id='ticket-a'){const res=await options.GET(new Request('http://localhost/api'+query),{params:Promise.resolve({id})});return {status:res.status,headers:res.headers,body:await res.json()};}};
}
for(const status of ['OPEN','IN_PROGRESS','WAITING_EMPLOYEE','WAITING_THIRD_PARTY','RESOLVED']) test(`routing-only ${status} preserves all SLA, first-response, resolution and escalation history`,async()=>{
 const h=harness({status}),before=structuredClone(h.state.ticket),result=await h.post();assert.equal(result.status,200);
 for(const field of ['status','slaDueAt','firstResponseAt','resolvedAt','closedAt','escalationLevel','escalatedAt','escalationReason'])assert.deepEqual(h.state.ticket[field],before[field],field);
 assert.equal(h.state.transitions.length,0);assert.equal(h.state.pauses.length,0);assert.equal(h.state.retired,0);
 assert.equal(h.state.audits[0].action,'hr-service.routing-updated');assert.equal(h.state.outbox.length,1);assert.equal(h.state.outbox[0].eventType,'HR_SERVICE_ASSIGNED');
});
for(const status of ['CLOSED','CANCELLED'])test(`routing rejects terminal ${status} without mutation`,async()=>{const h=harness({status}),before=structuredClone(h.state);assert.equal((await h.post()).status,409);assert.deepEqual(h.state,before);});
test('routing receipt binds final queue and assignee as well as displayed/result revisions',async()=>{const h=harness(),r=await h.post();assert.equal(r.status,200);assert.equal(r.body.data.writeReceipt.queue,'NEW');assert.equal(r.body.data.writeReceipt.assigneeId,'agent-a');assert.equal(r.body.data.writeReceipt.expectedUpdatedAt,stamp);assert.ok(h.state.ticket.updatedAt>new Date(stamp));});
for(const fault of ['audit','outbox'])test(`routing ${fault} failure rolls back parent and evidence`,async()=>{const h=harness({fault}),before=structuredClone(h.state);assert.equal((await h.post()).status,500);assert.deepEqual(h.state,before);});
test('routing stale version cannot change any target',async()=>{const h=harness(),before=structuredClone(h.state);assert.equal((await h.post({expectedUpdatedAt:originalTime})).status,409);assert.deepEqual(h.state,before);});
test('an actual resolution still records its lifecycle timestamps and notification',async()=>{const h=harness();const r=await h.post({status:'RESOLVED',reason:'Synthetic valid resolution'});assert.equal(r.status,200);assert.equal(h.state.ticket.status,'RESOLVED');assert.ok(h.state.ticket.resolvedAt);assert.ok(h.state.ticket.firstResponseAt);assert.equal(h.state.ticket.escalationLevel,0);assert.equal(h.state.transitions.length,1);});
for(const config of [{role:null},{role:'EMPLOYEE'},{role:'MANAGER'},{capability:false}])test('options deny before directory access '+JSON.stringify(config),async()=>{const h=harness(config),r=await h.get();assert.ok([401,403].includes(r.status));assert.equal(h.calls.length,0);assert.match(r.headers.get('cache-control'),/private.*no-store/);});
test('options foreign request never reads directory candidates',async()=>{const h=harness({visible:false});assert.equal((await h.get()).status,404);assert.deepEqual(h.calls,['RepeatableRead','request']);});
for(const query of ['?queue=x','?queue=A&queue=B','?queue=%00'])test('options reject malformed selection '+query,async()=>{const h=harness();assert.equal((await h.get(query)).status,400);assert.equal(h.calls.length,0);});
test('options foreign queue is not an authorization token',async()=>{const h=harness();assert.equal((await h.get('?queue=FORBIDDEN')).status,404);assert.ok(!h.calls.includes('queues'));});
test('options active queue returns role/request-bound snapshot and scoped candidates',async()=>{const h=harness({role:'HRBP'}),r=await h.get('?queue=NEW');assert.equal(r.status,200);assert.equal(r.body.data.initial,false);assert.equal(r.body.data.queue,'NEW');assert.equal(r.body.data.viewer.actorId,'actor-a');assert.ok(h.calls.includes('candidate-query'));assert.match(r.headers.get('cache-control'),/no-store/);});
test('options unqueued HRBP candidates are self-only without a full staff directory',async()=>{const h=harness({role:'HRBP'});assert.equal((await h.get('?queue=')).status,200);assert.ok(h.calls.includes('users'));});
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const receipts=compile('components/hr-service-receipts.ts',{'@/lib/hr-service-revision':revision,'@/components/hr-service-action-state':{isObject}});
const contract=compile('components/hr-service-routing-contract.ts',{'@/lib/hr-service-revision':revision,'@/components/hr-service-action-state':{isObject},'@/components/hr-service-receipts':receipts});
const user={id:'actor-a',tenantId:'tenant-a',role:'HR_OPERATIONS'};
const valid=()=>({request:{id:'ticket-a',tenantId:'tenant-a',requestNumber:'QA-1',title:'Title',status:'OPEN',updatedAt:stamp,queue:null,assigneeId:null},viewer:{actorId:'actor-a',tenantId:'tenant-a',role:'HR_OPERATIONS'},initial:true,queue:null,queueAvailable:true,queues:[{key:'NEW',name:'New queue'}],assignees:[{id:'agent-a',displayName:'Agent'}],queuesTruncated:false,assigneesTruncated:false});
test('options contract accepts exact initial and explicitly selected snapshots',()=>{assert.ok(contract.parseRoutingOptions(valid(),user,'ticket-a',stamp,undefined));assert.ok(contract.parseRoutingOptions({...valid(),initial:false,queue:'NEW'},user,'ticket-a',stamp,'NEW'));});
for(const [name,change] of [['foreign request',x=>x.request.id='other'],['foreign tenant',x=>x.request.tenantId='other'],['foreign actor',x=>x.viewer.actorId='other'],['stale revision',x=>x.request.updatedAt=originalTime],['wrong queue',x=>x.queue='OTHER'],['wrong read mode',x=>x.initial=false],['string flag',x=>x.queueAvailable='false'],['duplicate queue',x=>x.queues.push(x.queues[0])],['duplicate user',x=>x.assignees.push(x.assignees[0])],['terminal',x=>x.request.status='CLOSED'],['too many users',x=>x.assignees=Array.from({length:201},(_,i)=>({id:'a'+i,displayName:'A'}))]])test('options contract rejects '+name,()=>{const x=valid();change(x);assert.equal(contract.parseRoutingOptions(x,user,'ticket-a',stamp,undefined),null);});
test('routing write contract rejects substituted targets despite a successful status receipt',()=>{
 const value={id:'ticket-a',tenantId:'tenant-a',status:'OPEN',updatedAt:'2026-10-16T00:00:01.000Z',queue:'NEW',assigneeId:'agent-a',writeReceipt:{requestId:'ticket-a',tenantId:'tenant-a',actorId:'actor-a',operation:'STATUS',expectedUpdatedAt:stamp,updatedAt:'2026-10-16T00:00:01.000Z',reason:null,queue:'NEW',assigneeId:'agent-a'}};
 assert.ok(contract.acceptsRoutingWrite(value,user,'ticket-a','OPEN',stamp,'NEW','agent-a'));
 for(const field of ['queue','assigneeId']) {const copy=structuredClone(value);copy[field]='other';assert.equal(contract.acceptsRoutingWrite(copy,user,'ticket-a','OPEN',stamp,'NEW','agent-a'),false);copy[field]=value[field];copy.writeReceipt[field]='other';assert.equal(contract.acceptsRoutingWrite(copy,user,'ticket-a','OPEN',stamp,'NEW','agent-a'),false);}
});
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
const label=n=>Array.isArray(n)?n.map(label).join(''):n==null||typeof n==='boolean'?'':typeof n==='object'?label(n.props?.children):String(n);
function client() {
 const old={fetch:globalThis.fetch,window:globalThis.window};let props={requestId:'ticket-a',expectedUpdatedAt:stamp,status:'OPEN',locale:'en'},principal={...user},auth=true;
 let tree,slots=[],cursor=0,effects=[],confirm=true;const calls={get:[],post:[],refresh:0};
 let transport=async(url,init)=>{if(init.method==='POST'){const sent=JSON.parse(init.body);return {status:200,json:async()=>({data:{id:'ticket-a',tenantId:user.tenantId,...sent,updatedAt:'2026-10-16T00:00:01.000Z',writeReceipt:{requestId:'ticket-a',tenantId:user.tenantId,actorId:user.id,operation:'STATUS',expectedUpdatedAt:stamp,updatedAt:'2026-10-16T00:00:01.000Z',reason:null,queue:sent.queue,assigneeId:sent.assigneeId}}})};}const data=valid();const q=new URL(url,'http://localhost').searchParams;if(q.has('queue')){data.initial=false;data.queue=q.get('queue')||null;}return {status:200,json:async()=>({data})};};
 globalThis.fetch=(url,init)=>{calls[init.method==='POST'?'post':'get'].push({url,...init});return transport(url,init);};
 globalThis.window={confirm:()=>confirm,location:{reload(){}},dispatchEvent(){}};
 const react={useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(v){const i=cursor++;return slots[i]??={current:v};},useId(){return 'id-'+cursor++;},useEffect(fn,deps){const i=cursor++,prev=slots[i];if(!prev||deps.some((d,j)=>!Object.is(d,prev.deps[j]))){slots[i]={deps,cleanup:prev?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>({type,props});const css={default:new Proxy({},{get:(_,k)=>k})};
 const mocks={react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh:()=>calls.refresh++})},
  '@/components/session-provider':{useSessionContext:()=>({session:{authenticated:auth,user:principal},loading:false})},'@/components/use-policy-dialog':{usePolicyDialog(){}},
  '@/components/hr-service-receipts':receipts,'@/components/hr-service-routing-contract':contract,'@/components/hr-service-conversation.module.css':css,'@/components/hr-service-actions.module.css':css};
 mocks['@/components/hr-service-action-state']=compile('components/hr-service-action-state.ts',mocks);
 const component=compile('components/hr-service-routing.tsx',mocks).HRServiceRouting;
 function render(){cursor=0;tree=component(props);for(const n of nodes(tree))if(n.props?.ref)n.props.ref.current??={open:false,showModal(){this.open=true;},close(){this.open=false;},focus(){}};const run=effects;effects=[];run.forEach(fn=>fn());return tree;}
 async function settle(){for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));render();}}
 const button=name=>{const n=nodes(tree).find(n=>n.type==='button'&&label(n)===name);assert.ok(n,'Missing '+name);return n;};
 render();return {calls,render,settle,button,get text(){return label(tree);},get tree(){return tree;},async click(name){const p=button(name).props.onClick();render();await p;await settle();},async choose(name,value){const n=nodes(tree).find(n=>n.type==='select'&&n.props['aria-label']===name);assert.ok(n,name);n.props.onChange({target:{value}});render();await settle();},
  confirm(v){confirm=v;},transport(fn){transport=fn;},props(v){props={...props,...v};render();},session(v){principal={...principal,...v};render();},close(){slots.forEach(s=>s?.cleanup?.());globalThis.fetch=old.fetch;globalThis.window=old.window;}};
}
test('routing UI lazily loads exact choices; changing queue clears proposed assignee and reauthorizes',async()=>{const h=client();try{assert.equal(h.calls.get.length,0);await h.click('Route / assign');await h.choose('Assignee','agent-a');await h.choose('Queue','NEW');assert.equal(h.calls.get.length,2);assert.match(h.calls.get[1].url,/queue=NEW$/);assert.equal(nodes(h.tree).find(n=>n.type==='select'&&n.props['aria-label']==='Assignee').props.value,'');}finally{h.close();}});
test('routing UI unchanged or cancelled selection makes no write',async()=>{const h=client();try{await h.click('Route / assign');assert.equal(h.button('Save routing').props.disabled,true);await h.choose('Assignee','agent-a');h.confirm(false);await h.click('Save routing');assert.equal(h.calls.post.length,0);}finally{h.close();}});
test('routing UI simultaneous callbacks send one exact version and target pair',async()=>{const h=client();try{await h.click('Route / assign');await h.choose('Queue','NEW');await h.choose('Assignee','agent-a');const cb=h.button('Save routing').props.onClick;await Promise.all([cb(),cb()]);await h.settle();assert.equal(h.calls.post.length,1);assert.deepEqual(JSON.parse(h.calls.post[0].body),{expectedUpdatedAt:stamp,status:'OPEN',queue:'NEW',assigneeId:'agent-a'});assert.ok(h.text.includes('was saved'));}finally{h.close();}});
for(const fault of ['lost','wrong-queue'])test('routing UI '+fault+' result never enables replay after close/reopen',async()=>{const h=client();try{await h.click('Route / assign');await h.choose('Assignee','agent-a');h.transport(async(_url,init)=>{if(init.method==='POST'){if(fault==='lost')throw Error('PRIVATE');return {status:200,json:async()=>({data:{}})};}return {status:200,json:async()=>({data:valid()})};});await h.click('Save routing');assert.ok(h.text.includes('could not be confirmed'));await h.click('Close');await h.click('Route / assign');assert.equal(h.button('Save routing').props.disabled,true);assert.equal(h.calls.post.length,1);}finally{h.close();}});
test('routing UI failed read stops, hides choices and needs explicit retry',async()=>{const h=client();try{h.transport(async()=>({status:503}));await h.click('Route / assign');assert.equal(h.calls.get.length,1);assert.ok(h.text.includes('could not be verified'));assert.equal(nodes(h.tree).filter(n=>n.type==='select').length,0);h.transport(async()=>({status:200,json:async()=>({data:valid()})}));await h.click('Reload choices');assert.equal(h.calls.get.length,2);}finally{h.close();}});
test('routing UI stale revision hides old options and rejects captured save callback',async()=>{const h=client();try{await h.click('Route / assign');await h.choose('Assignee','agent-a');const cb=h.button('Save routing').props.onClick;h.props({expectedUpdatedAt:'2026-10-16T00:00:01.000Z'});await cb();await h.settle();assert.equal(h.calls.post.length,0);assert.ok(!h.text.includes('New queue'));}finally{h.close();}});
test('routing UI employee and terminal states expose no action or read',async()=>{const h=client();try{h.session({role:'EMPLOYEE'});assert.equal(h.tree,null);h.session({role:'HR_OPERATIONS'});h.props({status:'CLOSED'});assert.equal(h.tree,null);assert.equal(h.calls.get.length,0);}finally{h.close();}});

// Deterministic transport for recovery tests: commits update the same mock
// parent and issue a matching receipt. This is not SQL acceptance evidence.
const nextRouting = 'Prepare new routing';
function routingServer(h) {
  let current = valid(), failRead = false, corruptReply = false;
  const writes = [];
  h.transport(async (url, init) => {
    if (init.method === 'POST') {
      const sent = JSON.parse(init.body);
      assert.equal(sent.expectedUpdatedAt, current.request.updatedAt);
      const updatedAt = new Date(Date.parse(sent.expectedUpdatedAt) + 1000).toISOString();
      current.request = { ...current.request, queue: sent.queue, assigneeId: sent.assigneeId, updatedAt };
      current.queue = sent.queue;
      writes.push(sent);
      return { status: 200, json: async () => ({ data: corruptReply ? {} : {
        ...current.request, writeReceipt: { requestId: 'ticket-a', tenantId: user.tenantId,
          actorId: user.id, operation: 'STATUS', expectedUpdatedAt: sent.expectedUpdatedAt,
          updatedAt, reason: null, queue: sent.queue, assigneeId: sent.assigneeId }
      } }) };
    }
    if (failRead) return { status: 403 };
    const data = structuredClone(current), q = new URL(url, 'http://localhost').searchParams;
    if (q.has('queue')) { data.initial = false; data.queue = q.get('queue') || null; }
    return { status: 200, json: async () => ({ data }) };
  });
  return { writes, get snapshot() { return current; }, get revision() { return current.request.updatedAt; },
    denyRead() { failRead = true; }, badReply() { corruptReply = true; } };
}
async function savedRouting(h, server) {
  await h.click('Route / assign'); await h.choose('Queue', 'NEW'); await h.choose('Assignee', 'agent-a');
  await h.click('Save routing'); assert.equal(server.writes.length, 1);
}
async function showReviewedRouting(h, server) {
  h.props({ expectedUpdatedAt: server.revision }); await h.settle();
  await h.click('Route / assign');
}
test('routing recovery: a confirmed save permits a second deliberate assignment without a document reload', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    assert.equal(h.button(nextRouting).props.disabled, true, 'receipt alone is not a current authorized read');
    await showReviewedRouting(h, server);
    assert.equal(h.button(nextRouting).props.disabled, false);
    await h.click(nextRouting);
    assert.equal(server.writes.length, 1, 'preparing is local, never a replay');
    assert.equal(h.button('Save routing').props.disabled, true, 'unchanged target stays disabled');
    await h.choose('Assignee', ''); await h.click('Save routing');
    assert.equal(server.writes.length, 2);
    assert.equal(server.writes[1].expectedUpdatedAt, '2026-10-16T00:00:01.000Z');
    assert.equal(server.writes[1].assigneeId, null);
  } finally { h.close(); }
});
for (const [name, alter] of [
  ['unexpected later revision', server => { server.snapshot.request.updatedAt = '2026-10-16T00:00:02.000Z'; }],
  ['different queue', server => { server.snapshot.queue = server.snapshot.request.queue = 'OTHER'; }],
  ['different assignee', server => { server.snapshot.request.assigneeId = null; }],
  ['unavailable queue', server => { server.snapshot.queueAvailable = false; server.snapshot.assignees = []; }]
]) test('routing recovery: ' + name + ' cannot clear the confirmed guard', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); alter(server);
    await showReviewedRouting(h, server);
    assert.equal(h.button(nextRouting).props.disabled, true);
    await h.click(nextRouting); await h.click('Save routing');
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: a denied fresh read cannot rearm a prior successful write', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); server.denyRead();
    await showReviewedRouting(h, server);
    assert.equal(h.button(nextRouting).props.disabled, true);
    await h.click(nextRouting); assert.equal(server.writes.length, 1);
    assert.equal(nodes(h.tree).filter(n => n.type === 'select').length, 0);
  } finally { h.close(); }
});
test('routing recovery: a captured prepare handler cannot rearm after a newer revision arrives', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); await showReviewedRouting(h, server);
    const prepare = h.button(nextRouting).props.onClick;
    h.props({ expectedUpdatedAt: '2026-10-16T00:00:02.000Z' }); await prepare(); await h.settle();
    // Return to the receipt version and read again; the old handler did not clear
    // the saved guard while another displayed record version was current.
    await showReviewedRouting(h, server);
    assert.equal(h.button('Save routing').props.disabled, true);
    assert.equal(h.button(nextRouting).props.disabled, false);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: a captured prepare handler cannot rearm under a different principal', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); await showReviewedRouting(h, server);
    const prepare = h.button(nextRouting).props.onClick;
    h.session({ id: 'other-user' }); await prepare(); await h.settle();
    h.session({ id: user.id }); await h.settle(); await h.click('Route / assign');
    assert.equal(h.button('Save routing').props.disabled, true);
    assert.equal(h.button(nextRouting).props.disabled, false);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: an uncertain committed result never exposes prepare, even after an exact reread', async () => {
  const h = client(); try {
    const server = routingServer(h); server.badReply(); await savedRouting(h, server);
    await showReviewedRouting(h, server);
    assert.ok(!nodes(h.tree).some(n => n.type === 'button' && label(n) === nextRouting));
    assert.equal(h.button('Save routing').props.disabled, true);
    await h.click('Reload choices'); await h.click('Save routing');
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: language changes preserve proof; preparing never automatically submits', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); await showReviewedRouting(h, server);
    h.props({ locale: 'tr' }); await h.settle();
    assert.equal(h.button('Yeni yönlendirme hazırla').props.disabled, false);
    await h.click('Yeni yönlendirme hazırla');
    assert.equal(server.writes.length, 1);
    assert.equal(h.button('Yönlendirmeyi kaydet').props.disabled, true);
    assert.equal(nodes(h.tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Kuyruk').props.disabled, false);
  } finally { h.close(); }
});


test('routing recovery: a previously enabled prepare callback cannot clear the guard after a failed reread', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server); await showReviewedRouting(h, server);
    const prepare = h.button(nextRouting).props.onClick;
    server.denyRead(); await h.click('Reload choices'); await prepare(); await h.settle();
    assert.equal(h.button(nextRouting).props.disabled, true);
    assert.ok(h.text.includes('was saved'));
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: a same-turn read blocks an old prepare handler before any rerender', async () => {
  const h = client(); let resolveRead;
  try {
    const server = routingServer(h); await savedRouting(h, server); await showReviewedRouting(h, server);
    const prepare = h.button(nextRouting).props.onClick;
    const blocked = new Promise(resolve => { resolveRead = resolve; });
    h.transport(async () => blocked);
    h.button('Reload choices').props.onClick();
    await prepare(); h.render();
    resolveRead({ status: 403 }); await h.settle();
    assert.ok(h.text.includes('was saved'));
    assert.equal(h.button(nextRouting).props.disabled, true);
    assert.equal(server.writes.length, 1);
  } finally { resolveRead?.({ status: 403 }); h.close(); }
});
