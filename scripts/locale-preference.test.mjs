/** Executable action/client tests with mocked cookie storage and React scheduling.
 * The separate Chromium regression exercises real Server Actions and DOM updates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path,mocks={}) {
 const result=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.equal(result.diagnostics?.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,path);
 const m={exports:{}};
 new Function('require','module','exports',result.outputText)(name=>{if(name in mocks)return mocks[name];throw Error('Unmocked dependency '+name);},m,m.exports);
 return m.exports;
}
const i18n=load('lib/i18n.ts');
const client=load('lib/locale-preference-client.ts',{'@/lib/i18n':i18n});
function action(storage) { return load('lib/locale-preference-action.ts',{'next/headers':{cookies:storage},'@/lib/i18n':i18n}).updateLocalePreference; }
for(const value of ['tr','en'])test('server action commits only supported preference '+value,async()=>{
 const writes=[];const result=await action(async()=>({set:(...args)=>writes.push(args)}))(value);
 assert.deepEqual(result,{ok:true,locale:value});
 assert.deepEqual(writes,[['hrbp-locale',value,{path:'/',maxAge:31536000,sameSite:'lax'}]]);
});
for(const value of [null,undefined,'TR','tr\n','de',{},['tr'],false])test('reject invalid locale without accessing cookie store '+JSON.stringify(value),async()=>{
 let reads=0;assert.deepEqual(await action(async()=>{reads++;throw Error('must not execute');})(value),{ok:false});assert.equal(reads,0);
});
test('cookie storage failure is not reported as successful commit',async()=>{
 await assert.rejects(action(async()=>({set(){throw Error('storage failure');}}))('tr'),/storage failure/);
});
function browser({cookie='hrbp-locale=en',stored='en',language='en-US',blocked=false}={}){
 const previous=new Map(['window','document','navigator'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const values=new Map(stored===null?[]:[['hrbp-locale',stored]]);
 const document={cookie,documentElement:{lang:'en',dataset:{locale:'en'}}};
 const localStorage={getItem:key=>{if(blocked)throw Error('blocked');return values.get(key)??null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');values.set(key,value);}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});
 return{values,document,close(){for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}};
}
for(const [name,config,expected] of [
 ['cookie beats stale storage',{cookie:'hrbp-locale=tr',stored:'en'},'tr'],
 ['English cookie beats Turkish navigator',{cookie:'hrbp-locale=en',stored:'tr',language:'tr-TR'},'en'],
 ['absent cookie uses storage',{cookie:'',stored:'tr'},'tr'],
 ['invalid cookie uses valid storage',{cookie:'hrbp-locale=fr',stored:'tr'},'tr'],
 ['missing preference uses browser',{cookie:'',stored:null,language:'tr-TR'},'tr'],
 ['blocked storage still reads cookie',{cookie:'hrbp-locale=tr',blocked:true},'tr'],
 ['blocked storage uses browser',{cookie:'',blocked:true,language:'tr-TR'},'tr'],
 ['unsupported browser defaults English',{cookie:'',stored:'fr',language:'fr-FR'},'en']
])test(name,()=>{const b=browser(config);try{assert.equal(client.resolveBrowserLocale(),expected);}finally{b.close();}});
test('client persistence updates DOM/storage without independently rewriting cookie',()=>{
 const b=browser();try{client.persistClientLocale('tr');assert.equal(document.documentElement.lang,'tr');assert.equal(b.values.get('hrbp-locale'),'tr');assert.equal(document.cookie,'hrbp-locale=en');}finally{b.close();}
});
test('DOM remains usable when localStorage write is blocked',()=>{
 const b=browser({blocked:true});try{assert.doesNotThrow(()=>client.persistClientLocale('tr'));assert.equal(document.documentElement.dataset.locale,'tr');}finally{b.close();}
});
function provider(update){
 const states=[],refs=[],jobs=[],effects=[];let stateIndex=0,refIndex=0;
 const react={createContext:()=>({Provider:'provider'}),useCallback:f=>f,useContext:()=>null,useMemo:f=>f(),
  useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=initial;return[states[i],next=>{states[i]=next;}];},
  useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:initial});},
  useEffect:effect=>effects.push(effect),useTransition:()=>[false,fn=>{const job=fn();if(job?.then)jobs.push(job);}]
 };
 const {LocaleProvider}=load('components/locale-provider.tsx',{
  react,'react/jsx-runtime':{jsx:(_tag,props)=>props},'@/lib/i18n':i18n,
  '@/lib/locale-preference-client':client,'@/lib/locale-preference-action':{updateLocalePreference:update}
 });
 return {render(){stateIndex=0;refIndex=0;return LocaleProvider({children:null}).value;},
  effects,jobs,async flush(){await Promise.all(jobs);}};
}
test('provider changes selected locale only after the server commit; rapid duplicate is ignored',async()=>{
 const b=browser();let resolve;const calls=[];const p=provider(next=>{calls.push(next);return new Promise(r=>resolve=r);});
 try{
  const ui=p.render();ui.setLocale('tr');ui.setLocale('en');
  assert.deepEqual(calls,['tr']);assert.equal(p.render().locale,'en');assert.equal(document.documentElement.lang,'en');
  document.cookie='hrbp-locale=tr';resolve({ok:true,locale:'tr'});await p.flush();
  assert.equal(p.render().locale,'tr');assert.equal(document.documentElement.lang,'tr');assert.equal(p.render().localeError,false);
 }finally{b.close();}
});
test('failed action keeps old selection, exposes recovery and permits an explicit retry',async()=>{
 const b=browser();let calls=0;const p=provider(async next=>{if(++calls===1)throw Error('unavailable');document.cookie='hrbp-locale='+next;return{ok:true,locale:next};});
 try{p.render().setLocale('tr');await p.flush();assert.equal(p.render().locale,'en');assert.equal(p.render().localeError,true);assert.equal(b.values.get('hrbp-locale'),'en');p.render().setLocale('tr');await p.flush();assert.equal(p.render().locale,'tr');assert.equal(p.render().localeError,false);}finally{b.close();}
});
test('wrong action acknowledgement does not report a completed selection',async()=>{
 const b=browser();const p=provider(async()=>({ok:true,locale:'en'}));try{p.render().setLocale('tr');await p.flush();assert.equal(p.render().locale,'en');assert.equal(p.render().localeError,true);}finally{b.close();}
});
test('initial committed cookie aligns UI without an unnecessary server action',()=>{
 const b=browser({cookie:'hrbp-locale=tr',stored:'en'});let calls=0;const p=provider(async()=>{calls++;return{ok:false};});
 try{p.render();p.effects[0]();assert.equal(p.render().locale,'tr');assert.equal(b.values.get('hrbp-locale'),'tr');assert.equal(calls,0);}finally{b.close();}
});
test('first-time Turkish preference also commits to the server',async()=>{
 const b=browser({cookie:'',stored:null,language:'tr-TR'});const calls=[];const p=provider(async next=>{calls.push(next);document.cookie='hrbp-locale='+next;return{ok:true,locale:next};});
 try{p.render();p.effects[0]();await p.flush();assert.deepEqual(calls,['tr']);assert.equal(p.render().locale,'tr');assert.equal(document.cookie,'hrbp-locale=tr');}finally{b.close();}
});
test('action-aware controls and repeated real-browser draft/download checks stay wired',()=>{
 const source=readFileSync('components/locale-provider.tsx','utf8');assert.doesNotMatch(source,/router\.refresh\(|window\.location|document\.cookie\s*=/);assert.match(source,/updateLocalePreference\(next\)/);
 const toggle=readFileSync('components/locale-toggle.tsx','utf8');assert.equal(toggle.match(/disabled=\{localePending\}/g)?.length,2);assert.match(toggle,/aria-busy=\{localePending\}/);assert.match(toggle,/role="alert"/);
 const e2e=readFileSync('scripts/platform-render-regression.mjs','utf8');assert.match(e2e,/\['tr','en','tr','en','tr','en'\]/);assert.match(e2e,/inputValue\(\),'unsaved locale draft'/);assert.match(e2e,/waitForEvent\('download'\)/);
 assert.match(readFileSync('.github/workflows/platform-regression.yml','utf8'),/locale-preference\.test\.mjs/);
 const layout=readFileSync('app/layout.tsx','utf8');assert.match(layout,/var locale = cookieLocale === 'tr' \|\| cookieLocale === 'en'/);
});
