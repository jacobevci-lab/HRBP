/** Hook unit tests with explicit React/transport doubles. Not browser/SQL evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness() {
  const prior = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = { writes: [], refresh: 0, events: [], confirms: 0, reload: 0 };
  const slots = []; let cursor = 0, effects = [], key = 'policy-A', current, allow = true;
  let transport = async () => ({ status: 201, redirected: false, json: async () => ({ data: { ok: true } }) });
  const React = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,j) => !Object.is(v, slots[i].deps[j]))) {
      const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    } }
  };
  globalThis.fetch = async (url, init) => { calls.writes.push({ url, method: init.method }); return transport(url, init); };
  globalThis.window = { confirm() { calls.confirms++; return typeof allow === 'function' ? allow() : allow; },
    dispatchEvent(event) { calls.events.push(event.type); }, location: { reload() { calls.reload++; } } };
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync('components/policy-action-state.ts','utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new Function('module','exports','require',js)(module,module.exports,name => {
    if (name === 'react') return React;
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() { calls.refresh++; } }) };
    throw Error('Unexpected dependency: '+name);
  });
  const render = (next = key) => { key = next; cursor = 0; current = module.exports.usePolicyAction(key);
    const queued = effects; effects = []; queued.forEach(fn=>fn()); return current; };
  render();
  return { calls, render, get current(){return current;}, setTransport: fn => {transport=fn;}, confirm: value => {allow=value;},
    message: (phase,locale) => module.exports.policyActionMessage(phase,locale),
    async run(on = current) { await on.run({ action:'SAVE', confirmation:'Synthetic confirmation', url:'/api/synthetic/'+key,
      expectedStatus:201, init:{method:'POST'}, events:['test:saved'], accepts:data=>data?.ok===true }); render(); },
    unmount() { slots.forEach(value=>value?.cleanup?.()); },
    close(){slots.forEach(value=>value?.cleanup?.());globalThis.fetch=prior.fetch;globalThis.window=prior.window;}
  };
}
const failure = () => { throw Error('Synthetic lost reply'); };
const reply = (status=201,ok=true) => ({status,redirected:false,json:async()=>({data:{ok}})});

for (const [label, response, phase] of [
  ['lost response', failure, 'unknown'], ['confirmed save', ()=>reply(), 'saved'],
  ['rejected validation', ()=>reply(400), 'rejected'], ['session denial', ()=>reply(401), 'denied'],
  ['missing record', ()=>reply(404), 'missing'], ['state conflict', ()=>reply(409), 'conflict']
]) test(`returning A after another record B retains A's ${label} guard`, async()=>{
  const h=harness();try{
    h.setTransport(response);await h.run();assert.equal(h.current.phase,phase);
    h.render('policy-B');h.setTransport(()=>reply());await h.run();assert.equal(h.calls.writes.length,2);
    h.render('policy-A');assert.equal(h.current.blocked,true);assert.equal(h.current.phase,phase);
    await h.run();assert.equal(h.calls.writes.length,2,'returning to A must not replay the old operation');
  }finally{h.close();}
});
for(const [label,good,phase] of [['wrong reply',false,'unknown'],['confirmed reply',true,'saved']])
 test(`late ${label} for A cannot refresh B or erase A's outcome`,async()=>{
  const h=harness();let resolve;try{
    h.setTransport(()=>new Promise(r=>{resolve=r;}));const inFlight=h.run();h.render('policy-B');
    assert.equal(h.current.blocked,true,'another pending operation still serializes this mounted component');
    resolve(reply(201,good));await inFlight;assert.equal(h.calls.refresh,0);assert.deepEqual(h.calls.events,[]);
    assert.equal(h.current.phase,'idle');h.render('policy-A');assert.equal(h.current.blocked,true);assert.equal(h.current.phase,phase);
    await h.run();assert.equal(h.calls.writes.length,1);
  }finally{h.close();}
});
test('a stale handler cannot submit another visible record',async()=>{
 const h=harness();try{const stale=h.current;h.render('policy-B');await h.run(stale);assert.equal(h.calls.writes.length,0);}finally{h.close();}
});
test('synchronous duplicate calls and another pending record never add a second write',async()=>{
 const h=harness();let resolve;try{h.setTransport(()=>new Promise(r=>{resolve=r;}));const original=h.current;
  const first=h.run(original);await h.run(original);h.render('policy-B');await h.run();assert.equal(h.calls.writes.length,1);
  resolve(reply());await first;
 }finally{h.close();}
});
test('bounded history refuses new writes rather than evicting uncertain outcomes',async()=>{
 const h=harness();try{h.setTransport(failure);for(let i=0;i<32;i++){h.render('policy-'+i);await h.run();}
  assert.equal(h.calls.writes.length,32);h.render('policy-over-capacity');assert.equal(h.current.blocked,true);
  assert.equal(h.current.phase,'limited');await h.run();assert.equal(h.calls.writes.length,32);assert.equal(h.calls.confirms,32);
  h.render('policy-0');assert.equal(h.current.phase,'unknown');assert.equal(h.current.blocked,true);
  h.render('policy-31');assert.equal(h.current.phase,'unknown');assert.equal(h.current.blocked,true);
 }finally{h.close();}
});
test('cancelled confirmations do not consume the bounded outcome history',async()=>{
 const h=harness();try{h.confirm(false);for(let i=0;i<40;i++){h.render('cancel-'+i);await h.run();}
  assert.equal(h.calls.writes.length,0);h.confirm(true);h.render('new');await h.run();assert.equal(h.current.phase,'saved');
 }finally{h.close();}
});
test('confirmation failure before any request leaves no ambiguous-write guard',async()=>{
 const h=harness();try{h.confirm(()=>{throw Error('Unavailable dialog');});await h.run();assert.equal(h.calls.writes.length,0);
  assert.equal(h.current.blocked,false);h.confirm(true);await h.run();assert.equal(h.calls.writes.length,1);
 }finally{h.close();}
});
test('record changed during confirmation does not issue the now-stale request',async()=>{
 const h=harness();try{h.confirm(()=>{h.render('policy-B');return true;});await h.run();assert.equal(h.calls.writes.length,0);
  h.confirm(true);h.render('policy-A');assert.equal(h.current.blocked,false);await h.run();assert.equal(h.calls.writes.length,1);
 }finally{h.close();}
});
test('late completion after unmount publishes no success/refresh side effects',async()=>{
 const h=harness();let resolve;try{h.setTransport(()=>new Promise(r=>{resolve=r;}));const pending=h.run();h.unmount();resolve(reply());await pending;
  assert.equal(h.calls.refresh,0);assert.equal(h.calls.events.length,0);
 }finally{h.close();}
});
test('capacity feedback is bounded and translated without exposing record identifiers',()=>{
 const h=harness();try{assert.match(h.message('limited','en'),/Reload/i);assert.match(h.message('limited','tr'),/yeniden yükleyin/i);
  assert.doesNotMatch(h.message('limited','tr'),/policy-|actor-|tenant-/);
 }finally{h.close();}
});
