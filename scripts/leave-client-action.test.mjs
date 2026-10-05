/** Actual TypeScript helper/component code with deterministic transport and hook fixtures.
 * Browser/HTTP/database evidence is produced separately by leave-browser-regression.mjs. */
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
  }, Response, TextDecoder, AbortController, setTimeout, clearTimeout, ...globals }, { filename: path });
  return module.exports;
}
const helper = load('lib/leave-client-action.ts');
const input = { employmentId: 'e1', leaveTypeId: 'lt1', startsAt: '2029-05-01', endsAt: '2029-05-01', units: '0.10', reason: 'Draft reason' };
const create = { kind: 'create', input };
const cancel = { kind: 'cancel', employmentId: 'e1', requestId: 'r1' };
const saved = (changes = {}) => ({ data: { id: 'r1', employmentId: 'e1', leaveTypeId: 'lt1', startsAt: '2029-05-01T00:00:00.000Z', endsAt: '2029-05-01T00:00:00.000Z', units: '0.1', status: 'PENDING', ...changes } });
async function transport(response, action = create, extras = {}) {
  const calls = [];
  const result = await helper.submitLeaveAction(action, { ...extras, fetchImpl: async (...args) => {
    calls.push(args);
    return typeof response === 'function' ? response(...args) : response;
  }});
  return { result, calls };
}
for (const status of ['PENDING', 'APPROVED']) test(`201 receipt verifies created ${status} record and exact outgoing request`, async () => {
  const { result, calls } = await transport(Response.json(saved({ status }), { status: 201 }));
  assert.equal(result.outcome, 'saved'); assert.equal(result.id, 'r1'); assert.equal(result.status, status);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/leave/requests');
  const options = calls[0][1];
  assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
  assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  assert.deepEqual(JSON.parse(options.body), input); assert.ok(options.signal instanceof AbortSignal);
});
for (const [field, value] of [['id', ''], ['id', {}], ['id', ' r1'], ['employmentId', 'other'], ['leaveTypeId', 'other'], ['status', 'CANCELLED'], ['status', ['PENDING']], ['startsAt', '2029-05-02'], ['endsAt', 'invalid'], ['units', '0.11'], ['units', true], ['units', [0.1]]]) {
  test(`mismatched creation receipt is never success: ${field}=${JSON.stringify(value)}`, async () => {
    const { result } = await transport(Response.json(saved({ [field]: value }), { status: 201 }));
    assert.equal(result.outcome, 'unknown');
  });
}
for (const [label, response] of [
  ['HTML 200', () => new Response('<html>login private</html>', { headers: { 'content-type': 'text/html' } })],
  ['empty 200', () => new Response('')], ['invalid JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
  ['wrong 200 for creation', () => Response.json(saved())], ['202 is not completion', () => Response.json(saved(), { status: 202 })],
  ['null', () => Response.json(null, { status: 201 })], ['array', () => Response.json([saved()], { status: 201 })],
  ['missing data', () => Response.json({}, { status: 201 })], ['success with error', () => Response.json({ ...saved(), error: 'private' }, { status: 201 })],
  ['503', () => Response.json({ error: 'private SQL' }, { status: 503 })],
  ['oversized', () => Response.json({ extra: 'x'.repeat(65536), ...saved() }, { status: 201 })],
  ['bad UTF8', () => new Response(Uint8Array.from([0xc3, 0x28]), { status: 201, headers: { 'content-type': 'application/json' } })]
]) test(`${label} leaves outcome unknown and never retries`, async () => {
  const { result, calls } = await transport(response());
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
});
for (const status of [400, 401, 403, 404, 409, 422, 429]) test(`controlled JSON ${status} retains only bounded status metadata`, async () => {
  const { result } = await transport(Response.json({ error: 'private SQL token' }, { status }));
  assert.equal(result.outcome, 'rejected'); assert.equal(result.status, status);
  for (const locale of ['tr', 'en']) assert.ok(!helper.leaveActionMessage(result, locale).includes('private'));
});
for (const body of [{}, { error: 1 }, { error: '' }, { error: 'x'.repeat(2001) }, { error: 'conflict', ...saved() }]) {
  test(`malformed rejection cannot imply rollback: ${Object.keys(body).join(',')}`, async () => {
    const { result } = await transport(Response.json(body, { status: 409 })); assert.equal(result.outcome, 'unknown');
  });
}
test('cancel requires exact resource, employment and CANCELLED state', async () => {
  for (const changes of [{}, { id: 'other' }, { employmentId: 'other' }, { status: 'APPROVED' }]) {
    const { result, calls } = await transport(Response.json(saved({ status: 'CANCELLED', ...changes })), cancel);
    assert.equal(result.outcome, Object.keys(changes).length ? 'unknown' : 'saved');
    assert.equal(calls[0][0], '/api/leave/requests/r1/self-cancel'); assert.equal(calls[0][1].body, undefined);
  }
});
test('cancel identifiers are URL encoded and cannot create query/path fragments', async () => {
  const id = 'id/?# &ö';
  const { result, calls } = await transport(Response.json(saved({ status: 'CANCELLED', id })), { ...cancel, requestId: id });
  assert.equal(result.outcome, 'saved');
  assert.equal(calls[0][0], `/api/leave/requests/${encodeURIComponent(id)}/self-cancel`);
});
test('network failure is uncertain, sanitized and never replayed', async () => {
  const { result, calls } = await transport(() => { throw new Error('private token'); });
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
});
test('timeout cancels pending transport without retry', async () => {
  const { result, calls } = await transport((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }), create, { timeoutMs: 10 });
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1); assert.equal(calls[0][1].signal.aborted, true);
});
test('caller cancellation reaches transport and does not produce a success', async () => {
  const controller = new AbortController();
  const running = transport((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }), create, { signal: controller.signal });
  controller.abort(); const { result, calls } = await running;
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 1);
});
test('pre-aborted action sends nothing', async () => {
  const controller = new AbortController(); controller.abort();
  const { result, calls } = await transport(Response.json(saved(), { status: 201 }), create, { signal: controller.signal });
  assert.equal(result.outcome, 'unknown'); assert.equal(calls.length, 0);
});
for (const timeoutMs of [0, -1, NaN, 60001, 1.5]) test(`invalid timeout cannot start a request: ${timeoutMs}`, async () => {
  const { result, calls } = await transport(null, create, { timeoutMs });
  assert.equal(result.outcome, 'rejected'); assert.equal(calls.length, 0);
});

