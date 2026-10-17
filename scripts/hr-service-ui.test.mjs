/** Component tests with controlled dependencies; real Next/PostgreSQL evidence
 * comes from hr-service-browser.mjs, not this synthetic hook renderer. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
function compile(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const m = { exports: {} }; new Function('module','exports','require',js)(m,m.exports,name=>{
    if (!(name in mocks)) throw Error('Unexpected dependency ' + name); return mocks[name];
  }); return m.exports;
}
const flatten = n => Array.isArray(n) ? n.flatMap(flatten) : !n || typeof n !== 'object' ? [] : [n, ...flatten(n.props?.children)];
const text = n => Array.isArray(n) ? n.map(text).join('') : n == null || typeof n === 'boolean' ? '' : typeof n === 'object' ? text(n.props?.children) : String(n);
const stamp = '2026-10-16T12:00:00.000Z';
const revision = '2026-10-16T11:59:59.000Z';
const user = { id:'actor-a', tenantId:'tenant-a', role:'HR_OPERATIONS', employmentId:'employee-a' };
const sent = { category:'Benefits', subcategory:'QA', title:'Synthetic service request', description:'Synthetic request body', priority:'MEDIUM' };
const replyBody = 'Synthetic private or public text';
function receipt(kind, body) {
  if (kind === 'intake') return { ...body, subcategory:body.subcategory || null, id:'ticket-a', requestNumber:'HR-2026-ABCDE123', tenantId:user.tenantId, requestorId:user.id, subjectEmploymentId:null, status:'OPEN', createdAt:stamp };
  const writeReceipt = {requestId:'ticket-a',tenantId:user.tenantId,actorId:user.id,operation:kind==='transition'?'STATUS':'COMMENT',expectedUpdatedAt:body.expectedUpdatedAt,updatedAt:stamp,reason:body.reason??null};
  if (kind === 'transition') return { id:'ticket-a', tenantId:user.tenantId, status:body.status, updatedAt:stamp, writeReceipt };
  return { id:'comment-a', requestId:'ticket-a', tenantId:user.tenantId, authorId:user.id, body:body.body, visibility:body.visibility, createdAt:stamp, writeReceipt };
}
const response = (status, data, extra={}) => ({ status, ok:status>=200&&status<300, redirected:false, json:async()=>({data}), ...extra });
function harness(kind='intake') {
  const old = { window:globalThis.window, fetch:globalThis.fetch };
  let props={requestId:'ticket-a',status:'OPEN',locale:'en',staff:true,expectedUpdatedAt:revision}, principal={...user}, authenticated=true, loading=false;
  const slots=[]; let cursor=0, effects=[], tree, confirmation=true, refreshFailure=false;
  const calls={posts:[],patches:[],confirms:[],refresh:0,events:[],reload:0};
  let transport = async (_url, init) => response(kind==='transition'?200:201, receipt(kind, JSON.parse(init.body)));
  globalThis.window={confirm:msg=>{calls.confirms.push(msg);return typeof confirmation==='function'?confirmation():confirmation;},dispatchEvent:e=>calls.events.push(e.type),location:{reload:()=>{calls.reload++;}}};
  globalThis.fetch=async(url,init)=>{if(init.method==='PATCH'){calls.patches.push({url,...init});return response(200,{});}calls.posts.push({url,...init});return transport(url,init);};
  const react={
    useRef(v){const i=cursor++;return slots[i]??={current:v};},
    useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
    useId(){const i=cursor++;return `field-${i}`;},
    useEffect(fn,deps){const i=cursor++,s=slots[i];if(!s||deps?.some((v,j)=>!Object.is(v,s.deps?.[j]))){slots[i]={deps,cleanup:s?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
  };
  const jsx=(type,props)=>({type,props});
  const mocks={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    'next/navigation':{useRouter:()=>({refresh:()=>{calls.refresh++;if(refreshFailure)throw Error('RAW_PRIVATE_REFRESH');}})},
    '@/components/session-provider':{useSessionContext:()=>({session:{authenticated,user:principal},loading})},
    '@/components/hr-service-actions.module.css':{default:new Proxy({},{get:(_,k)=>k})}};
  mocks['@/lib/hr-service-revision']=compile('lib/hr-service-revision.ts',mocks);
  mocks['@/components/hr-service-action-state']=compile('components/hr-service-action-state.ts',mocks);
  mocks['@/components/hr-service-receipts']=compile('components/hr-service-receipts.ts',mocks);
  const filename=kind==='intake'?'hr-service-request-form.tsx':'hr-service-lifecycle-actions.tsx';
  const path=process.env.HRBP_SERVICE_BASELINE?resolve(process.env.HRBP_SERVICE_BASELINE,'components',filename):`components/${filename}`;
  const exported=compile(path,mocks); const component=exported[kind==='intake'?'HRServiceRequestForm':'HRServiceLifecycleActions'];
  function render(){cursor=0;tree=component(props);const list=effects;effects=[];list.forEach(f=>f());return tree;}
  async function settle(){for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));render();}}
  const controls=()=>flatten(tree).filter(n=>['input','textarea','select'].includes(n.type));
  function set(index,value){const field=controls()[index];assert.ok(field,`control ${index}`);field.props.onChange({target:{value}});render();}
  function button(label){return flatten(tree).find(n=>n.type==='button'&&text(n).trim()===label);}
  function handler(){if(kind==='intake')return flatten(tree).find(n=>n.type==='form')?.props.onSubmit;return button(kind==='transition'?'Apply transition':kind==='private'?'Private HR note':'Add reply')?.props.onClick;}
  render();
  return {calls,render,settle,set,button,handler,
    get tree(){return tree;},get text(){return text(tree);},get controls(){return controls();},
    async submit(){const fn=handler();assert.ok(fn,'submit handler exists');const p=fn({preventDefault(){}});render();await p;await settle();},
    transport(fn){transport=fn;},confirm(v){confirmation=v;},failRefresh(){refreshFailure=true;},
    props(p){props={...props,...p};render();},session(p){principal={...principal,...p};render();},authenticated(v){authenticated=v;render();},loading(v){loading=v;render();},
    close(){slots.forEach(s=>s?.cleanup?.());globalThis.fetch=old.fetch;globalThis.window=old.window;}
  };
}
function prepared(kind){const h=harness(kind);if(kind==='intake'){h.set(0,sent.category);h.set(1,sent.subcategory);h.set(2,sent.priority);h.set(3,sent.title);h.set(4,sent.description);}else if(kind!=='transition')h.set(2,replyBody);return h;}
for(const kind of ['intake','transition','reply','private']) {
  test(`${kind}: cancelling explicit confirmation sends nothing`,async()=>{const h=prepared(kind);try{h.confirm(false);await h.submit();assert.equal(h.calls.posts.length,0);assert.equal(h.calls.confirms.length,1);}finally{h.close();}});
  test(`${kind}: simultaneous callbacks make one POST`,async()=>{const h=prepared(kind);const finish=[];try{h.transport((_u,init)=>new Promise(r=>{finish.push(()=>r(response(kind==='transition'?200:201,receipt(kind,JSON.parse(init.body)))));}));const cb=h.handler();const a=cb({preventDefault(){}}),b=cb({preventDefault(){}});h.render();const count=h.calls.posts.length;finish.forEach(f=>f());await Promise.all([a,b]);await h.settle();assert.equal(count,1);}finally{finish.forEach(f=>f());h.close();}});
  for(const [name,mutate] of [
    ['wrong record',d=>({...d,...(kind==='intake'?{title:'Wrong request'}:kind==='transition'?{id:'other'}:{requestId:'other'})})],
    ['foreign tenant',d=>({...d,tenantId:'other'})],
    ['wrong state or visibility',d=>({...d,...(kind==='reply'||kind==='private'?{visibility:'STAFF'}:{status:'CLOSED'})})],
    ['missing receipt',()=>null],
    ['malformed time',d=>({...d,createdAt:'bad',updatedAt:'bad'})]
  ]) test(`${kind}: ${name} is not a confirmed save or replay permission`,async()=>{const h=prepared(kind);try{h.transport(async(_u,init)=>response(kind==='transition'?200:201,mutate(receipt(kind,JSON.parse(init.body)))));await h.submit();assert.equal(h.calls.refresh,0);assert.equal(h.calls.patches.length,0);assert.match(h.text,/could not be confirmed/);await h.submit();assert.equal(h.calls.posts.length,1);}finally{h.close();}});
  test(`${kind}: lost response preserves draft and remains blocked`,async()=>{const h=prepared(kind);try{h.transport(async()=>{throw Error('RAW_NETWORK_PRIVATE');});await h.submit();assert.doesNotMatch(h.text,/RAW_NETWORK_PRIVATE/);if(kind==='intake')assert.equal(h.controls[3].props.value,sent.title);if(kind==='reply'||kind==='private')assert.equal(h.controls[2].props.value,replyBody);await h.submit();assert.equal(h.calls.posts.length,1);assert.equal(h.calls.refresh,0);}finally{h.close();}});
  test(`${kind}: correct receipt is saved even if refresh throws`,async()=>{const h=prepared(kind);try{h.failRefresh();await h.submit();assert.match(h.text,/action was saved/);assert.doesNotMatch(h.text,/RAW_PRIVATE_REFRESH/);assert.equal(h.calls.posts.length,1);assert.equal(h.calls.refresh,1);}finally{h.close();}});
  test(`${kind}: raw server diagnostics are never displayed`,async()=>{const h=prepared(kind);try{h.transport(async()=>({status:500,ok:false,json:async()=>({error:'RAW_PRIVATE_DATABASE'})}));await h.submit();assert.doesNotMatch(h.text,/RAW_PRIVATE_DATABASE/);assert.match(h.text,/could not be confirmed/);}finally{h.close();}});
  test(`${kind}: a captured callback cannot write under a changed principal`,async()=>{const h=prepared(kind);try{const cb=h.handler();h.session({id:'actor-b'});await cb({preventDefault(){}});await h.settle();assert.equal(h.calls.posts.length,0);}finally{h.close();}});
}

test('intake: whitespace-only required values stop before POST',async()=>{const h=prepared('intake');try{h.set(0,'   ');await h.submit();assert.equal(h.calls.posts.length,0);assert.match(h.text,/Required fields/);}finally{h.close();}});
test('intake: explicit new draft is only available after a validated save',async()=>{const h=prepared('intake');try{await h.submit();assert.ok(h.button('Create another request'));h.button('Create another request').props.onClick();h.render();assert.equal(h.controls[3].props.value,'');assert.equal(h.button('Create request').props.disabled,false);}finally{h.close();}});
test('intake: read-only/unauthenticated/loading sessions have no write form',()=>{const h=prepared('intake');try{h.authenticated(false);assert.equal(h.tree,null);h.authenticated(true);h.loading(true);assert.equal(h.tree,null);h.loading(false);h.session({role:'RECRUITER'});assert.equal(h.tree,null);}finally{h.close();}});
test('lifecycle: refreshed status resets the selected next target',()=>{const h=prepared('transition');try{assert.equal(h.controls[0].props.value,'TRIAGE');h.props({status:'TRIAGE'});assert.equal(h.controls[0].props.value,'IN_PROGRESS');}finally{h.close();}});
test('lifecycle: terminal states remain read-only even when the component is mounted directly',()=>{const h=prepared('reply');try{h.props({status:'CLOSED'});assert.equal(h.handler(),undefined);assert.match(h.text,/Read only/);}finally{h.close();}});
test('lifecycle: short reopen reason cannot transition',async()=>{const h=prepared('transition');try{h.props({status:'RESOLVED'});h.set(0,'IN_PROGRESS');h.set(1,'short');await h.submit();assert.equal(h.calls.posts.length,0);}finally{h.close();}});
test('private note: confirmation explicitly distinguishes requester visibility',async()=>{const h=prepared('private');try{h.confirm(false);await h.submit();assert.match(h.calls.confirms[0],/not visible to the requester/);}finally{h.close();}});
test('reply: body and author substitutions never validate',async()=>{for(const change of [{authorId:'other'}, {body:'Other reply'}]){const h=prepared('reply');try{h.transport(async(_u,init)=>response(201,{...receipt('reply',JSON.parse(init.body)),...change}));await h.submit();assert.match(h.text,/could not be confirmed/);assert.equal(h.calls.refresh,0);}finally{h.close();}}});
test('reply: draft length mirrors server limit even for programmatic handlers',async()=>{const h=prepared('reply');try{h.set(2,'x'.repeat(4001));await h.submit();assert.equal(h.calls.posts.length,0);}finally{h.close();}});
test('lifecycle: employee cannot use a stale staff transition/private callback',async()=>{const h=prepared('private');try{const cb=h.handler();h.session({role:'EMPLOYEE'});await cb();await h.settle();assert.equal(h.calls.posts.length,0);assert.equal(h.button('Private HR note'),undefined);}finally{h.close();}});
test('all visible input controls have stable accessible names',()=>{for(const kind of ['intake','transition']){const h=prepared(kind);try{assert.ok(h.controls.every(c=>Boolean(c.props['aria-label'])));}finally{h.close();}}});
test('locale change translates existing unknown feedback without another request',async()=>{const h=prepared('reply');try{h.transport(async()=>{throw Error('offline');});await h.submit();h.props({locale:'tr'});assert.match(h.text,/sonucu doğrulanamadı/);assert.equal(h.calls.posts.length,1);}finally{h.close();}});
test('record switch and return retain unknown outcome without retaining other record drafts',async()=>{const h=prepared('reply');try{h.transport(async()=>{throw Error('offline');});await h.submit();h.props({requestId:'ticket-b'});assert.equal(h.controls[2].props.value,'');h.props({requestId:'ticket-a'});assert.match(h.text,/could not be confirmed/);await h.submit();assert.equal(h.calls.posts.length,1);}finally{h.close();}});

for (const kind of ['transition', 'reply', 'private']) {
  test(`revision ${kind}: sends the displayed version, never a submit-time reread`, async () => { const h=prepared(kind);try {await h.submit();assert.equal(JSON.parse(h.calls.posts[0].body).expectedUpdatedAt,revision);}finally{h.close();} });
  test(`revision ${kind}: missing version cannot issue a mutation`, async () => {const h=prepared(kind);try{h.props({expectedUpdatedAt:undefined});await h.submit();assert.equal(h.calls.posts.length,0);}finally{h.close();}});
  test(`revision ${kind}: same-status refresh preserves draft and requires explicit review`, async () => {const h=prepared(kind);try{h.props({expectedUpdatedAt:stamp});await h.submit();assert.equal(h.calls.posts.length,0);if(kind!=='transition')assert.equal(h.controls[2].props.value,replyBody);h.button('Use reviewed current version').props.onClick();h.render();await h.submit();assert.equal(JSON.parse(h.calls.posts[0].body).expectedUpdatedAt,stamp);}finally{h.close();}});
  test(`revision ${kind}: version changed during confirmation cancels the captured write`, async () => {const h=prepared(kind);try{h.confirm(()=>{h.props({expectedUpdatedAt:stamp});return true;});await h.submit();assert.equal(h.calls.posts.length,0);}finally{h.close();}});
  for (const fault of ['missing','stale','actor','operation','result-version']) test(`revision ${kind}: ${fault} write receipt cannot report success`,async()=>{const h=prepared(kind);try{h.transport(async(_u,init)=>{const d=receipt(kind,JSON.parse(init.body));if(fault==='missing')delete d.writeReceipt;else if(fault==='stale')d.writeReceipt.expectedUpdatedAt=stamp;else if(fault==='actor')d.writeReceipt.actorId='other';else if(fault==='operation')d.writeReceipt.operation='INTAKE';else d.writeReceipt.updatedAt=revision;return response(kind==='transition'?200:201,d);});await h.submit();assert.equal(h.calls.refresh,0);assert.match(h.text,/could not be confirmed/);h.props({expectedUpdatedAt:stamp});await h.submit();assert.equal(h.calls.posts.length,1);assert.equal(h.button('Use reviewed current version'),undefined);}finally{h.close();}});
}
test('revision: changed transition reason cannot confirm a matching status receipt', async()=>{const h=prepared('transition');try{h.set(1,'Synthetic expected reason');h.transport(async(_u,init)=>{const d=receipt('transition',JSON.parse(init.body));d.writeReceipt.reason='other reason';return response(200,d);});await h.submit();assert.equal(h.calls.refresh,0);assert.equal(h.controls[1].props.value,'Synthetic expected reason');}finally{h.close();}});
test('revision: next action stays blocked until the confirmed version is rendered',async()=>{const h=prepared('reply');try{await h.submit();assert.equal(h.button('Prepare next action').props.disabled,true);h.props({expectedUpdatedAt:stamp});assert.equal(h.button('Prepare next action').props.disabled,false);h.button('Prepare next action').props.onClick();h.render();assert.equal(h.controls[2].props.disabled,false);}finally{h.close();}});
