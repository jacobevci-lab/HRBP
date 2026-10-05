import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import ts from 'typescript';
function load(path, mocks = {}, globals = {}) {
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  runInNewContext(outputText, { module, exports: module.exports, require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error(`Unexpected import: ${name}`); },
    Response, AbortController, TextDecoder, setTimeout, clearTimeout, Event, ...globals }, { filename: path });
  return module.exports;
}
const api = load('lib/time-client-action.ts');
const plain = v => JSON.parse(JSON.stringify(v));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const draft = changes => ({ employmentId: 'qa-employee', workDate: '2026-10-05', minutes: 480, overtimeMinutes: 30, ...changes });
const create = changes => ({ kind: 'create', draft: draft(changes) });
const submit = changes => ({ kind: 'submit', entryId: 'qa-time', priorStatus: 'DRAFT', draft: draft(changes) });
const receipt = (a, changes = {}) => ({ data: { id: 'qa-time', employmentId: a.draft.employmentId, workDate: a.draft.workDate + 'T00:00:00.000Z',
  minutes: a.draft.minutes, overtimeMinutes: a.draft.overtimeMinutes, startAt: a.draft.startAt ?? null, endAt: a.draft.endAt ?? null,
  source: 'SELF_SERVICE', status: a.kind === 'create' ? 'DRAFT' : 'SUBMITTED', approvedById: null, approvedAt: null, ...changes } });
