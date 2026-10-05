/** Actual TS modules with controlled transports/hooks; full-browser evidence is separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import ts from 'typescript';
function load(path, mocks = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  }}).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unmocked dependency ${name}`);
  }, Response, TextDecoder, AbortController, setTimeout, clearTimeout, Event, ...globals });
  return module.exports;
}
const helper = load('lib/time-client-action.ts');
const receipt = (target = 'APPROVED', changes = {}) => ({ data: {
  id: 't1', employmentId: 'e1', status: target, workDate: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z', minutes: 480, overtimeMinutes: 30,
  approvedById: target === 'SUBMITTED' ? null : 'manager1',
  approvedAt: target === 'SUBMITTED' ? null : '2026-10-05T12:00:00.000Z', ...changes
}});
async function send(reply, { id = 't1', target = 'APPROVED', ...options } = {}) {
  const calls = [];
  const result = await helper.submitTimeTransition(id, target, { ...options, fetchImpl: async (...args) => {
    calls.push(args); return typeof reply === 'function' ? reply(...args) : reply;
  }});
  return { result, calls };
}
for (const target of ['SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED']) test(`${target} requires the exact transition receipt`, async () => {
  const { result, calls } = await send(Response.json(receipt(target)), { target });
  assert.equal(result.outcome, 'saved'); assert.equal(result.status, target); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/time/entries/t1/transition');
  assert.deepEqual(JSON.parse(calls[0][1].body), { status: target });
  for (const [key, value] of Object.entries({ method: 'POST', redirect: 'error', credentials: 'same-origin', cache: 'no-store' })) assert.equal(calls[0][1][key], value);
});
for (const [field, value] of [
  ['id', 'other'], ['status', 'REJECTED'], ['employmentId', null], ['employmentId', []],
  ['updatedAt', null], ['updatedAt', 'invalid'], ['workDate', null], ['minutes', '480'],
  ['minutes', 0], ['minutes', 1441], ['overtimeMinutes', -1], ['overtimeMinutes', 481],
  ['approvedById', null], ['approvedById', []], ['approvedAt', null], ['approvedAt', 'invalid']
]) test(`malformed ${field} is never successful`, async () => {
  const { result, calls } = await send(Response.json(receipt('APPROVED', { [field]: value })));
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
});
for (const changes of [{ approvedById: 'old-approver' }, { approvedAt: '2026-10-01T00:00:00Z' }]) test(`submission must clear prior decision metadata: ${JSON.stringify(changes)}`, async () => {
  assert.equal((await send(Response.json(receipt('SUBMITTED', changes)), { target: 'SUBMITTED' })).result.outcome, 'unknown');
});
for (const [label, reply] of [
  ['HTML', () => new Response('<html>private upstream response</html>')],
  ['empty', () => new Response('')],
  ['broken JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
  ['no data', () => Response.json({})], ['array data', () => Response.json({ data: [] })],
  ['202', () => Response.json(receipt(), { status: 202 })], ['201', () => Response.json(receipt(), { status: 201 })],
  ['server error', () => Response.json({ error: 'private' }, { status: 500 })],
  ['mixed error/data', () => Response.json({ ...receipt(), error: 'private' })],
  ['oversize', () => Response.json({ ...receipt(), padding: 'x'.repeat(65537) })],
  ['invalid UTF-8', () => new Response(Uint8Array.of(0xc3, 0x28), { headers: { 'content-type': 'application/json' } })],
  ['network failure', () => { throw new Error('private'); }],
  ['redirected', () => { const r = Response.json(receipt()); Object.defineProperty(r, 'redirected', { value: true }); return r; }]
]) test(`${label} yields unknown without retry or upstream text`, async () => {
  const { result, calls } = await send(reply);
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1); assert.ok(!JSON.stringify(result).includes('private'));
});
for (const status of [400, 401, 403, 404, 409, 422, 429]) test(`controlled ${status} remains rejected and private`, async () => {
  const { result } = await send(Response.json({ error: 'private' }, { status }));
  assert.equal(result.outcome, 'rejected'); assert.equal(result.status, status);
  for (const locale of ['en', 'tr']) assert.ok(!helper.timeActionMessage(result, locale).includes('private'));
});
for (const id of ['', '.', '..', ' leading', 'trailing ', 'a\n', 'x'.repeat(161)]) test(`invalid target identifier ${JSON.stringify(id)} sends nothing`, async () => {
  const { calls, result } = await send(Response.json(receipt()), { id }); assert.equal(calls.length, 0); assert.equal(result.outcome, 'rejected');
});
test('path punctuation is encoded as one segment', async () => {
  const id = 't/?# &ö'; const { calls } = await send(Response.json(receipt('APPROVED', { id })), { id });
  assert.equal(calls[0][0], `/api/time/entries/${encodeURIComponent(id)}/transition`);
});
for (const target of ['DRAFT', 'PAID', '', null]) test(`unsupported ${target} sends nothing`, async () => {
  const { calls } = await send(Response.json(receipt()), { target }); assert.equal(calls.length, 0);
});
test('pre-aborted transition never starts a write', async () => {
  const controller = new AbortController(); controller.abort();
  const { result, calls } = await send(Response.json(receipt()), { signal: controller.signal });
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 0);
});
test('deadline bounds a transport ignoring abort and cannot accept its late receipt', async () => {
  let resolve; const promise = send(() => new Promise(r => { resolve = r; }), { timeoutMs: 5 });
  const { result, calls } = await promise; assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
  assert.equal(calls[0][1].signal.aborted, true); resolve(Response.json(receipt())); await tick();
});
test('deadline cancels a stalled JSON stream, without replay', async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } });
  const { result, calls } = await send(response, { timeoutMs: 5 });
  await tick(); assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1); assert.equal(cancelled, 1);
});
for (const [label, body, status, expected] of [
  ['valid', { data: { updated: 1, unreadCount: 0 } }, 200, true],
  ['no matching badge', { data: { updated: 0, unreadCount: 3 } }, 200, true],
  ['negative', { data: { updated: -1, unreadCount: 0 } }, 200, false],
  ['fractional', { data: { updated: 1, unreadCount: 0.1 } }, 200, false],
  ['no receipt', {}, 200, false], ['failure', { error: 'private' }, 503, false],
  ['mixed', { data: { updated: 1, unreadCount: 0 }, error: 'private' }, 200, false]
]) test(`notification ${label} is independently verified`, async () => {
  const calls = [];
  assert.equal(await helper.acknowledgeTimeNotification('t1', { fetchImpl: async (...args) => { calls.push(args); return Response.json(body, { status }); } }), expected);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/notifications');
  assert.deepEqual(JSON.parse(calls[0][1].body), { resourceType: 'TimeEntry', resourceId: 't1', read: true });
});
test('notification timeout never retries', async () => {
  let calls = 0;
  assert.equal(await helper.acknowledgeTimeNotification('t1', { timeoutMs: 5, fetchImpl: async () => { calls++; return new Promise(() => {}); } }), false);
  assert.equal(calls, 1);
});

function harness(locale, { submit = async () => ({ outcome: 'unknown' }), ack = async () => true,
  confirm = true, targets = ['APPROVED', 'REJECTED'], refreshThrows = false } = {}) {
  const values = [], refs = [], cleanups = [], submitted = [], acknowledged = [], events = [], confirmations = [];
  let stateIndex = 0, refIndex = 0, initial = true, tree, refreshes = 0, reloads = 0, currentTargets = targets;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const hooks = {
    useState(value) { const i = stateIndex++; if (initial) values[i] = typeof value === 'function' ? value() : value; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(value) { const i = refIndex++; if (initial) refs[i] = { current: value }; return refs[i]; },
    useEffect(fn) { if (initial) cleanups.push(fn()); }
  };
  const mod = load('components/time-entry-transition-buttons.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; if (refreshThrows) throw new Error('refresh'); } }) },
    'lucide-react': { ArrowRight: 'arrow', Check: 'check', LockKeyhole: 'lock', X: 'x' },
    '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/lib/time-client-action': { ...helper,
      async submitTimeTransition(...args) { submitted.push(args); return submit(...args); },
      async acknowledgeTimeNotification(...args) { acknowledged.push(args); return ack(...args); }
    }
  }, { window: { confirm(text) { confirmations.push(text); return confirm; },
    dispatchEvent(event) { events.push(event.type); }, location: { reload() { reloads++; } } } });
  const wrapper = mod.TimeEntryTransitionButtons({ entryId: 't1', targets });
  const render = () => { stateIndex = 0; refIndex = 0; tree = wrapper.type({ ...wrapper.props, targets: currentTargets }); initial = false; return tree; };
  function descend(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(descend); return [node, ...descend(node.props?.children)]; }
  const nodes = () => descend(tree); render();
  return { render, nodes, submitted, acknowledged, events, confirmations, wrapper,
    button(target) { return nodes().find(n => n.props['data-time-target'] === target); },
    async flush() { await tick(); render(); }, unmount() { cleanups.forEach(fn => fn?.()); },
    setTargets(next) { currentTargets = next; render(); },
    get refreshes() { return refreshes; }, get reloads() { return reloads; }
  };
}
for (const locale of ['en', 'tr']) {
  test(`${locale} confirmation dismissal has no write, acknowledgement or stuck lock`, () => {
    const h = harness(locale, { confirm: false }); h.button('APPROVED').props.onClick(); h.button('REJECTED').props.onClick();
    assert.equal(h.submitted.length, 0); assert.equal(h.acknowledged.length, 0); assert.equal(h.confirmations.length, 2);
  });
  test(`${locale} opposite same-turn clicks send exactly once and seal saved row`, async () => {
    let resolve; const h = harness(locale, { submit: () => new Promise(r => { resolve = r; }) });
    const approve = h.button('APPROVED'), reject = h.button('REJECTED'); approve.props.onClick(); reject.props.onClick(); h.render();
    assert.equal(h.submitted.length, 1); assert.equal(h.confirmations.length, 1);
    assert.ok(h.button('APPROVED').props.disabled && h.button('REJECTED').props.disabled);
    resolve({ outcome: 'saved', id: 't1', status: 'APPROVED' }); await h.flush();
    assert.equal(h.acknowledged.length, 1); assert.equal(h.refreshes, 1); assert.equal(h.button('APPROVED'), undefined);
    reject.props.onClick(); assert.equal(h.submitted.length, 1);
    h.setTargets(['LOCKED']); assert.equal(h.button('LOCKED'), undefined);
  });
  for (const outcome of [{ outcome: 'unknown' }, { outcome: 'rejected', status: 409 }, { outcome: 'rejected', status: 403 }]) test(`${locale} ${JSON.stringify(outcome)} cannot acknowledge or replay`, async () => {
    const h = harness(locale, { submit: async () => outcome }); const button = h.button('APPROVED');
    button.props.onClick(); await h.flush(); button.props.onClick();
    assert.equal(h.submitted.length, 1); assert.equal(h.acknowledged.length, 0); assert.equal(h.refreshes, 0);
    assert.ok(h.nodes().some(n => n.props['data-time-transition-result'] === outcome.outcome && n.props.role === 'alert'));
    const reload = h.nodes().find(n => Object.hasOwn(n.props, 'data-time-transition-reload'));
    reload.props.onClick(); reload.props.onClick(); assert.equal(h.reloads, 1); assert.equal(h.submitted.length, 1);
  });
  for (const target of ['SUBMITTED', 'LOCKED']) test(`${locale} ${target} is confirmed without clearing approval notifications`, async () => {
    const h = harness(locale, { targets: [target], submit: async () => ({ outcome: 'saved', id: 't1', status: target }) });
    h.button(target).props.onClick(); await h.flush();
    assert.equal(h.confirmations.length, 1); assert.equal(h.refreshes, 1); assert.equal(h.acknowledged.length, 0);
  });
}
test('notification/refresh failure cannot undo saved rejection', async () => {
  const h = harness('tr', { submit: async () => ({ outcome: 'saved', id: 't1', status: 'REJECTED' }), ack: async () => { throw new Error(); }, refreshThrows: true });
  h.button('REJECTED').props.onClick(); await h.flush();
  assert.ok(h.nodes().some(n => n.props['data-time-transition-result'] === 'saved')); assert.equal(h.button('APPROVED'), undefined);
});
test('unmount aborts the write and suppresses late notification/refresh', async () => {
  let resolve; const h = harness('en', { submit: () => new Promise(r => { resolve = r; }) });
  h.button('APPROVED').props.onClick(); h.unmount(); assert.equal(h.submitted[0][2].signal.aborted, true);
  resolve({ outcome: 'saved', id: 't1', status: 'APPROVED' }); await h.flush();
  assert.equal(h.acknowledged.length, 0); assert.equal(h.refreshes, 0);
});
test('unmount aborts badge cleanup and suppresses its late event', async () => {
  let resolve; const h = harness('en', { submit: async () => ({ outcome: 'saved', id: 't1', status: 'APPROVED' }), ack: () => new Promise(r => { resolve = r; }) });
  h.button('APPROVED').props.onClick(); await h.flush(); h.unmount(); assert.equal(h.acknowledged[0][1].signal.aborted, true);
  resolve(true); await h.flush(); assert.ok(!h.events.includes('hrbp:notifications-changed'));
});
for (const targets of [[], ['DRAFT'], ['APPROVED', 'DRAFT'], ['PAID'], null]) test(`invalid capabilities ${JSON.stringify(targets)} expose no write`, () => {
  const h = harness('en', { targets }); assert.equal(h.nodes().filter(n => n.props['data-time-target']).length, 0);
});
test('targets are not expanded; duplicate targets deduplicate; buttons never submit a surrounding form', () => {
  const h = harness('tr', { targets: ['REJECTED', 'REJECTED'] });
  assert.equal(h.nodes().filter(n => n.props['data-time-target']).length, 1);
  assert.equal(h.button('APPROVED'), undefined); assert.equal(h.wrapper.key, 't1');
  assert.ok(h.nodes().filter(n => n.type === 'button').every(n => n.props.type === 'button'));
  assert.ok(JSON.stringify(h.button('REJECTED')).includes('Reddet'));
});

test('a verified rejection of legacy invalid quantities is not misclassified as unknown', async () => {
  const { result } = await send(Response.json(receipt('REJECTED', { minutes: 0, overtimeMinutes: 900 })), { target: 'REJECTED' });
  assert.equal(result.outcome, 'saved'); assert.equal(result.status, 'REJECTED');
});
test('both time test stages are mandatory and prior final gates remain adjacent', () => {
  const workflow = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.match(workflow, /node --test[^\n]*scripts\/time-transition\.test\.mjs/);
  assert.match(workflow, /node scripts\/time-transition-browser-regression\.mjs/);
  assert.match(workflow, /node scripts\/module-workspace-browser-regression\.mjs\s+node scripts\/core-workspace-browser-regression\.mjs\s+node scripts\/platform-remediation-gate\.mjs/);
});