test('non-JSON body is cancelled instead of being left downloading', async () => {
  let cancelled = 0;
  const stream = new ReadableStream({ cancel() { cancelled++; } });
  const { result } = await transport(new Response(stream, { headers: { 'content-type': 'text/html' } }));
  assert.equal(result.outcome, 'unknown'); assert.equal(cancelled, 1);
});

const jsx = (type, props, key) => ({ type, props: props || {}, key });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function componentFixture({ locale = 'en', refreshThrows = false, confirms = true, rowStatus = 'APPROVED' } = {}) {
  let index = 0, refreshes = 0, resets = 0, reloads = 0, cleanup;
  const hooks = [], effects = [], calls = [];
  const data = { leaveTypes: [{ id: 'lt1', code: 'QA', name: 'QA leave', requiresApproval: true }], balances: [], requests: [{ id: 'r1', leaveType: 'QA leave', startsAt: input.startsAt, endsAt: input.endsAt, units: '0.1', unit: 'DAYS', status: rowStatus }] };
  const form = { fields: { ...input }, isConnected: true, reset() { resets++; this.fields = {}; } };
  const component = load('components/leave-participant-console.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: {
      useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
      useRef(initial) { const i = index++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
      useEffect(effect) { const i = index++; if (!(i in hooks)) { hooks[i] = true; effects.push(effect); } }
    },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; if (refreshThrows) throw new Error('refresh unavailable'); } }) },
    'lucide-react': new Proxy({}, { get: (_target, key) => String(key) }),
    '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/lib/leave-client-action': { leaveActionMessage: helper.leaveActionMessage,
      submitLeaveAction(action, options) { return new Promise(resolve => calls.push({ action, options, resolve })); } }
  }, { window: { location: { reload() { reloads++; } }, confirm: () => confirms },
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fields[name] ?? null; } } });
  const wrapper = component.LeaveParticipantConsole({ employmentId: 'e1', data });
  function render() { index = 0; const tree = wrapper.type(wrapper.props); for (const effect of effects.splice(0)) cleanup = effect(); return tree; }
  return { wrapper, calls, form, render, dispose() { form.isConnected = false; cleanup(); },
    submit(tree = render()) { nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: form }); },
    async settle(result) { calls.at(-1).resolve(result); await tick(); await tick(); },
    get refreshes() { return refreshes; }, get resets() { return resets; }, get reloads() { return reloads; } };
}
for (const locale of ['tr', 'en']) {
  test(`${locale} duplicate same-turn submits send once and lock all draft fields`, async () => {
    const f = componentFixture({ locale }); const tree = f.render(); f.submit(tree); f.submit(tree);
    assert.equal(f.calls.length, 1);
    assert.ok(nodes(f.render()).filter(n => ['input', 'select', 'textarea', 'button'].includes(n.type)).every(n => n.props.disabled));
    assert.equal(f.form.fields.reason, input.reason);
    await f.settle({ outcome: 'saved', id: 'r2', status: 'PENDING' });
    assert.equal(f.resets, 1); assert.equal(f.refreshes, 1);
    assert.ok(nodes(f.render()).some(n => n.props['data-leave-result'] === 'saved' && n.props.role === 'status'));
  });
  test(`${locale} controlled rejection preserves draft and permits explicit corrected submission`, async () => {
    const f = componentFixture({ locale }); f.submit(); await f.settle({ outcome: 'rejected', status: 409 });
    assert.equal(f.resets, 0); assert.equal(f.refreshes, 0); assert.equal(f.form.fields.reason, input.reason);
    assert.ok(nodes(f.render()).filter(n => ['input', 'select', 'textarea'].includes(n.type)).every(n => !n.props.disabled));
    f.submit(); assert.equal(f.calls.length, 2); await f.settle({ outcome: 'rejected', status: 400 });
  });
  test(`${locale} unknown result preserves input, blocks writes and offers only explicit reload`, async () => {
    const f = componentFixture({ locale }); f.submit(); await f.settle({ outcome: 'unknown' });
    assert.equal(f.resets, 0); assert.equal(f.refreshes, 0); assert.equal(f.form.fields.reason, input.reason);
    const tree = f.render(); f.submit(tree); assert.equal(f.calls.length, 1);
    const recovery = nodes(tree).find(n => n.props['data-leave-recovery']);
    const button = nodes(recovery).find(n => n.type === 'button');
    assert.ok(nodes(tree).some(n => n.props['data-leave-result'] === 'unknown' && n.props.role === 'alert'));
    assert.match(text(tree), locale === 'tr' ? /kaydedilmiş olabilir/ : /may have been saved/);
    button.props.onClick(); button.props.onClick(); assert.equal(f.reloads, 1); assert.equal(f.calls.length, 1);
  });
}
test('refresh failure never changes a confirmed save into an unknown write', async () => {
  const f = componentFixture({ refreshThrows: true }); f.submit(); await f.settle({ outcome: 'saved', id: 'r2', status: 'PENDING' });
  assert.equal(f.resets, 1); assert.equal(f.refreshes, 1);
  const tree = f.render(); assert.ok(nodes(tree).some(n => n.props['data-leave-result'] === 'saved'));
  assert.ok(nodes(tree).some(n => n.props['data-leave-recovery']));
});
test('unmount aborts the operation and ignores its later result/form reset', async () => {
  const f = componentFixture(); f.submit(); f.dispose(); assert.equal(f.calls[0].options.signal.aborted, true);
  await f.settle({ outcome: 'saved', id: 'r2', status: 'PENDING' }); assert.equal(f.resets, 0); assert.equal(f.refreshes, 0);
});
test('employment changes use a new component identity', () => {
  const f = componentFixture(); assert.equal(f.wrapper.key, 'e1');
});
test('cancellation requires confirmation and repeated clicks cannot submit twice', async () => {
  const denied = componentFixture({ confirms: false });
  nodes(denied.render()).find(n => n.type === 'button' && text(n) === 'Cancel').props.onClick();
  assert.equal(denied.calls.length, 0);
  const f = componentFixture(); const button = nodes(f.render()).find(n => n.type === 'button' && text(n) === 'Cancel');
  button.props.onClick(); button.props.onClick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action.requestId, 'r1');
  await f.settle({ outcome: 'saved', id: 'r1', status: 'CANCELLED' });
  assert.ok(!nodes(f.render()).some(n => n.type === 'button' && text(n) === 'Cancel'));
});
test('new browser stage is mandatory without disturbing the existing module/core/final block', () => {
  const workflow = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.match(workflow, /scripts\/leave-client-action\.test\.mjs/);
  assert.match(workflow, /node scripts\/leave-api-regression\.mjs\s*node scripts\/leave-browser-regression\.mjs\s*node scripts\/module-workspace-browser-regression\.mjs\s*node scripts\/core-workspace-browser-regression\.mjs\s*node scripts\/platform-remediation-gate\.mjs/);
  const browser = readFileSync('scripts/leave-browser-regression.mjs', 'utf8');
  for (const token of ['HRBP_DISPOSABLE_AUDIT', '/hrbp_audit', 'http://localhost:3100', 'db.leaveRequest', 'db.auditEvent', 'route.fetch', 'route.abort']) assert.ok(browser.includes(token));
});

for (const [locale, expectedLabel] of [['en', 'Cancelled'], ['tr', 'İptal']]) {
  test(`${locale} cancelled row exposes its exact localized status, not an ASCII case-fold assumption`, () => {
    const f = componentFixture({ locale, rowStatus: 'CANCELLED' });
    const row = nodes(f.render()).find(n => n.props['data-leave-request-id'] === 'r1');
    const status = nodes(row).find(n => n.type === 'em');
    assert.equal(status.props.className, 'growth-pill cancelled');
    assert.equal(text(status), expectedLabel);
    assert.ok(!nodes(row).some(n => n.type === 'button'));
    if (locale === 'tr') assert.equal(/cancelled|iptal/i.test(text(status)), false,
      'The old ASCII-insensitive browser matcher could not recognize the actual Turkish status.');
    const browser = readFileSync('scripts/leave-browser-regression.mjs', 'utf8');
    assert.ok(browser.includes("querySelector('em.growth-pill.cancelled')"));
    assert.ok(browser.includes('status?.textContent?.trim() === expectedLabel'));
  });
}
