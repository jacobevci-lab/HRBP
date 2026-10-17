/** Recovery when router.refresh does not commit parent props. These execute
 * real components with controlled hook/transport doubles, not browser/SQL. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const result = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(result.diagnostics.filter(d => d.category === 1).length, 0);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, name => {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name); return mocks[name];
  });
  return module.exports;
}
const stamp = '2026-10-16T00:00:00.000Z';
const user = { id: 'actor-a', tenantId: 'tenant-a', role: 'HR_OPERATIONS' };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = compile('lib/hr-service-revision.ts');
const receipts = compile('components/hr-service-receipts.ts', { '@/lib/hr-service-revision': revision, '@/components/hr-service-action-state': { isObject } });
const contract = compile('components/hr-service-routing-contract.ts', { '@/lib/hr-service-revision': revision, '@/components/hr-service-action-state': { isObject }, '@/components/hr-service-receipts': receipts });
const valid = () => ({request:{id:'ticket-a',tenantId:'tenant-a',requestNumber:'QA-1',title:'Title',status:'OPEN',updatedAt:stamp,queue:null,assigneeId:null},viewer:{actorId:'actor-a',tenantId:'tenant-a',role:'HR_OPERATIONS'},initial:true,queue:null,queueAvailable:true,queues:[{key:'NEW',name:'New queue'}],assignees:[{id:'agent-a',displayName:'Agent'}],queuesTruncated:false,assigneesTruncated:false});
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
  // A known self-revision may catch up without dismissing this dialog.
  if (nodes(h.tree).find(n => n.type === 'dialog').props.ref.current.open) await h.click('Close');
  await h.click('Route / assign');
}

// Real CI showed router.refresh can leave the parent props unchanged after a
// confirmed write. Exercise that condition, not only manually refreshed props.
test('routing recovery: unchanged parent props can use the exact saved revision only after explicit reread and review', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    assert.equal(h.button(nextRouting).props.disabled, true);
    await h.click('Reload choices');
    assert.equal(h.button(nextRouting).props.disabled, false);
    await h.click(nextRouting);
    assert.equal(server.writes.length, 1);
    await h.choose('Assignee', ''); await h.click('Save routing');
    assert.equal(server.writes.length, 2);
    assert.equal(server.writes[1].expectedUpdatedAt, '2026-10-16T00:00:01.000Z');
    assert.equal(server.writes[1].assigneeId, null);
    // Another deliberate change is also bound to its preceding receipt, not
    // the still-unchanged initial parent revision.
    await h.click('Reload choices'); await h.click(nextRouting);
    await h.choose('Assignee', 'agent-a'); await h.click('Save routing');
    assert.equal(server.writes.length, 3);
    assert.equal(server.writes[2].expectedUpdatedAt, '2026-10-16T00:00:02.000Z');
  } finally { h.close(); }
});
test('routing recovery: closing a prepared form retains its reviewed revision without silently resetting the guard', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    await h.click('Close'); await h.click('Route / assign');
    await h.click(nextRouting); await h.click('Close'); await h.click('Route / assign');
    assert.equal(h.button('Save routing').props.disabled, true);
    await h.choose('Assignee', ''); await h.click('Save routing');
    assert.equal(server.writes.length, 2);
    assert.equal(server.writes[1].expectedUpdatedAt, '2026-10-16T00:00:01.000Z');
  } finally { h.close(); }
});
test('routing recovery: unchanged parent props cannot adopt an unrelated newer revision from a reread', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    server.snapshot.request.updatedAt = '2026-10-16T00:00:09.000Z';
    await h.click('Reload choices');
    assert.equal(h.button(nextRouting).props.disabled, true);
    assert.equal(nodes(h.tree).filter(n => n.type === 'select').length, 0);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: an unknown write cannot use a newer response to replace unchanged parent props', async () => {
  const h = client(); try {
    const server = routingServer(h); server.badReply(); await savedRouting(h, server);
    await h.click('Reload choices');
    assert.ok(!nodes(h.tree).some(n => n.type === 'button' && label(n) === nextRouting));
    assert.equal(nodes(h.tree).filter(n => n.type === 'select').length, 0);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});

test('routing recovery: parent catching up to a confirmed revision does not close an explicitly reopened dialog', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    await h.click('Close'); await h.click('Route / assign');
    assert.equal(h.button(nextRouting).props.disabled, false);
    h.props({ expectedUpdatedAt: server.revision }); await h.settle();
    assert.equal(h.button(nextRouting).props.disabled, false, 'a delayed render of our own receipt must not discard the verified page');
    assert.equal(nodes(h.tree).find(n => n.type === 'dialog').props.ref.current.open, true);
    await h.click(nextRouting);
    assert.equal(nodes(h.tree).find(n => n.type === 'dialog').props.ref.current.open, true, 'preparing must retain the dialog generation');
    await h.choose('Assignee', ''); await h.click('Save routing');
    assert.equal(server.writes.length, 2);
    assert.equal(server.writes[1].expectedUpdatedAt, '2026-10-16T00:00:01.000Z');
  } finally { h.close(); }
});
test('routing recovery: parent catching up while the explicit reread is pending preserves only that read', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    let release;
    h.transport(async () => new Promise(resolve => { release = resolve; }));
    const reading = h.click('Reload choices'); await h.settle();
    h.props({ expectedUpdatedAt: server.revision }); await h.settle();
    assert.equal(h.calls.get.at(-1).signal.aborted, false, 'known self-revision refresh must not abort explicit read');
    release({ status: 200, json: async () => ({ data: structuredClone(server.snapshot) }) });
    await reading; await h.settle();
    assert.equal(h.button(nextRouting).props.disabled, false);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
test('routing recovery: independent parent revision closes the dialog and cannot rearm using the old receipt', async () => {
  const h = client(); try {
    const server = routingServer(h); await savedRouting(h, server);
    await h.click('Reload choices');
    h.props({ expectedUpdatedAt: '2026-10-16T00:00:10.000Z' }); await h.settle();
    assert.equal(nodes(h.tree).find(n => n.type === 'dialog').props.ref.current.open, false);
    assert.equal(h.button(nextRouting).props.disabled, true);
    assert.equal(server.writes.length, 1);
  } finally { h.close(); }
});
