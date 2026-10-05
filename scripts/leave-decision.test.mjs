/** Executes real TS code with explicit transport/hooks; real browser evidence is separate. */
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
const helper = load('lib/leave-client-action.ts');
const action = { kind: 'decision', requestId: 'r1', decision: 'APPROVED' };
const receipt = changes => ({ data: { id: 'r1', employmentId: 'e1', status: 'APPROVED', approverId: 'manager1', decidedAt: '2026-10-05T12:00:00.000Z', ...changes } });
const transport = async (response, selected = action, options = {}) => {
  const calls = [];
  const result = await helper.submitLeaveAction(selected, { ...options, fetchImpl: async (...args) => {
    calls.push(args); return typeof response === 'function' ? response(...args) : response;
  }});
  return { result, calls };
};
for (const decision of ['APPROVED', 'REJECTED']) test(`decision ${decision} verifies exact record, state and decision metadata`, async () => {
  const { result, calls } = await transport(Response.json(receipt({ status: decision })), { ...action, decision });
  assert.equal(result.outcome, 'saved'); assert.equal(result.status, decision); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/leave/requests/r1/decision');
  assert.deepEqual(JSON.parse(calls[0][1].body), { decision });
  for (const [k, v] of Object.entries({ method: 'POST', redirect: 'error', credentials: 'same-origin', cache: 'no-store' })) assert.equal(calls[0][1][k], v);
});
for (const [field, value] of [['id', 'other'], ['status', 'REJECTED'], ['status', 'PENDING'], ['employmentId', null], ['approverId', null], ['approverId', []], ['decidedAt', null], ['decidedAt', 'invalid']]) {
  test(`mismatched decision ${field} is not saved`, async () => {
    assert.equal((await transport(Response.json(receipt({ [field]: value })))).result.outcome, 'unknown');
  });
}
for (const [label, response] of [
  ['html', () => new Response('<html>secret</html>')],
  ['empty', () => new Response('')],
  ['malformed', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
  ['wrong HTTP', () => Response.json(receipt(), { status: 201 })],
  ['accepted not completed', () => Response.json(receipt(), { status: 202 })],
  ['error with data', () => Response.json({ ...receipt(), error: 'secret' })],
  ['oversize', () => Response.json({ ...receipt(), junk: 'x'.repeat(65537) })],
  ['invalid UTF8', () => new Response(Uint8Array.of(0xc3, 0x28), { headers: { 'content-type': 'application/json' } })],
  ['server error', () => Response.json({ error: 'secret' }, { status: 500 })],
  ['network failure', () => { throw new Error('secret'); }]
]) test(`decision ${label} returns unknown without replay or error text`, async () => {
  const { result, calls } = await transport(response);
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1); assert.ok(!JSON.stringify(result).includes('secret'));
});
for (const status of [400, 401, 403, 404, 409, 422, 429]) test(`decision controlled ${status} is not saved`, async () => {
  const { result } = await transport(Response.json({ error: 'secret' }, { status }));
  assert.equal(result.outcome, 'rejected'); assert.equal(result.status, status);
});
test('invalid decision and dot path IDs send nothing; other path characters are encoded', async () => {
  for (const invalid of [{ decision: 'CANCELLED' }, { requestId: '..' }, { requestId: '.' }, { requestId: '' }]) {
    const { calls, result } = await transport(Response.json(receipt()), { ...action, ...invalid });
    assert.equal(calls.length, 0); assert.equal(result.status, 400);
  }
  const id = 'r/?# &ö'; const { calls } = await transport(Response.json(receipt({ id })), { ...action, requestId: id });
  assert.equal(calls[0][0], `/api/leave/requests/${encodeURIComponent(id)}/decision`);
});
test('decision abort timeout does not assert rollback or retry', async () => {
  const { result, calls } = await transport((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  }), action, { timeoutMs: 5 });
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
});
for (const [label, reply, expected] of [
  ['valid', () => Response.json({ data: { updated: 1, unreadCount: 0 } }), true],
  ['zero rows', () => Response.json({ data: { updated: 0, unreadCount: 3 } }), true],
  ['html', () => new Response('private'), false],
  ['negative count', () => Response.json({ data: { updated: -1, unreadCount: 0 } }), false],
  ['non-integer', () => Response.json({ data: { updated: 1, unreadCount: 0.1 } }), false],
  ['error', () => Response.json({ error: 'private' }, { status: 500 }), false]
]) test(`notification acknowledgement ${label}`, async () => {
  const calls = [];
  const result = await helper.acknowledgeLeaveNotification('r1', { fetchImpl: async (...args) => { calls.push(args); return reply(); } });
  assert.equal(result, expected); assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/notifications');
  assert.deepEqual(JSON.parse(calls[0][1].body), { resourceType: 'LeaveRequest', resourceId: 'r1', read: true });
  assert.equal(calls[0][1].redirect, 'error');
});
test('notification acknowledgement is bounded and never retries', async () => {
  let calls = 0;
  assert.equal(await helper.acknowledgeLeaveNotification('r1', { timeoutMs: 5, fetchImpl: async (_url, options) => {
    calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error()), { once: true }));
  }}), false);
  assert.equal(calls, 1);
});

