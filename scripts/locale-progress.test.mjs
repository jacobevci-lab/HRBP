/** Bounded scheduling tests; real commit/DOM behavior is covered by Chromium. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function provider(pending){
 const effects=[],updates=[];
 const react={createContext:()=>({Provider:'provider'}),useCallback:f=>f,useMemo:f=>f(),useRef:v=>({current:v}),useContext:()=>null,useState:v=>[v,n=>updates.push(n)],useTransition:()=>[pending,()=>{}],useEffect:f=>effects.push(f)};
 const mocks={react,'react/jsx-runtime':{jsx:(_tag,props)=>props},'@/lib/i18n':{isLocale:v=>['en','tr'].includes(v),translate:(_l,k)=>k},'@/lib/locale-preference-action':{},'@/lib/locale-preference-client':{}};
 const js=ts.transpileModule(readFileSync('components/locale-provider.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(n=>{assert.ok(n in mocks);return mocks[n];},m,m.exports);
 m.exports.LocaleProvider({children:null});return{effects,updates};
}
function timers(){
 const originals={setInterval,clearInterval,setTimeout,clearTimeout};const scheduled=[],cleared=[];
 globalThis.setInterval=(fn,ms)=>{scheduled.push({kind:'interval',fn,ms});return 1;};globalThis.setTimeout=(fn,ms)=>{scheduled.push({kind:'timeout',fn,ms});return 2;};
 globalThis.clearInterval=id=>cleared.push(['interval',id]);globalThis.clearTimeout=id=>cleared.push(['timeout',id]);
 return{scheduled,cleared,restore(){Object.assign(globalThis,originals);}};
}
test('no progress polling when no locale action is pending',()=>{const t=timers();try{const p=provider(false);assert.equal(p.effects.length,2);p.effects[1]();assert.deepEqual(t.scheduled,[]);}finally{t.restore();}});
test('pending progress is bounded, functional and cleaned on settle/unmount',()=>{const t=timers();try{const p=provider(true);const cleanup=p.effects[1]();assert.deepEqual(t.scheduled.map(x=>[x.kind,x.ms]),[['interval',250],['timeout',5000]]);t.scheduled[0].fn();assert.equal(p.updates[1](4),5);t.scheduled[1].fn();assert.deepEqual(t.cleared,[['interval',1]]);cleanup();assert.deepEqual(t.cleared.slice(-2),[['interval',1],['timeout',2]]);}finally{t.restore();}});
test('progress is presentation-only and strict browser readiness stays enabled',()=>{const source=readFileSync('components/locale-provider.tsx','utf8');assert.equal(source.match(/updateLocalePreference\(next\)/g).length,1);assert.doesNotMatch(source,/location\.reload\(|router\.refresh\(|querySelector\(|data-audit-locale/);assert.match(source,/const t = useCallback/);const workflow=readFileSync('.github/workflows/platform-regression.yml','utf8');assert.ok(workflow.indexOf('node scripts/platform-render-regression.mjs')<workflow.indexOf('node scripts/platform-audit.mjs'));assert.match(workflow,/node scripts\/platform-remediation-gate\.mjs/);const e2e=readFileSync('scripts/platform-render-regression.mjs','utf8');assert.match(e2e,/timeout:10000/);assert.match(e2e,/\['tr','en','tr','en','tr','en'\]/);});
