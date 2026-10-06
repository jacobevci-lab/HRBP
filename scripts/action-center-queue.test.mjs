import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import ts from 'typescript';
function load(path, mocks = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
  }}).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, Response, URL, TextDecoder, AbortController, setTimeout, clearTimeout, Event, ...globals });
  return module.exports;
}
const queue = load('lib/action-center-queue.ts');
const summaryKeys = ['total','overdue','dueSoon','critical','workflow','hrService','employeeRelations','documents','onboarding','offboarding','leave','timeAttendance','compensation','payroll','benefits','performance','learning','developmentPlans','succession','recruiting','policies','workforcePlanning','privacy','engagement'];
const stamp = '2026-10-05T12:00:00.000Z';
const row = changes => ({ id: 'time:qa1', kind: 'time-attendance', title: 'QA time', subtitle: 'Test only', module: 'time-attendance', href: '/module/time-attendance?entry=qa1', subjectType: 'Employment', subjectId: 'qa-employee', status: 'SUBMITTED', createdAt: stamp, dueAt: null, urgency: 'normal', action: { type: 'approve-time', entryId: 'qa1' }, secondaryAction: { type: 'reject-time', entryId: 'qa1' }, ...changes });
const envelope = (items = [row()]) => ({ data: { items, summary: Object.fromEntries(summaryKeys.map(k => [k, k === 'total' ? items.length : 0])), generatedAt: stamp } });
const plain = v => JSON.parse(JSON.stringify(v));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const items of [[], [row()], [row({ action: null, secondaryAction: null })]]) test(`valid queue of ${items.length} records is accepted`, () => assert.deepEqual(plain(queue.decodeActionQueue(envelope(items))), envelope(items).data));
for (const value of [null, [], {}, { data: {} }, { data: null }, { data: [] }, { error: 'private', ...envelope() }]) test(`invalid envelope ${JSON.stringify(value).slice(0,40)} is not empty success`, () => assert.equal(queue.decodeActionQueue(value), null));
for (const key of summaryKeys) test(`missing summary ${key} rejects complete snapshot`, () => { const e = envelope(); delete e.data.summary[key]; assert.equal(queue.decodeActionQueue(e), null); });
for (const value of [-1, 0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid count ${value} rejected`, () => { const e = envelope(); e.data.summary.total = value; assert.equal(queue.decodeActionQueue(e), null); });
for (const changes of [{ id: '' }, { kind: 'unknown' }, { title: {} }, { subtitle: null }, { subjectId: [] }, { status: null }, { createdAt: 'invalid' }, { dueAt: 'invalid' }, { urgency: 'bad' }, { action: undefined }, { action: [] }, { action: { type: '__proto__' } }, { action: { type: 'approve-time', entryId: '..' } }, { secondaryAction: { type: 'unknown' } }, { action: { type: 'advance-onboarding-task', taskId: 't', status: 'DELETED' } }]) {
  test(`invalid row ${JSON.stringify(changes)} rejects complete snapshot`, () => assert.equal(queue.decodeActionQueue(envelope([row(changes)])), null));
}
for (const href of ['https://evil.invalid','//evil.invalid','/api/auth/logout','/module/../api','/module/x/../../evil','/module//evil','/module/%2e%2e','/module/x\\evil','/module/x\n','javascript:alert(1)']) test(`noncanonical module link ${JSON.stringify(href)} rejected`, () => assert.equal(queue.decodeActionQueue(envelope([row({ href })])), null));
test('encoded exact focus query is retained without normalization', () => { const href = '/module/people?person=p%2F1&tab=history#record'; assert.equal(queue.decodeActionQueue(envelope([row({ href })])).items[0].href, href); });
test('duplicate row keys and excessive queue size rejected', () => {
  assert.equal(queue.decodeActionQueue(envelope([row(), row()])), null);
  assert.equal(queue.decodeActionQueue(envelope(Array.from({ length: 5001 }, (_, i) => row({ id: `qa${i}` })))), null);
});
test('cross-record leave capabilities remain available to existing fail-closed leave adapter', () => {
  const item = row({ kind: 'leave', action: { type: 'approve-leave', requestId: 'a' }, secondaryAction: { type: 'reject-leave', requestId: 'b' } });
  assert.ok(queue.decodeActionQueue(envelope([item])));
});
test('one fixed same-origin GET, no redirects or replay', async () => {
  const calls = []; const reader = queue.createActionQueueLoader({ fetchImpl: async (...args) => { calls.push(args); return Response.json(envelope()); } });
  assert.equal(reader.ready, false); const result = await reader.load(); assert.equal(result.outcome, 'loaded'); assert.equal(reader.ready, true);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/action-center');
  for (const [key, value] of Object.entries({ method: 'GET', redirect: 'error', credentials: 'same-origin', cache: 'no-store' })) assert.equal(calls[0][1][key], value);
});
for (const [name, response, reason] of [
  ['html', () => new Response('<html>private</html>'), 'unavailable'],
  ['empty', () => new Response('', { headers: { 'content-type': 'application/json' } }), 'unavailable'],
  ['malformed JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } }), 'unavailable'],
  ['bad UTF8', () => new Response(Uint8Array.of(0xc3, 0x28), { headers: { 'content-type': 'application/json' } }), 'unavailable'],
  ['204', () => new Response(null, { status: 204 }), 'unavailable'],
  ['202', () => Response.json(envelope(), { status: 202 }), 'unavailable'],
  ['500 private error', () => Response.json({ error: 'private' }, { status: 500 }), 'unavailable'],
  ['401', () => new Response('private', { status: 401 }), 'session'],
  ['403', () => new Response('private', { status: 403 }), 'access'],
  ['oversized', () => Response.json({ data: 'x'.repeat(4 * 1024 * 1024) }), 'unavailable'],
  ['network', () => { throw new Error('private'); }, 'unavailable']
]) test(`${name}: controlled failure without raw content or repeat`, async () => {
  let calls = 0; const reader = queue.createActionQueueLoader({ fetchImpl: async () => { calls++; return response(); } });
  const result = await reader.load(); assert.deepEqual(plain(result), { outcome: 'unavailable', reason }); assert.equal(reader.ready, false); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('out-of-order late success cannot replace newest result even when fetch ignores abort', async () => {
  const first = defer(); let calls = 0, firstSignal;
  const reader = queue.createActionQueueLoader({ fetchImpl: async (_url, init) => { if (++calls === 1) { firstSignal = init.signal; return first.promise; } return Response.json(envelope([row({ title: 'new' })])); } });
  const old = reader.load(), fresh = reader.load(); assert.equal(firstSignal.aborted, true);
  assert.equal((await fresh).data.items[0].title, 'new'); first.resolve(Response.json(envelope([row({ title: 'old' })])));
  assert.equal((await old).outcome, 'ignored'); assert.equal(reader.ready, true);
});
test('late failure cannot revoke a newer valid list', async () => {
  const first = defer(); let calls = 0;
  const reader = queue.createActionQueueLoader({ fetchImpl: async () => ++calls === 1 ? first.promise : Response.json(envelope()) });
  const old = reader.load(); await reader.load(); first.resolve(new Response('private', { status: 403 }));
  assert.equal((await old).outcome, 'ignored'); assert.equal(reader.ready, true);
});
test('invalidation suppresses all results and supports a subsequent effect setup', async () => {
  const wait = defer(); let calls = 0;
  const reader = queue.createActionQueueLoader({ fetchImpl: async () => ++calls === 1 ? wait.promise : Response.json(envelope()) });
  const pending = reader.load(); reader.invalidate(); wait.resolve(Response.json(envelope()));
  assert.equal((await pending).outcome, 'ignored'); assert.equal(reader.ready, false); assert.equal((await reader.load()).outcome, 'loaded');
});
test('timeout settles even when transport ignores AbortSignal and allows explicit retry', async () => {
  let calls = 0; const reader = queue.createActionQueueLoader({ timeoutMs: 5, fetchImpl: async () => ++calls === 1 ? new Promise(() => {}) : Response.json(envelope()) });
  assert.equal((await reader.load()).outcome, 'unavailable'); assert.equal(reader.ready, false);
  assert.equal((await reader.load()).outcome, 'loaded'); assert.equal(calls, 2);
});
test('timeout also bounds a stalled streaming body', async () => {
  let cancelled = false; const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
  const reader = queue.createActionQueueLoader({ timeoutMs: 5, fetchImpl: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) });
  assert.equal((await reader.load()).outcome, 'unavailable'); await tick(); assert.equal(cancelled, true);
});
for (const timeoutMs of [0, -1, 1.5, NaN, 60001]) test(`invalid timeout ${timeoutMs} cannot start IO`, () => assert.throws(() => queue.createActionQueueLoader({ timeoutMs })));
for (const locale of ['tr', 'en']) for (const reason of ['session','access','unavailable']) test(`${locale}/${reason}: fixed translated message`, () => assert.ok(queue.queueFailureMessage(reason, locale).length > 30));

const jsx = (type, props, key) => ({ type, props: props || {}, key });
const descend = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(descend) : [n, ...descend(n.props?.children)];
function harness(fetchImpl, locale = 'en') {
  const values = [], refs = [], cleanups = []; let si = 0, ri = 0, initial = true, tree;
  const icons = Object.fromEntries(['AlertTriangle','BadgeDollarSign','BookOpenCheck','BriefcaseBusiness','CalendarCheck2','CheckCircle2','ClipboardCheck','Clock3','ExternalLink','FileClock','HeartHandshake','ReceiptText','RefreshCw','Search','ShieldAlert','SlidersHorizontal','Target','TimerReset','UserMinus','UserPlus','UsersRound','Workflow'].map(n => [n,n]));
  const mod = load('components/workflow-action-center.tsx', {
    'next/link': { default: 'link' }, 'lucide-react': icons, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/components/leave-decision-buttons': { LeaveDecisionButtons: 'LEAVE_CONTROL' },
    '@/components/time-decision-buttons': { TimeDecisionButtons: 'TIME_CONTROL' },
    '@/lib/action-center-time-control': {
      actionCenterTimeControl: (item) => item?.kind === 'time-attendance' ? {
        entryId: item.action?.entryId ?? item.secondaryAction?.entryId,
        allowedDecisions: [item.action?.type === 'approve-time' ? 'APPROVED' : null, item.secondaryAction?.type === 'reject-time' ? 'REJECTED' : null].filter(Boolean)
      } : null,
      isActionCenterTimeItem: (item) => item?.kind === 'time-attendance' || item?.action?.type === 'approve-time' || item?.secondaryAction?.type === 'reject-time'
    },
    '@/lib/action-center-leave-control': { actionCenterLeaveControl: () => null, isActionCenterLeaveItem: () => false },
    '@/lib/action-center-queue': { ...queue, createActionQueueLoader: () => queue.createActionQueueLoader({ fetchImpl }) },
    react: {
      useState(v) { const i = si++; if (initial) values[i] = typeof v === 'function' ? v() : v; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      useRef(v) { const i = ri++; if (initial) refs[i] = { current: v }; return refs[i]; },
      useEffect(fn) { if (initial) cleanups.push(fn()); }, useCallback(fn) { return fn; }, useMemo(fn) { return fn(); }
    }
  }, { window: { addEventListener() {}, removeEventListener() {}, confirm: () => true }, fetch: fetchImpl });
  const render = () => { si = ri = 0; tree = mod.WorkflowActionCenter({}); initial = false; return tree; };
  render();
  return { values, render, nodes: () => descend(tree), refresh: () => descend(tree).find(n => n.type === 'button' && n.props.className === 'secondary-button').props.onClick(),
    unmount() { cleanups.forEach(fn => fn?.()); }, async flush() { await tick(); render(); } };
}
for (const locale of ['en','tr']) test(`${locale}: unavailable queue retains rows but closes generic mutations; retry preserves filters`, async () => {
  let calls = 0, writes = 0;
  const h = harness(async (_url, init) => { if (init.method !== 'GET') { writes++; throw new Error(); } return ++calls === 2 ? Response.json({ error: 'raw-private' }, { status: 503 }) : Response.json(envelope()); }, locale);
  await h.flush(); assert.equal(h.nodes()[0].props['data-queue-state'], 'ready');
  assert.equal(h.nodes().find(n => n.type === 'TIME_CONTROL').props.disabled, false);
  h.values[3] = 'QA'; h.values[4] = true; h.refresh(); await h.flush();
  assert.equal(writes, 0); assert.equal(h.nodes()[0].props['data-queue-state'], 'unavailable');
  assert.ok(h.nodes().some(n => n.type === 'tr' && n.props.id === 'action-item-time:qa1'));
  assert.equal(h.nodes().find(n => n.type === 'TIME_CONTROL').props.disabled, true);
  assert.ok(!JSON.stringify(h.nodes()).includes('raw-private')); h.refresh(); await h.flush();
  assert.equal(h.values[3], 'QA'); assert.equal(h.values[4], true); assert.equal(h.nodes()[0].props['data-queue-state'], 'ready'); h.unmount();
});
test('invalid initial payload cannot display a successful empty queue', async () => {
  const h = harness(async () => Response.json({})); await h.flush();
  assert.equal(h.nodes()[0].props['data-queue-state'], 'unavailable');
  assert.ok(!JSON.stringify(h.nodes()).includes('No pending actions in this view.')); h.unmount();
});
test('explicit access failure clears previously rendered protected data', async () => {
  let count = 0; const h = harness(async () => ++count === 1 ? Response.json(envelope()) : new Response('private', { status: 401 }));
  await h.flush(); h.refresh(); await h.flush(); assert.equal(h.values[0].length, 0); assert.equal(h.nodes()[0].props['data-queue-state'], 'unavailable'); h.unmount();
});
test('view unmount suppresses late state updates', async () => {
  const wait = defer(); const h = harness(async () => wait.promise); h.unmount(); wait.resolve(Response.json(envelope())); await h.flush(); assert.equal(h.values[0].length, 0);
});
test('queue refresh never resets the prior leave attempt registry', () => {
  const s = readFileSync('components/workflow-action-center.tsx','utf8'); const refresh = s.slice(s.indexOf('const refresh ='), s.indexOf('const handleLifecycleChange'));
  assert.ok(!/leaveAttempts\.(?:current\s*=|current\.clear)/.test(refresh));
});