function harness(locale, { submit, ack = async () => true, confirm = true, refreshThrows = false } = {}) {
  const values = [], refs = [], cleanups = [], submitted = [], acknowledged = [], events = [];
  let stateIndex = 0, refIndex = 0, initial = true, tree, refreshes = 0, reloads = 0;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const hooks = {
    useState(initialValue) { const index = stateIndex++; if (initial) values[index] = initialValue; return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initialValue) { const index = refIndex++; if (initial) refs[index] = { current: initialValue }; return refs[index]; },
    useEffect(fn) { if (initial) cleanups.push(fn()); }
  };
  const mod = load('components/leave-decision-buttons.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/navigation': { useRouter: () => ({ refresh() { refreshes++; if (refreshThrows) throw new Error('refresh'); } }) },
    'lucide-react': { Check: 'check', X: 'x' }, '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/lib/leave-client-action': {
      async submitLeaveAction(...args) { submitted.push(args); return submit(...args); },
      async acknowledgeLeaveNotification(...args) { acknowledged.push(args); return ack(...args); }
    }
  }, { window: { confirm: () => confirm, dispatchEvent(event) { events.push(event.type); }, location: { reload() { reloads++; } } } });
  const wrapper = mod.LeaveDecisionButtons({ requestId: 'r1' });
  const render = () => { stateIndex = 0; refIndex = 0; tree = wrapper.type(wrapper.props); initial = false; return tree; };
  render();
  function descend(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(n => descend(n)); return [node, ...descend(node.props?.children)]; }
  const nodes = () => descend(tree);
  return { render, nodes, submitted, acknowledged, events, wrapper,
    button(decision) { return nodes().find(n => n.props['data-decision'] === decision); },
    async flush() { await tick(); render(); },
    unmount() { cleanups.forEach(fn => fn?.()); },
    get refreshes() { return refreshes; }, get reloads() { return reloads; }
  };
}
for (const locale of ['en', 'tr']) {
  test(`${locale} explicit confirmation can be dismissed without writes`, () => {
    const h = harness(locale, { confirm: false }); h.button('APPROVED').props.onClick();
    assert.equal(h.submitted.length, 0); assert.equal(h.acknowledged.length, 0);
  });
  test(`${locale} opposite same-turn clicks submit once, then confirmed receipt seals row`, async () => {
    let resolve; const h = harness(locale, { submit: () => new Promise(r => { resolve = r; }) });
    const approve = h.button('APPROVED'), reject = h.button('REJECTED');
    approve.props.onClick(); reject.props.onClick(); h.render();
    assert.equal(h.submitted.length, 1); assert.equal(h.acknowledged.length, 0);
    assert.ok(h.button('APPROVED').props.disabled && h.button('REJECTED').props.disabled);
    resolve({ outcome: 'saved', id: 'r1', status: 'APPROVED' }); await h.flush();
    assert.equal(h.acknowledged.length, 1); assert.equal(h.refreshes, 1); assert.equal(h.button('APPROVED'), undefined);
    reject.props.onClick(); assert.equal(h.submitted.length, 1);
    assert.ok(h.nodes().some(n => n.props['data-leave-decision-result'] === 'saved'));
  });
  for (const result of [{ outcome: 'unknown' }, { outcome: 'rejected', status: 409 }]) test(`${locale} ${result.outcome} never closes notifications or permits blind retry`, async () => {
    const h = harness(locale, { submit: async () => result }); const approve = h.button('APPROVED');
    approve.props.onClick(); await h.flush(); approve.props.onClick();
    assert.equal(h.submitted.length, 1); assert.equal(h.acknowledged.length, 0); assert.equal(h.events.length, 0);
    const reload = h.nodes().find(n => Object.hasOwn(n.props, 'data-leave-decision-reload'));
    reload.props.onClick(); reload.props.onClick(); assert.equal(h.reloads, 1); assert.equal(h.submitted.length, 1);
  });
}
test('notification/refresh errors cannot undo a verified rejection or reopen its buttons', async () => {
  const h = harness('en', { submit: async () => ({ outcome: 'saved', id: 'r1', status: 'REJECTED' }), ack: async () => { throw new Error(); }, refreshThrows: true });
  h.button('REJECTED').props.onClick(); await h.flush();
  assert.ok(h.nodes().some(n => n.props['data-leave-decision-result'] === 'saved')); assert.equal(h.button('APPROVED'), undefined);
});
test('unmount aborts in-flight request and suppresses late acknowledgement/refresh', async () => {
  let resolve; const h = harness('tr', { submit: () => new Promise(r => { resolve = r; }) });
  h.button('APPROVED').props.onClick(); h.unmount();
  assert.equal(h.submitted[0][1].signal.aborted, true);
  resolve({ outcome: 'saved', id: 'r1', status: 'APPROVED' }); await h.flush();
  assert.equal(h.refreshes, 0); assert.equal(h.acknowledged.length, 0);
});
test('request identity remounts; explicit button types cannot submit an enclosing form', () => {
  const h = harness('en'); assert.equal(h.wrapper.key, 'r1');
  assert.ok(h.nodes().filter(n => n.type === 'button').every(n => n.props.type === 'button'));
});
test('decision browser and unit stages are mandatory without changing the prior final gates', () => {
  const source = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.match(source, /node scripts\/leave-decision-browser-regression\.mjs/);
  assert.match(source, /scripts\/leave-decision\.test\.mjs/);
  assert.match(source, /node scripts\/module-workspace-browser-regression\.mjs\s+node scripts\/core-workspace-browser-regression\.mjs\s+node scripts\/platform-remediation-gate\.mjs/);
});
