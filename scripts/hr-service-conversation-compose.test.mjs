/** Actual composer/shared guard with deterministic hook and transport doubles.
 * API authorization and native browser interaction have separate CI coverage. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const out = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(out.diagnostics.filter(d => d.category === 1).length, 0);
  const m = { exports: {} }; new Function('module', 'exports', 'require', out.outputText)(m, m.exports, name => {
    assert.ok(name in mocks, 'Unexpected ' + name); return mocks[name];
  }); return m.exports;
}
const revision = compile('lib/hr-service-revision.ts');
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const receipts = compile('components/hr-service-receipts.ts', { '@/lib/hr-service-revision': revision, '@/components/hr-service-action-state': { isObject } });
const contract = compile('components/hr-service-conversation-contract.ts', { '@/components/hr-service-receipts': receipts });
const stamp = '2026-10-17T10:00:00.000Z', next = '2026-10-17T10:00:01.000Z';
const actor = { id: 'staff-a', tenantId: 'tenant-a', role: 'HR_OPERATIONS' };
function page(user = actor) { return { request: { id: 'ticket-a', tenantId: user.tenantId, requestNumber: 'HR-QA', title: 'QA', description: 'Synthetic', status: 'IN_PROGRESS', updatedAt: stamp }, viewer: { actorId: user.id, tenantId: user.tenantId, role: user.role, privateNotes: receipts.serviceStaffRoles.has(user.role) }, before: null, nextCursor: null, comments: [] }; }
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : [];
const text = n => Array.isArray(n) ? n.map(text).join('') : n == null || typeof n === 'boolean' ? '' : typeof n === 'object' ? text(n.props?.children) : String(n);
function client(role = 'HR_OPERATIONS') {
  const original = { fetch: globalThis.fetch, window: globalThis.window };
  let user = { ...actor, role }, auth = true, loading = false, currentPage = page(user), props = { requestId: 'ticket-a', active: true, locale: 'en' };
  let tree, cursor = 0, slots = [], effects = [], confirms = true, fail = null;
  const calls = { posts: [], confirms: [], refresh: 0, invalidates: 0 };
  const response = body => ({ status: 201, json: async () => ({ data: body }) });
  let transport = async (url, init) => {
    const body = JSON.parse(init.body); return response({ id: 'comment-a', tenantId: user.tenantId, requestId: 'ticket-a', authorId: user.id,
      body: body.body, visibility: body.visibility, createdAt: next, writeReceipt: { requestId: 'ticket-a', tenantId: user.tenantId,
        actorId: user.id, operation: 'COMMENT', expectedUpdatedAt: body.expectedUpdatedAt, updatedAt: new Date(Date.parse(body.expectedUpdatedAt)+1000).toISOString() } });
  };
  globalThis.fetch = (url, init) => { calls.posts.push({ url, ...init }); return transport(url, init); };
  globalThis.window = { confirm: message => { calls.confirms.push(message); return confirms; }, dispatchEvent() {}, location: { reload() {} } };
  const react = { useState(v) { const i=cursor++; if(!(i in slots)) slots[i]=v; return [slots[i], v=> {slots[i]=typeof v==='function'?v(slots[i]):v;}]; },
    useRef(v) { const i=cursor++; return slots[i]??={current:v}; }, useId() {return 'compose-'+cursor++;},
    useEffect(fn,deps) { const i=cursor++, prev=slots[i]; if(!prev || deps.some((d,j)=>!Object.is(d,prev.deps[j]))) {slots[i]={deps,cleanup:prev?.cleanup}; effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});} } };
  const jsx = (type,props)=>({type,props});
  const mocks = { react, 'react/jsx-runtime':{jsx,jsxs:jsx}, 'next/navigation':{useRouter:()=>({refresh:()=>{calls.refresh++; if(fail)throw Error('refresh');}})},
    '@/components/session-provider':{useSessionContext:()=>({session:{authenticated:auth,user},loading})},
    '@/components/hr-service-receipts':receipts, '@/components/hr-service-conversation-contract':contract,
    '@/components/hr-service-conversation-compose.module.css':{default:new Proxy({},{get:(_,k)=>k})} };
  mocks['@/components/hr-service-action-state']=compile('components/hr-service-action-state.ts',mocks);
  const component=compile('components/hr-service-conversation-compose.tsx',mocks).HRServiceConversationCompose;
  const invalidate=()=>{ calls.invalidates++; currentPage=null; };
  function render(){cursor=0;tree=component({...props,page:currentPage,invalidate});const run=effects;effects=[];run.forEach(fn=>fn());return tree;}
  async function settle(){for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));render();}}
  function button(name){const n=nodes(tree).find(n=>n.type==='button'&&text(n)===name);assert.ok(n,'Missing '+name+' in '+text(tree));return n;}
  render();render();
  return {calls,render,settle,button,get tree(){return tree;},get text(){return text(tree);},get draft(){return nodes(tree).find(n=>n.type==='textarea')?.props.value;},
    type(v){const n=nodes(tree).find(n=>n.type==='textarea');assert.ok(n);n.props.onChange({target:{value:v}});render();},
    async select(v){const n=nodes(tree).find(n=>n.type==='select');assert.ok(n);n.props.onChange({target:{value:v}});render();await settle();},
    async click(n){const p=button(n).props.onClick();render();await p;await settle();},confirm(v){confirms=v;},transport(fn){transport=fn;},failRefresh(){fail=true;},
    async props(v){props={...props,...v};render();await settle();},async page(v){currentPage=v;render();await settle();},
    async session(v){user={...user,...v};render();await settle();},async logout(){auth=false;render();await settle();},
    close(){slots.forEach(s=>s?.cleanup?.());globalThis.fetch=original.fetch;globalThis.window=original.window;}
  };
}
function savedPage(visibility='REQUESTOR') { const p=page(); p.request.updatedAt=next; p.comments=[{id:'comment-a',body:'Test message',visibility,createdAt:next,authorName:'Staff',own:true}];return p; }
test('composer is lazy and sends exactly the displayed revision, trimmed body and public visibility',async()=>{const h=client();try{assert.equal(h.calls.posts.length,0);h.type('  Test message  ');await h.click('Send reply');assert.equal(h.calls.posts.length,1);assert.deepEqual(JSON.parse(h.calls.posts[0].body),{body:'Test message',visibility:'REQUESTOR',expectedUpdatedAt:stamp});assert.equal(h.draft,'');assert.ok(h.text.includes('was saved'));}finally{h.close();}});
for(const role of ['EMPLOYEE','MANAGER','HRBP','HR_OPERATIONS','TENANT_ADMIN'])test('composer visibility control matches service role '+role,async()=>{const h=client(role);try{assert.equal(nodes(h.tree).filter(n=>n.type==='select').length,receipts.serviceStaffRoles.has(role)?1:0);}finally{h.close();}});
for(const role of ['LEGAL','SECURITY_AUDITOR','RECRUITER'])test('ungranted role never receives a composer '+role,async()=>{const h=client(role);try{assert.equal(h.tree,null);assert.equal(h.calls.posts.length,0);}finally{h.close();}});
for(const status of ['CLOSED','CANCELLED'])test('terminal '+status+' remains read-only',async()=>{const h=client();try{const p=page();p.request.status=status;await h.page(p);assert.equal(nodes(h.tree).filter(n=>['textarea','select'].includes(n.type)).length,0);}finally{h.close();}});
test('older page cannot create a new reply',async()=>{const h=client();try{const p=page();p.before='earlier';await h.page(p);assert.ok(h.text.includes('Older messages'));assert.equal(nodes(h.tree).filter(n=>n.type==='textarea').length,0);}finally{h.close();}});
for(const value of ['', '  ', 'x'.repeat(4001)])test('invalid message length '+value.length+' sends no request',async()=>{const h=client();try{h.type(value);await h.click('Send reply');assert.equal(h.calls.posts.length,0);}finally{h.close();}});
test('cancelled confirmation does not post or lose the draft',async()=>{const h=client();try{h.type('Test message');h.confirm(false);await h.click('Send reply');assert.equal(h.calls.posts.length,0);assert.equal(h.draft,'Test message');}finally{h.close();}});
test('two callbacks before render submit once',async()=>{const h=client();try{h.type('Test message');const cb=h.button('Send reply').props.onClick;await Promise.all([cb(),cb()]);await h.settle();assert.equal(h.calls.posts.length,1);}finally{h.close();}});
test('switching a nonempty private draft to public needs separate confirmation',async()=>{const h=client();try{await h.select('PRIVATE_NOTE');h.type('Private draft');h.confirm(false);await h.select('REQUESTOR');assert.ok(h.button('Save private note'));assert.equal(h.calls.posts.length,0);h.confirm(true);await h.select('REQUESTOR');assert.ok(h.button('Send reply'));assert.equal(h.draft,'Private draft');}finally{h.close();}});
test('private send uses explicit visibility and private confirmation',async()=>{const h=client();try{await h.select('PRIVATE_NOTE');h.type('Private draft');await h.click('Save private note');assert.equal(JSON.parse(h.calls.posts[0].body).visibility,'PRIVATE_NOTE');assert.match(h.calls.confirms.at(-1),/requester cannot see/);}finally{h.close();}});
test('employee reply on resolved request discloses reopening before posting',async()=>{const h=client('EMPLOYEE');try{const p=page({...actor,role:'EMPLOYEE'});p.request.status='RESOLVED';await h.page(p);h.type('Please reopen');await h.click('Send reply');assert.match(h.calls.confirms.at(-1),/reopen/);}finally{h.close();}});
for(const fault of ['network','body','visibility','actor','revision','status'])test('unconfirmed '+fault+' result preserves draft and guard through close/read/locale changes',async()=>{const h=client();try{h.type('Test message');h.transport(async()=>{if(fault==='network')throw Error('lost');const d={id:'comment-a',tenantId:actor.tenantId,requestId:'ticket-a',authorId:actor.id,body:'Test message',visibility:'REQUESTOR',createdAt:next,writeReceipt:{requestId:'ticket-a',tenantId:actor.tenantId,actorId:actor.id,operation:'COMMENT',expectedUpdatedAt:stamp,updatedAt:next}};if(fault==='body')d.body='Other';if(fault==='visibility')d.visibility='PRIVATE_NOTE';if(fault==='actor')d.authorId='other';if(fault==='revision')d.writeReceipt.expectedUpdatedAt=next;return {status:fault==='status'?503:201,json:async()=>({data:d})};});await h.click('Send reply');assert.equal(h.draft,'Test message');await h.props({active:false});await h.props({active:true,locale:'tr'});await h.page(savedPage());assert.equal(h.button('Yanıtı gönder').props.disabled,true);assert.equal(h.calls.posts.length,1);assert.ok(!h.text.includes('Yeni mesaj hazırla'));}finally{h.close();}});
test('confirmed save requires explicit latest read containing the confirmed message before next draft',async()=>{const h=client();try{h.type('Test message');await h.click('Send reply');assert.equal(h.button('Prepare another message').props.disabled,true);await h.page(savedPage());assert.equal(h.button('Prepare another message').props.disabled,false);await h.click('Prepare another message');assert.equal(h.calls.posts.length,1);h.type('Second message');await h.click('Send reply');assert.equal(h.calls.posts.length,2);assert.equal(JSON.parse(h.calls.posts[1].body).expectedUpdatedAt,next);}finally{h.close();}});
for(const fault of ['missing-message','newer-revision','not-own','wrong-visibility'])test('saved guard remains if reread has '+fault,async()=>{const h=client();try{h.type('Test message');await h.click('Send reply');const p=savedPage();if(fault==='missing-message')p.comments=[];if(fault==='newer-revision')p.request.updatedAt='2026-10-17T10:00:02.000Z';if(fault==='not-own')p.comments[0].own=false;if(fault==='wrong-visibility')p.comments[0].visibility='PRIVATE_NOTE';await h.page(p);assert.equal(h.button('Prepare another message').props.disabled,true);await h.click('Prepare another message');assert.equal(h.calls.posts.length,1);}finally{h.close();}});
test('refreshed unsent draft needs deliberate revision review',async()=>{const h=client();try{h.type('Preserve me');const p=page();p.request.updatedAt=next;await h.page(p);assert.equal(h.draft,'Preserve me');assert.equal(h.button('Send reply').props.disabled,true);await h.click('Use reviewed conversation');assert.equal(h.calls.posts.length,0);await h.click('Send reply');assert.equal(JSON.parse(h.calls.posts[0].body).expectedUpdatedAt,next);}finally{h.close();}});
for(const change of ['page','close','actor','role','request','logout'])test('captured send rejected after '+change,async()=>{const h=client();try{h.type('Private content');const cb=h.button('Send reply').props.onClick;if(change==='page')await h.page(null);if(change==='close')await h.props({active:false});if(change==='actor')await h.session({id:'other'});if(change==='role')await h.session({role:'EMPLOYEE'});if(change==='request')await h.props({requestId:'other'});if(change==='logout')await h.logout();await cb();await h.settle();assert.equal(h.calls.posts.length,0);if(['actor','role','request','logout'].includes(change))assert.ok(!h.text.includes('Private content'));}finally{h.close();}});
test('permission denial removes the parent history through explicit invalidation',async()=>{const h=client();try{h.type('Test message');h.transport(async()=>({status:403}));await h.click('Send reply');assert.equal(h.calls.invalidates,1);assert.equal(h.tree,null);}finally{h.close();}});
test('read failure and close hide composer without evicting uncertain outcome',async()=>{const h=client();try{h.type('Test message');h.transport(async()=>{throw Error('lost');});await h.click('Send reply');await h.page(null);assert.equal(h.tree,null);await h.page(page());assert.equal(h.draft,'Test message');assert.equal(h.button('Send reply').props.disabled,true);}finally{h.close();}});
test('confirmed result arriving while dialog is closed remains saved on reentry',async()=>{const h=client();let release;try{h.type('Test message');h.transport(async()=>new Promise(r=>{release=r;}));const writing=h.click('Send reply');await h.settle();await h.props({active:false});release({status:201,json:async()=>({data:{id:'comment-a',tenantId:actor.tenantId,requestId:'ticket-a',authorId:actor.id,body:'Test message',visibility:'REQUESTOR',createdAt:next,writeReceipt:{requestId:'ticket-a',tenantId:actor.tenantId,actorId:actor.id,operation:'COMMENT',expectedUpdatedAt:stamp,updatedAt:next}}})});await writing;await h.props({active:true});assert.ok(h.text.includes('was saved'));assert.equal(h.calls.posts.length,1);assert.equal(h.draft,'');}finally{h.close();}});
test('confirmed save does not turn into unknown when router refresh throws',async()=>{const h=client();try{h.failRefresh();h.type('Test message');await h.click('Send reply');assert.ok(h.text.includes('was saved'));assert.equal(h.calls.posts.length,1);}finally{h.close();}});
test('history keeps composer mounted and reuses a queued-close guard',()=>{const src=readFileSync('components/hr-service-conversation.tsx','utf8');assert.match(src,/<HRServiceConversationCompose/);assert.match(src,/closeEvents\.current/);assert.ok(src.indexOf('<HRServiceConversationCompose')>src.indexOf('</> : null}'));});

test('history session loading hides its root instead of unmounting the composer outcome guard',()=>{const src=readFileSync('components/hr-service-conversation.tsx','utf8');assert.doesNotMatch(src,/if \(!allowed\) return null/);assert.match(src,/hidden=\{!allowed\}/);assert.match(src,/disabled=\{!allowed\}/);});

test('denial invalidates history once but an explicit reauthorized read can still display the conversation',async()=>{const h=client();try{h.type('Draft');h.transport(async()=>({status:403}));await h.click('Send reply');assert.equal(h.calls.invalidates,1);assert.equal(h.tree,null);await h.page(page());assert.equal(h.calls.invalidates,1);assert.notEqual(h.tree,null);assert.equal(h.button('Send reply').props.disabled,true);assert.equal(h.calls.posts.length,1);}finally{h.close();}});
test('explicit reload of an uncertain draft requires discard confirmation and never posts again',async()=>{const h=client();try{h.type('Keep me');h.transport(async()=>{throw Error('lost');});await h.click('Send reply');h.confirm(false);await h.click('Reload current request');assert.equal(h.draft,'Keep me');assert.equal(h.calls.posts.length,1);assert.match(h.calls.confirms.at(-1),/discarded/);}finally{h.close();}});
