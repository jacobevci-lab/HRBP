/** Executable component doubles. Browser/SQL evidence comes from the separate
 * loopback-only policy-forms-browser workflow script, not these doubles. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics:true, compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX } });
  assert.equal(compiled.diagnostics?.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
  const module={exports:{}};new Function('module','exports','require',compiled.outputText)(module,module.exports,name=>{assert.ok(name in mocks,`Unexpected dependency ${name}`);return mocks[name];});return module.exports;
}
const contract=compile('components/policy-form-contract.ts');
const option=(id='employee-a',extra={})=>({id,name:'Synthetic employee',employeeNumber:'QA',position:'Synthetic role',organization:'Synthetic org',assigned:false,assignmentStatus:null,dueAt:null,...extra});
const options=()=>({policyId:'policy-a',tenantId:'tenant-a',relationshipScoped:true,employments:[option()]});
const user=()=>({id:'actor-a',tenantId:'tenant-a',employmentId:'employee-a',role:'EMPLOYEE'});
const batch = (employmentIds=['employee-a'], dueAt=null) => ({ employmentIds, dueAt });
const exceptionInput = () => ({ reason: 'Synthetic reason', compensatingControl: null, expiresAt: null });
const receipt=(kind,decision='APPROVE')=>kind==='assign'?{policyId:'policy-a',tenantId:'tenant-a',assigned:1,requested:1,skippedExisting:0,request:batch()}:kind==='request'?{id:'exception-a',policyId:'policy-a',tenantId:'tenant-a',employmentId:'employee-a',requestedById:'actor-a',status:'REQUESTED',active:false,createdAt:new Date().toISOString(),...exceptionInput()}:{id:'exception-a',policyId:'policy-a',tenantId:'tenant-a',approvedById:'actor-a',status:decision==='APPROVE'?'APPROVED':'REJECTED',active:decision==='APPROVE',decidedAt:new Date().toISOString()};
const response=(status,data,extra={})=>({status,ok:status>=200&&status<300,redirected:false,json:async()=>({data}),...extra});
function nodes(n){if(Array.isArray(n))return n.flatMap(nodes);if(!n||typeof n!=='object')return[];return[n,...nodes(n.props?.children)];}
function text(n){if(Array.isArray(n))return n.map(text).join('');if(n==null||typeof n==='boolean')return'';return typeof n==='object'?text(n.props?.children):String(n);}
function harness(kind='request',language='en') {
  let props={policyId:'policy-a',canWrite:true,exceptionId:'exception-a',requestedById:'other-actor',actorId:'actor-a'}, currentUser=user(), authenticated=true;
  const slots=[];let cursor=0,effects=[],tree,confirm=true,throwRefresh=false;
  const calls={fetch:[],confirm:[],events:[],refresh:0,reload:0};
  let reply=async(url,init)=>{
    if(init?.method!=='POST')return response(200,options());
    const body=JSON.parse(init.body), data=receipt(kind,body.decision);
    if(kind==='assign')data.request={employmentIds:[...body.employmentIds].sort(),dueAt:body.dueAt ?? null};
    if(kind==='request')Object.assign(data,{reason:body.reason,compensatingControl:body.compensatingControl ?? null,expiresAt:body.expiresAt ?? null});
    return response(kind==='decision'?200:201,data);
  };
  const saved={fetch:globalThis.fetch,window:globalThis.window};
  globalThis.fetch=async(url,init)=>{calls.fetch.push({url,...init});return reply(url,init);};
  globalThis.window={confirm:t=>{calls.confirm.push(t);return confirm;},dispatchEvent:e=>calls.events.push(e.type),location:{reload:()=>calls.reload++}};
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
    useId(){const i=cursor++;return slots[i]??=`label-${i}`;},
    useMemo(fn){cursor++;return fn();},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
  };
  const jsx=(type,props)=>({type,props});
  const mocks={react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':new Proxy({},{get:(_,k)=>String(k)}),
    'next/navigation':{useRouter:()=>({refresh:()=>{calls.refresh++;if(throwRefresh)throw Error('PRIVATE_REFRESH');}})},
    '@/components/locale-provider':{useLocale:()=>({locale:language})},
    '@/components/session-provider':{useSessionContext:()=>({session:{authenticated,user:currentUser},loading:false})},
    '@/components/policy-form-contract':contract,
    // Native modal keyboard/scroll behavior is exercised in the separate DOM suite.
    '@/components/use-policy-dialog':{usePolicyDialog:()=>{}},'@/components/policy-forms.module.css':{default:new Proxy({},{get:(_,k)=>k})}};
  mocks['@/components/policy-action-state']=compile('components/policy-action-state.ts',mocks);
  const exports=compile(`components/${kind==='assign'?'policy-assignment-manager':'policy-exception-actions'}.tsx`,mocks);
  const component=exports[kind==='assign'?'PolicyAssignmentManager':kind==='request'?'PolicyExceptionRequest':'PolicyExceptionDecisionButtons'];
  function render(){cursor=0;tree=component(props);for(const n of nodes(tree))if(n.props?.ref&&typeof n.props.ref==='object')n.props.ref.current??={open:false,showModal(){this.open=true;},close(){this.open=false;},focus(){}};const es=effects;effects=[];es.forEach(f=>f());return tree;}
  async function settle(){for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));render();}}
  function button(label){const n=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(n,`Missing button ${label}: ${text(tree)}`);return n;}
  function field(label){const n=nodes(tree).find(n=>['input','textarea'].includes(n.type)&&n.props['aria-label']===label);assert.ok(n,`Missing field ${label}`);return n;}
  render();
  const h={calls,button,field,render,settle,reply:f=>{reply=f;},confirm:v=>{confirm=v;},failRefresh:()=>{throwRefresh=true;},
    get tree(){return tree;},get text(){return text(tree);},get writes(){return calls.fetch.filter(x=>x.method==='POST');},
    change(label,value){field(label).props.onChange({target:{value}});render();},
    props(p){props={...props,...p};render();},session(p){currentUser={...currentUser,...p};render();},logout(){authenticated=false;render();},language(l){language=l;render();},
    async click(label){button(label).props.onClick();render();await settle();},
    close(){for(const s of slots)s?.cleanup?.();globalThis.fetch=saved.fetch;globalThis.window=saved.window;}};
  return h;
}
async function prepared(kind){const h=harness(kind);if(kind==='assign'){await h.click('Assign policy');await h.click('Select visible');h.change('Due date (optional)','');}else if(kind==='request'){await h.click('Request exception');h.change('Business reason','Synthetic reason');}return h;}
const submitLabel=kind=>kind==='assign'?'Assign selected':kind==='request'?'Submit':'Approve';

for(const [name,transform] of [
  ['null',()=>null],['array',()=>[]],['foreign policy',v=>({...v,policyId:'other'})],['foreign tenant',v=>({...v,tenantId:'other'})],['string scope',v=>({...v,relationshipScoped:'false'})],
  ['null row',v=>({...v,employments:[null]})],['duplicate rows',v=>({...v,employments:[option(),option()]})],['string assigned',v=>({...v,employments:[option('a',{assigned:'false'})]})],['missing name',v=>({...v,employments:[option('a',{name:null})]})],['unknown status',v=>({...v,employments:[option('a',{assigned:true,assignmentStatus:'OTHER'})]})],['unassigned status',v=>({...v,employments:[option('a',{assignmentStatus:'WAIVED'})]})],['oversized',v=>({...v,employments:Array.from({length:501},(_,i)=>option(String(i)))})]
])test(`options contract rejects ${name}`,()=>assert.equal(contract.parseAssignmentOptions(transform(options()),'policy-a','tenant-a'),null));
test('options: valid empty scoped list and all assignment statuses remain valid',()=>{assert.ok(contract.parseAssignmentOptions({...options(),employments:[]},'policy-a','tenant-a'));for(const status of ['PENDING','OVERDUE','WAIVED','ACKNOWLEDGED'])assert.ok(contract.parseAssignmentOptions({...options(),employments:[option('a',{assigned:true,assignmentStatus:status})]},'policy-a','tenant-a'));assert.equal(contract.assignmentStatusText('WAIVED','tr'),'Muaf');});
for(const [name,change] of [['wrong policy',{policyId:'other'}],['wrong tenant',{tenantId:'other'}],['wrong count',{requested:2}],['negative',{assigned:-1,skippedExisting:2}],['fraction',{assigned:.5,skippedExisting:.5}],['missing',{assigned:undefined}],['unbalanced',{assigned:1,skippedExisting:1}]])test(`assignment receipt rejects ${name}`,()=>assert.equal(contract.acceptsAssignmentReceipt({...receipt('assign'),...change},'policy-a','tenant-a',1,batch()),false));
test('dates: explicit UTC end-of-day, empty and exact boundary',()=>{assert.equal(contract.futureUtcDayEnd(''),null);assert.equal(contract.futureUtcDayEnd('2099-03-01',0),'2099-03-01T23:59:59.000Z');assert.equal(contract.futureUtcDayEnd('2099-03-01',Date.parse('2099-03-01T23:59:59Z')),false);});
for(const value of ['2026-02-30','2026-13-01','abc','2026-1-01','2026-01-01T10:00Z','1900-01-01'])test(`dates reject malformed/elapsed ${value}`,()=>assert.equal(contract.futureUtcDayEnd(value,Date.parse('2026-10-15')),false));

for(const kind of ['assign','request','decision']){
  test(`${kind}: explicit cancellation sends nothing`,async()=>{const h=await prepared(kind);try{h.confirm(false);await h.click(submitLabel(kind));assert.equal(h.writes.length,0);assert.equal(h.calls.confirm.length,1);}finally{h.close();}});
  test(`${kind}: synchronous double callbacks send one POST`,async()=>{const h=await prepared(kind);let finish;try{h.reply(()=>new Promise(r=>{finish=r;}));const cb=h.button(submitLabel(kind)).props.onClick;cb();cb();h.render();assert.equal(h.writes.length,1);finish(response(kind==='decision'?200:201,receipt(kind)));await h.settle();assert.equal(h.calls.refresh,1);}finally{h.close();}});
  for(const [name,fn] of [
    ['network',async()=>{throw Error('PRIVATE_TRANSPORT');}],['invalid JSON',async()=>response(201,null,{json:async()=>{throw Error('PRIVATE_PARSE');}})],
    ['wrong identity',async()=>response(kind==='decision'?200:201,{...receipt(kind),policyId:'other'})],['array',async()=>response(kind==='decision'?200:201,[])],['204',async()=>response(204,null)],['503',async()=>response(503,{error:'PRIVATE_SERVER'})],['redirected',async()=>response(kind==='decision'?200:201,receipt(kind),{redirected:true})]
  ])test(`${kind}: ${name} never signals success or unlocks a replay`,async()=>{const h=await prepared(kind);try{h.reply(fn);await h.click(submitLabel(kind));assert.equal(h.calls.refresh,0);assert.equal(h.calls.events.length,0);assert.equal(h.button(submitLabel(kind)).props.disabled,true);await h.click(submitLabel(kind));assert.equal(h.writes.length,1);assert.doesNotMatch(h.text,/PRIVATE_/);if(kind==='request')assert.equal(h.field('Business reason').props.value,'Synthetic reason');}finally{h.close();}});
  for(const status of [400,401,403,404,409,429])test(`${kind}: ${status} is bounded feedback with explicit read recovery`,async()=>{const h=await prepared(kind);try{h.reply(async()=>response(status,{error:'PRIVATE_DETAIL'}));await h.click(submitLabel(kind));assert.equal(h.button(submitLabel(kind)).props.disabled,true);assert.doesNotMatch(h.text,/PRIVATE_DETAIL/);await h.click('Reload current records');assert.equal(h.calls.reload,1);assert.equal(h.writes.length,1);}finally{h.close();}});
  test(`${kind}: saved result survives refresh failure and stays blocked`,async()=>{const h=await prepared(kind);try{h.failRefresh();await h.click(submitLabel(kind));assert.match(h.text,/action was saved/);await h.click(submitLabel(kind));assert.equal(h.writes.length,1);assert.equal(h.calls.refresh,1);assert.equal(h.calls.events.length,2);}finally{h.close();}});
  test(`${kind}: stale callback cannot run after principal/record changes`,async()=>{const h=await prepared(kind);try{const cb=h.button(submitLabel(kind)).props.onClick;h.session({id:'different-user'});cb();await h.settle();assert.equal(h.writes.length,0);}finally{h.close();}});
  test(`${kind}: late receipt does not signal success for another record`,async()=>{const h=await prepared(kind);let finish;try{h.reply(()=>new Promise(r=>{finish=r;}));h.button(submitLabel(kind)).props.onClick();h.render();h.props({policyId:'other-policy'});finish(response(kind==='decision'?200:201,receipt(kind)));await h.settle();assert.equal(h.calls.refresh,0);assert.equal(h.calls.events.length,0);}finally{h.close();}});
}
for(const kind of ['assign','request'])test(`${kind}: unknown-result guard survives close/reopen and locale switch`,async()=>{const h=await prepared(kind);try{h.reply(async(url,init)=>{if(init?.method==='POST')throw Error('lost');return response(200,options());});await h.click(submitLabel(kind));await h.click('Close');await h.click(kind==='assign'?'Assign policy':'Request exception');assert.equal(h.button(submitLabel(kind)).props.disabled,true);h.language('tr');assert.match(h.text,/İşlem sonucu doğrulanamadı/);assert.equal(h.writes.length,1);}finally{h.close();}});
for(const [name,fn] of [['failure',async()=>response(503,null)],['bad shape',async()=>response(200,{})],['network',async()=>{throw Error('PRIVATE_READ');}]])test(`assignment read: ${name} stops, disables and retries only explicitly`,async()=>{const h=harness('assign');try{h.reply(fn);await h.click('Assign policy');assert.equal(h.calls.fetch.length,1);assert.equal(h.button('Assign selected').props.disabled,true);await h.settle();assert.equal(h.calls.fetch.length,1);assert.doesNotMatch(h.text,/PRIVATE_READ/);h.reply(async()=>response(200,options()));await h.click('Refresh employees');assert.equal(h.calls.fetch.length,2);await h.click('Select visible');assert.equal(h.button('Assign selected').props.disabled,false);}finally{h.close();}});
test('assignment: a closed read is aborted and its late reply cannot replace a new read',async()=>{const h=harness('assign');let finish;try{h.reply(()=>new Promise(r=>{finish=r;}));h.button('Assign policy').props.onClick();h.render();const first=h.calls.fetch[0];await h.click('Close');assert.equal(first.signal.aborted,true);h.reply(async()=>response(200,{...options(),employments:[option('new',{name:'New employee'})]}));await h.click('Assign policy');finish(response(200,options()));await h.settle();assert.match(h.text,/New employee/);assert.doesNotMatch(h.text,/Synthetic employee/);}finally{h.close();}});
test('assignment: read retry preserves search and deadline without unlocking unknown POST',async()=>{const h=await prepared('assign');try{h.change('Search employees','Synthetic');h.change('Due date (optional)','2099-03-01');h.reply(async(url,init)=>{if(init?.method==='POST')throw Error('lost');return response(200,options());});await h.click('Assign selected');await h.click('Refresh employees');assert.equal(h.field('Search employees').props.value,'Synthetic');assert.equal(h.field('Due date (optional)').props.value,'2099-03-01');assert.equal(h.button('Assign selected').props.disabled,true);}finally{h.close();}});
test('request: empty reason, too-long fields and invalid date never POST',async()=>{const h=harness('request');try{await h.click('Request exception');await h.click('Submit');assert.equal(h.writes.length,0);h.change('Business reason','x'.repeat(2001));await h.click('Submit');assert.equal(h.writes.length,0);h.change('Business reason','Valid reason');h.change('Expiry date (optional)','2026-02-30');await h.click('Submit');assert.equal(h.writes.length,0);}finally{h.close();}});
test('request: validated self identity and explicit UTC calendar date are sent',async()=>{const h=await prepared('request');try{h.change('Expiry date (optional)','2099-03-01');await h.click('Submit');const body=JSON.parse(h.writes[0].body);assert.equal(body.employmentId,'employee-a');assert.equal(body.expiresAt,'2099-03-01T23:59:59.000Z');assert.equal(body.reason,'Synthetic reason');}finally{h.close();}});
for(const key of ['tenantId','requestedById','employmentId','status','active'])test(`request: mismatched ${key} cannot produce success`,async()=>{const h=await prepared('request');try{h.reply(async()=>response(201,{...receipt('request'),[key]:key==='active'?true:'wrong'}));await h.click('Submit');assert.equal(h.calls.refresh,0);assert.equal(h.button('Submit').props.disabled,true);}finally{h.close();}});
test('decision: requester cannot approve or reject and rejection checks its own target state',async()=>{const h=harness('decision');try{h.props({requestedById:'actor-a'});assert.equal(nodes(h.tree).filter(n=>n.type==='button').length,0);assert.match(h.text,/cannot approve or reject/);h.props({requestedById:'other'});await h.click('Reject');assert.equal(h.calls.refresh,1);assert.equal(JSON.parse(h.writes[0].body).decision,'REJECT');}finally{h.close();}});
test('request: Turkish labels and existing draft survive language switch',async()=>{const h=await prepared('request');try{h.language('tr');assert.equal(h.field('İş gerekçesi').props.value,'Synthetic reason');assert.ok(h.field('Bitiş tarihi (isteğe bağlı)'));assert.match(h.text,/23:59:59 UTC/);await h.click('Gönder');assert.match(h.calls.confirm[0],/bağımsız incelemeye/);}finally{h.close();}});
test('assignment: Turkish status labels preserve waiver meaning and explicit 500-row bound',async()=>{const h=harness('assign');try{h.language('tr');h.reply(async()=>response(200,{...options(),employments:[option('a',{assigned:true,assignmentStatus:'WAIVED'})]}));await h.click('Politika ata');assert.match(h.text,/Muaf/);assert.match(h.text,/500/);assert.ok(h.field('Çalışan ara'));}finally{h.close();}});

test('options: status arrays and normalized/non-ISO dates cannot pass the browser contract',()=>{for(const extra of [{assigned:true,assignmentStatus:['WAIVED']},{dueAt:'1'},{dueAt:'2026-02-30T00:00:00.000Z'}])assert.equal(contract.parseAssignmentOptions({...options(),employments:[option('a',extra)]},'policy-a','tenant-a'),null);});
test('decision: invalid/non-ISO decision time does not confirm a receipt',()=>{for(const decidedAt of ['1','2026-02-30T00:00:00.000Z',null])assert.equal(contract.acceptsExceptionDecision({...receipt('decision'),decidedAt},'policy-a','exception-a','tenant-a','actor-a','APPROVE'),false);});


// Receipt binding regressions: same principal/policy and counts are not sufficient.
for (const [name, patch] of [
  ['different employee with the same count', {employmentIds:['another-employee'],dueAt:null}],
  ['different deadline', {employmentIds:['employee-a'],dueAt:'2099-03-01T23:59:59.000Z'}],
  ['missing batch', undefined], ['empty batch', {employmentIds:[],dueAt:null}],
  ['duplicate ids', {employmentIds:['employee-a','employee-a'],dueAt:null}],
  ['missing deadline field', {employmentIds:['employee-a']}]
]) test(`bound assignment: ${name} cannot confirm a result`,()=> {
  assert.equal(contract.acceptsAssignmentReceipt({...receipt('assign'),request:patch},'policy-a','tenant-a',1,batch()),false);
});
test('bound assignment: correct normalized batch matches irrespective of user selection order',()=> {
  const value={...receipt('assign'),assigned:1,requested:2,skippedExisting:1,request:batch(['a','b'],'2099-03-01T23:59:59.000Z')};
  assert.equal(contract.acceptsAssignmentReceipt(value,'policy-a','tenant-a',2,batch(['b','a'],'2099-03-01T23:59:59.000Z')),true);
});
for(const [name,patch] of [['reason',{reason:'Another request'}],['control',{compensatingControl:'Another control'}],['expiry',{expiresAt:'2099-03-01T23:59:59.000Z'}],['missing creation time',{createdAt:undefined}],['invalid creation time',{createdAt:'not-a-date'}]])
  test(`bound exception: changed ${name} cannot confirm a result`,()=> {
    assert.equal(contract.acceptsExceptionRequest({...receipt('request'),...patch},'policy-a','tenant-a','actor-a','employee-a',exceptionInput()),false);
  });
test('bound exception: exact submitted text, nullable control and expiry are accepted',()=> {
  assert.equal(contract.acceptsExceptionRequest(receipt('request'),'policy-a','tenant-a','actor-a','employee-a',exceptionInput()),true);
});
for(const [name,kind,change] of [
  ['same-count employee substitution','assign',v=>({...v,request:batch(['other-employee'])})],
  ['deadline substitution','assign',v=>({...v,request:batch(['employee-a'],'2099-03-01T23:59:59.000Z')})],
  ['business-reason substitution','request',v=>({...v,reason:'Not the submitted reason'})],
  ['compensating-control substitution','request',v=>({...v,compensatingControl:'Not submitted'})],
  ['expiry substitution','request',v=>({...v,expiresAt:'2099-03-01T23:59:59.000Z'})]
])test(`form binding: ${name} keeps draft, signals no success and blocks close/reopen replay`,async()=> {
  const h=await prepared(kind);
  try{
    h.reply(async(_url,init)=>init?.method==='POST'?response(201,change(receipt(kind))):response(200,options()));
    await h.click(submitLabel(kind));
    assert.equal(h.calls.refresh,0);assert.equal(h.calls.events.length,0);
    assert.equal(h.button(submitLabel(kind)).props.disabled,true);
    if(kind==='request')assert.equal(h.field('Business reason').props.value,'Synthetic reason');
    await h.click('Close');await h.click(kind==='assign'?'Assign policy':'Request exception');
    assert.equal(h.button(submitLabel(kind)).props.disabled,true);
    h.language('tr');assert.match(h.text,/İşlem sonucu doğrulanamadı/);assert.equal(h.writes.length,1);
  }finally{h.close();}
});

for(const kind of ['assign','request'])test(`bound form: ${kind} confirms the exact nonempty submitted values`,async()=>{
  const h=await prepared(kind);
  try{
    if(kind==='assign')h.change('Due date (optional)','2099-03-01');
    else {h.change('Compensating control (optional)','Synthetic additional control');h.change('Expiry date (optional)','2099-03-01');}
    await h.click(submitLabel(kind));
    assert.equal(h.writes.length,1);assert.equal(h.calls.refresh,1);
    assert.equal(h.calls.events.length,2);assert.match(h.text,/action was saved/);
    assert.equal(h.button(submitLabel(kind)).props.disabled,true);
  }finally{h.close();}
});