for (const minutes of [1, 480, 1440, '480']) test(`valid whole minutes ${JSON.stringify(minutes)}`, () => assert.equal(api.parseTimeDraft(draft({ minutes, overtimeMinutes: 0 })).minutes, Number(minutes)));
for (const changes of [
  { employmentId: '' }, { employmentId: [] }, { employmentId: '../x' }, { employmentId: 'x\n' }, { employmentId: 'x'.repeat(192) },
  { workDate: '2026-02-30' }, { workDate: '2026-02-29' }, { workDate: '10/05/2026' }, { workDate: '2026-10-05T00:00:00Z' }, { workDate: true },
  ...[0, -1, 1441, 1.5, NaN, Infinity, true, ['480'], {}, '1e2', ' 480', '480.0', ''].map(minutes => ({ minutes })),
  ...[-1, 481, true, null, '0.5', []].map(overtimeMinutes => ({ overtimeMinutes })),
  { startAt: '2026-10-05T08:00:00.000Z' }, { startAt: 'bad', endAt: 'bad' },
  { startAt: '2026-02-30T08:00:00.000Z', endAt: '2026-03-02T17:00:00.000Z' },
  { startAt: '2026-10-05T10:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z' },
  { startAt: '2026-10-05T08:00:00.000Z', endAt: '2026-10-07T08:00:00.000Z' },
  { startAt: '2026-10-05T08:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z' }
]) test(`invalid draft rejected: ${JSON.stringify(changes)}`, () => assert.equal(api.parseTimeDraft(draft(changes)), null));
test('leap day, blank optional interval and missing overtime are explicit', () => {
  assert.ok(api.parseTimeDraft(draft({ workDate: '2024-02-29', startAt: '', endAt: '', overtimeMinutes: undefined })));
  assert.equal(api.parseTimeDraft(draft({ overtimeMinutes: '' })).overtimeMinutes, 0);
});
test('valid local interval converts to instants without silently dropping fields', () => {
  const d = api.timeDraftFromForm(draft({ startAt: '2026-10-05T08:00', endAt: '2026-10-05T17:00' }));
  assert.equal(d.startAt, new Date('2026-10-05T08:00').toISOString());
  assert.equal(d.endAt, new Date('2026-10-05T17:00').toISOString());
});
for (const changes of [{ startAt: 'bad', endAt: '' }, { startAt: '2026-02-30T08:00', endAt: '2026-03-02T17:00' }, { startAt: '2026-10-05T25:00', endAt: '2026-10-06T17:00' }, { startAt: '2026-10-05T08:00', endAt: '' }]) test(`bad local interval not omitted ${JSON.stringify(changes)}`, () => assert.equal(api.timeDraftFromForm(draft(changes)), null));
for (const a of [create(), submit(), { ...submit(), priorStatus: 'REJECTED' }, create({ startAt: '2026-10-05T08:00:00.000Z', endAt: '2026-10-05T17:00:00.000Z' })]) test(`${a.kind}: matching receipt and exactly one governed POST`, async () => {
  const calls = [];
  const r = await api.submitTimeAction(a, { fetchImpl: async (...args) => { calls.push(args); return Response.json(receipt(a), { status: a.kind === 'create' ? 201 : 200 }); } });
  assert.equal(r.outcome, 'saved'); assert.equal(r.id, 'qa-time'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], a.kind === 'create' ? '/api/time/entries' : '/api/time/entries/qa-time/transition');
  assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0][1].body), a.kind === 'create' ? a.draft : { status: 'SUBMITTED' });
});
for (const changes of [{ id: '' }, { employmentId: 'other' }, { workDate: '2026-10-06T00:00:00.000Z' }, { minutes: '480' }, { minutes: 481 }, { overtimeMinutes: 0 }, { startAt: '2026-10-05T08:00:00.000Z' }, { endAt: undefined }, { status: 'APPROVED' }, { source: 'OPERATIONS' }]) test(`wrong create receipt is unknown ${JSON.stringify(changes)}`, async () => {
  assert.equal((await api.submitTimeAction(create(), { fetchImpl: async () => Response.json(receipt(create(), changes), { status: 201 }) })).outcome, 'unknown');
});
for (const changes of [{ id: 'other' }, { approvedById: 'old-approver' }, { approvedAt: '2026-10-05T00:00:00.000Z' }, { approvedAt: undefined }, { status: 'DRAFT' }]) test(`wrong submit receipt is unknown ${JSON.stringify(changes)}`, async () => {
  assert.equal((await api.submitTimeAction(submit(), { fetchImpl: async () => Response.json(receipt(submit(), changes)) })).outcome, 'unknown');
});
for (const [name, response] of [
  ['empty', () => new Response('', { status: 201, headers: { 'content-type': 'application/json' } })],
  ['HTML', () => new Response('<html>SECRET</html>', { status: 201, headers: { 'content-type': 'text/html' } })],
  ['bad-json', () => new Response('{', { status: 201, headers: { 'content-type': 'application/json' } })],
  ['wrong status', () => Response.json(receipt(create()), { status: 200 })],
  ['accepted', () => Response.json(receipt(create()), { status: 202 })],
  ['204', () => new Response(null, { status: 204 })],
  ['no data', () => Response.json({}, { status: 201 })],
  ['oversized', () => Response.json({ padding: 'x'.repeat(65537), ...receipt(create()) }, { status: 201 })],
  ['error and data', () => Response.json({ error: 'SECRET', ...receipt(create()) }, { status: 201 })],
  ['bad utf8', () => new Response(Uint8Array.of(0xc3,0x28), { status: 201, headers: { 'content-type': 'application/json' } })],
  ['network', () => { throw new Error('SECRET'); }],
  ['500 after possible commit', () => Response.json({ error: 'SECRET' }, { status: 500 })],
  ['HTTP 409 HTML gateway', () => new Response('SECRET', { status: 409 })]
]) test(`${name}: no success, leak or automatic retry`, async () => {
  let calls = 0; const result = await api.submitTimeAction(create(), { fetchImpl: async () => { calls++; return response(); } });
  assert.deepEqual(plain(result), { outcome: 'unknown' }); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes('SECRET'));
});
for (const status of [400,401,403,404,409,413,422,429]) test(`explicit JSON rejection ${status} is separated from uncertain outcome`, async () => {
  const result = await api.submitTimeAction(create(), { fetchImpl: async () => Response.json({ error: 'SECRET' }, { status }) });
  assert.deepEqual(plain(result), { outcome: 'rejected', status });
});
for (const a of [null, {}, { kind: 'delete' }, { ...submit(), entryId: '..' }, { ...submit(), priorStatus: 'APPROVED' }, create({ minutes: false })]) test(`invalid action does not make a request ${JSON.stringify(a)}`, async () => {
  let calls = 0; assert.equal((await api.submitTimeAction(a, { fetchImpl: async () => { calls++; } })).outcome, 'invalid'); assert.equal(calls, 0);
});
test('pre-cancelled request has no side effects', async () => {
  let calls = 0; const c = new AbortController(); c.abort();
  assert.equal((await api.submitTimeAction(create(), { signal: c.signal, fetchImpl: async () => { calls++; } })).outcome, 'unknown'); assert.equal(calls, 0);
});
test('timeout settles even if transport ignores abort; late reply cannot cause second action', async () => {
  const wait = defer(); let calls = 0;
  const result = await api.submitTimeAction(create(), { timeoutMs: 5, fetchImpl: async () => { calls++; return wait.promise; } });
  assert.equal(result.outcome, 'unknown'); wait.resolve(Response.json(receipt(create()), { status: 201 })); await tick(); assert.equal(calls, 1);
});
test('stalled body times out and releases reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
  const result = await api.submitTimeAction(create(), { timeoutMs: 5, fetchImpl: async () => new Response(body, { status: 201, headers: { 'content-type': 'application/json' } }) });
  assert.equal(result.outcome, 'unknown'); await tick(); assert.equal(cancelled, true);
});
test('external cancellation settles pending transport', async () => {
  const c = new AbortController(); const p = api.submitTimeAction(create(), { signal: c.signal, fetchImpl: async () => new Promise(() => {}) }); c.abort(); assert.equal((await p).outcome, 'unknown');
});
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const descend = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(descend) : [n, ...descend(n.props?.children)];
function harness({ locale = 'en', send = async () => ({ outcome: 'unknown' }), confirm = true, schedule = true, status = 'DRAFT', employmentId = 'qa-employee' } = {}) {
  const state = [], refs = [], cleanups = [], calls = [], events = []; let si = 0, ri = 0, initial = true, tree, reloads = 0, resets = 0, refreshes = 0;
  const entry = { id: 'qa-time', workDate: '2026-10-05T00:00:00.000Z', startAt: null, endAt: null, minutes: 480, overtimeMinutes: 30, status, source: 'SELF_SERVICE' };
  const props = { employmentId, data: { schedule: schedule ? { code: 'QA', name: 'QA', timezone: 'UTC', weeklyMinutes: 2400 } : null, entries: [entry], totals: { minutes: 480, overtimeMinutes: 30, submitted: 0, locked: 0 } } };
  const mod = load('components/time-participant-console.tsx', {
    '@/lib/time-client-action': { ...api, submitTimeAction(...args) { calls.push(args); return send(...args); } },
    '@/components/locale-provider': { useLocale: () => ({ locale }) },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
    'lucide-react': Object.fromEntries(['CalendarClock','CheckCircle2','CircleAlert','Clock3','Send','ShieldCheck','TimerReset'].map(n => [n,n])),
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: {
      useState(v) { const i=si++; if(initial) state[i]=typeof v==='function'?v():v; return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}]; },
      useRef(v) { const i=ri++; if(initial) refs[i]={current:v}; return refs[i]; },
      useEffect(fn) { if(initial) cleanups.push(fn()); }
    }
  }, { FormData: class { constructor(f) {this.values=f.values;} get(k) {return this.values[k] ?? null;} }, window: { confirm: () => confirm, dispatchEvent(e) {events.push(e.type);}, location: {reload(){reloads++;}} } });
  const wrapper = mod.TimeParticipantConsole(props);
  const render = () => {si=ri=0; tree=wrapper.type(props); initial=false; return tree;};
  const nodes = () => descend(tree); render();
  const form = {values:{workDate:'2026-10-05',minutes:'480',overtimeMinutes:'30',startAt:'',endAt:''},reset(){resets++;}};
  return {props,wrapper,state,calls,events,form,render,nodes, create() { nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:form}); },
    submit: () => nodes().find(n=>Object.hasOwn(n.props,'data-time-submit'))?.props.onClick(),
    reload: () => nodes().find(n=>Object.hasOwn(n.props,'data-time-reload'))?.props.onClick(),
    async flush(){await tick();render();}, unmount(){cleanups.forEach(fn=>fn?.());}, get resets(){return resets;},get reloads(){return reloads;},get refreshes(){return refreshes;}
  };
}
for (const locale of ['en','tr']) {
  test(`${locale}: same-turn create/create/submit sends one request and disables all inputs`, async () => {
    const wait=defer(), h=harness({locale,send:()=>wait.promise}); h.create(); h.create(); h.submit(); h.render();
    assert.equal(h.calls.length,1); assert.ok(h.nodes().filter(n=>n.type==='input').every(n=>n.props.disabled));
    wait.resolve({outcome:'unknown'}); await h.flush(); assert.equal(h.resets,0); assert.ok(h.nodes().some(n=>Object.hasOwn(n.props,'data-time-review'))); h.unmount();
  });
  test(`${locale}: committed-but-lost create retains input and never replays on props refresh`, async () => {
    const h=harness({locale}); h.create(); await h.flush(); h.props.data={...h.props.data};h.render();h.create();h.submit();
    assert.equal(h.calls.length,1); assert.equal(h.resets,0); assert.equal(h.form.values.minutes,'480'); h.reload();h.reload();assert.equal(h.reloads,1);assert.equal(h.calls.length,1);h.unmount();
  });
  test(`${locale}: matching create alone resets form; reload barrier survives router refresh`, async () => {
    const h=harness({locale,send:async()=>({outcome:'saved',id:'qa-time',status:'DRAFT'})});h.create();await h.flush();assert.equal(h.resets,1);assert.equal(h.refreshes,1);h.create();h.submit();assert.equal(h.calls.length,1);h.unmount();
  });
  test(`${locale}: validation rejection preserves editable input and permits deliberate correction`, async () => {
    const h=harness({locale,send:async()=>({outcome:'rejected',status:400})});h.create();await h.flush();assert.equal(h.resets,0);assert.ok(h.nodes().filter(n=>n.type==='input').every(n=>!n.props.disabled));h.create();await h.flush();assert.equal(h.calls.length,2);h.unmount();
  });
  test(`${locale}: malformed local interval makes no request and is not silently dropped`, async () => {
    const h=harness({locale});h.form.values.startAt='nonsense';h.create();await h.flush();assert.equal(h.calls.length,0);assert.equal(h.resets,0);h.unmount();
  });
  test(`${locale}: dismissed submission neither sends nor seals draft`, async () => {
    const h=harness({locale,confirm:false});h.submit();await h.flush();assert.equal(h.calls.length,0);h.create();assert.equal(h.calls.length,1);h.unmount();
  });
  test(`${locale}: confirmed submission is not approval and cannot be repeated on stale rows`, async () => {
    const h=harness({locale,send:async()=>({outcome:'saved',id:'qa-time',status:'SUBMITTED'})});h.submit();h.submit();await h.flush();h.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0].kind,'submit');assert.equal(h.resets,0);assert.ok(JSON.stringify(h.nodes()).includes(locale==='tr'?'henüz onaylanmış':'not approved'));h.unmount();
  });
  for (const status of [401,403,409]) test(`${locale}: ${status} cannot unlock stale create or submit`, async () => {
    const h=harness({locale,send:async()=>({outcome:'rejected',status})});h.create();await h.flush();h.create();h.submit();assert.equal(h.calls.length,1);assert.equal(h.resets,0);h.unmount();
  });
  test(`${locale}: missing schedule prevents direct submit but permits draft`, async () => {
    const h=harness({locale,schedule:false});h.submit();assert.equal(h.calls.length,0);h.create();await h.flush();assert.equal(h.calls.length,1);h.unmount();
  });
  test(`${locale}: unmounted response never resets or refreshes another employee view`, async () => {
    const wait=defer(),h=harness({locale,send:()=>wait.promise});h.create();h.unmount();assert.equal(h.calls[0][1].signal.aborted,true);wait.resolve({outcome:'saved',id:'qa-time',status:'DRAFT'});await h.flush();assert.equal(h.resets,0);assert.equal(h.refreshes,0);assert.equal(h.events.length,0);
  });
}
test('employment key changes the control identity',()=>{const a=harness(),b=harness({employmentId:'other'});assert.notEqual(a.wrapper.key,b.wrapper.key);a.unmount();b.unmount();});
for (const status of ['APPROVED','LOCKED','SUBMITTED']) test(`${status} never presents a submit action`,()=>{const h=harness({status});assert.equal(h.nodes().filter(n=>Object.hasOwn(n.props,'data-time-submit')).length,0);h.unmount();});
