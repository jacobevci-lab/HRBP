import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name];
  });
  return module.exports;
}
function nodes(n) {
  if (Array.isArray(n)) return n.flatMap(nodes);
  if (!n || typeof n !== 'object') return [];
  return [n, ...nodes(n.props?.children)];
}
function text(n) {
  if (Array.isArray(n)) return n.map(text).join('');
  if (n == null || typeof n === 'boolean') return '';
  return typeof n === 'object' ? text(n.props?.children) : String(n);
}
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const reviewReceipt = (status = 'APPROVED', id = 'policy-a') => response(200, { data: { id, status } });
const ackReceipt = () => response(201, { data: { id: 'ack-a', policyId: 'policy-a', policyVersion: '1.0', acknowledgedAt: '2026-10-15T00:00:00.000Z' } });

/** Small executable component double; real React/SQL/browser behavior is
 * covered separately in the disposable UI workflow, not inferred here. */
function harness(kind = 'review', language = 'en', initial = {}) {
  let props = kind === 'review' ? { policyId: 'policy-a', status: 'REVIEW', ownerId: 'owner-a', actorId: 'reviewer-a', canWrite: true, canApprove: true, ...initial }
    : { policyId: 'policy-a', status: 'Pending', ...initial };
  const slots = []; let cursor = 0, effects = [], tree;
  let reply = async () => kind === 'review' ? reviewReceipt() : ackReceipt(), confirm = true, refreshThrows = false;
  const calls = { fetch: [], confirm: [], events: [], refresh: 0, reload: 0 };
  const saved = { fetch: globalThis.fetch, window: globalThis.window };
  globalThis.fetch = async (url, init) => { calls.fetch.push({ url, ...init }); return reply(url, init); };
  globalThis.window = { confirm: value => { calls.confirm.push(value); return confirm; },
    dispatchEvent: event => { calls.events.push(event.type); }, location: { reload: () => calls.reload++ } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
        slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    }
  };
  const jsx = (type, props) => ({ type, props });
  const common = { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_, k) => String(k) }),
    'next/navigation': { useRouter: () => ({ refresh: () => { calls.refresh++; if (refreshThrows) throw Error('private-refresh-detail'); } }) },
    '@/components/locale-provider': { useLocale: () => ({ locale: language }) } };
  // Load shared production hook lazily: the baseline components have no hook
  // and still run the exact same assertions, proving red before the fix.
  const mocks = new Proxy(common, {
    has: (target, name) => name === '@/components/policy-action-state' || name in target,
    get: (target, name) => name === '@/components/policy-action-state' ? compile('components/policy-action-state.ts', common) : target[name]
  });
  const file = kind === 'review' ? 'policy-review-actions' : 'policy-acknowledgement-action';
  const exported = compile(`components/${file}.tsx`, mocks);
  const component = kind === 'review' ? exported.PolicyReviewActions : exported.PolicyAcknowledgementAction;
  function render() { cursor = 0; tree = component(props); const pending = effects; effects = []; pending.forEach(f => f()); return tree; }
  async function settle() { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); render(); } }
  function button(label) { const n = nodes(tree).find(n => n.type === 'button' && text(n).trim() === label); assert.ok(n, `Missing button: ${label}\n${text(tree)}`); return n; }
  render();
  return { calls, button, render, settle, get text() { return text(tree); }, get tree() { return tree; },
    reply: fn => { reply = fn; }, confirm: value => { confirm = value; }, failRefresh: () => { refreshThrows = true; },
    props: value => { props = { ...props, ...value }; render(); }, language: value => { language = value; render(); },
    async click(label) { button(label).props.onClick(); render(); await settle(); },
    close() { for (const s of slots) s?.cleanup?.(); globalThis.fetch = saved.fetch; globalThis.window = saved.window; }
  };
}

test('review: cancellation sends no approval request', async () => {
  const h = harness(); try { h.confirm(false); await h.click('Approve'); assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.confirm.length, 1); }
  finally { h.close(); }
});
test('review: same-turn duplicate clicks issue one request', async () => {
  const h = harness(); let finish;
  try { h.reply(() => new Promise(r => { finish = r; })); const click = h.button('Approve').props.onClick; click(); click(); h.render();
    assert.equal(h.calls.fetch.length, 1); finish(reviewReceipt()); await h.settle(); }
  finally { if (finish) finish(reviewReceipt()); h.close(); }
});
test('review: another policy receipt cannot produce success or allow replay', async () => {
  const h = harness(); try { h.reply(async () => reviewReceipt('APPROVED', 'wrong-policy')); await h.click('Approve');
    assert.equal(h.calls.refresh, 0); assert.equal(h.calls.events.length, 0); assert.equal(h.button('Approve').props.disabled, true);
    await h.click('Approve'); assert.equal(h.calls.fetch.length, 1); }
  finally { h.close(); }
});
test('acknowledgement: waiver is not displayed as an acknowledgement', () => {
  const h = harness('ack', 'tr', { status: 'Waived' }); try { assert.match(h.text, /Muaf/); assert.doesNotMatch(h.text, /Onaylandı/); }
  finally { h.close(); }
});
test('acknowledgement: network failure blocks blind replay', async () => {
  const h = harness('ack'); try { h.reply(async () => { throw Error('private-network-detail'); }); await h.click('Acknowledge'); await h.click('Acknowledge');
    assert.equal(h.calls.fetch.length, 1); assert.equal(h.calls.refresh, 0); assert.doesNotMatch(h.text, /private-network/); }
  finally { h.close(); }
});

for (const [label, start, action, target, suffix] of [
  ['Submit', 'DRAFT', 'SUBMIT', 'REVIEW', 'review'], ['Approve', 'REVIEW', 'APPROVE', 'APPROVED', 'review'],
  ['Changes', 'APPROVED', 'REQUEST_CHANGES', 'DRAFT', 'review'], ['Publish', 'APPROVED', 'PUBLISH', 'PUBLISHED', 'publish']
]) {
  test(`review: ${action} confirms, validates its target receipt and stays locked until refreshed`, async () => {
    const h = harness('review', 'en', { status: start });
    try {
      h.reply(async () => reviewReceipt(target)); await h.click(label);
      assert.equal(h.calls.confirm.length, 1); assert.equal(h.calls.fetch.length, 1);
      const request = h.calls.fetch[0]; assert.equal(request.url, `/api/policies/policy-a/${suffix}`);
      assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
      if (action !== 'PUBLISH') assert.deepEqual(JSON.parse(request.body), { action });
      assert.deepEqual(h.calls.events, ['hrbp:lifecycle-actions-changed', 'hrbp:notifications-changed']);
      assert.equal(h.calls.refresh, 1); assert.match(h.text, /was saved/);
      await h.click(label); assert.equal(h.calls.fetch.length, 1);
      await h.click('Reload current record'); assert.equal(h.calls.reload, 1); assert.equal(h.calls.fetch.length, 1);
    } finally { h.close(); }
  });
}
for (const [name, reply] of [
  ['wrong target state', () => reviewReceipt('DRAFT')], ['array envelope', () => response(200, [])],
  ['missing receipt', () => response(200, {})], ['invalid JSON', () => ({ status: 200, json: async () => { throw Error('secret-html'); } })],
  ['unexpected 204', () => response(204, {})], ['upstream 503', () => response(503, { error: 'private-database' })],
  ['redirected response', () => ({ ...reviewReceipt(), redirected: true })]
]) {
  test(`review: ${name} is unknown, not a success or a retry signal`, async () => {
    const h = harness(); try { h.reply(async () => reply()); await h.click('Approve');
      assert.match(h.text, /could not be confirmed/); assert.doesNotMatch(h.text, /private|secret/);
      assert.equal(h.calls.events.length, 0); assert.equal(h.calls.refresh, 0);
      await h.click('Approve'); assert.equal(h.calls.fetch.length, 1);
    } finally { h.close(); }
  });
}
for (const [status, message] of [[400, 'not accepted'], [401, 'permissions'], [403, 'permissions'], [404, 'not found'], [409, 'state changed'], [429, 'not accepted']]) {
  test(`review: ${status} uses bounded feedback without a success event`, async () => {
    const h = harness(); try { h.reply(async () => response(status, { error: '<script>private payload</script>' })); await h.click('Approve');
      assert.ok(h.text.includes(message)); assert.doesNotMatch(h.text, /private|script/);
      assert.equal(h.calls.events.length, 0); await h.click('Approve'); assert.equal(h.calls.fetch.length, 1);
    } finally { h.close(); }
  });
}
test('review: saved receipt remains saved if router refresh fails', async () => {
  const h = harness(); try { h.failRefresh(); await h.click('Approve'); assert.match(h.text, /was saved/);
    await h.click('Approve'); assert.equal(h.calls.fetch.length, 1); assert.doesNotMatch(h.text, /private-refresh/);
  } finally { h.close(); }
});
test('review: independent approval and missing capability rules remain enforced', () => {
  for (const props of [{ ownerId: 'reviewer-a' }, { canApprove: false }, { status: 'PUBLISHED' }]) {
    const h = harness('review', 'en', props); try {
      assert.ok(!nodes(h.tree).some(n => n.type === 'button' && text(n).trim() === 'Approve'));
      assert.equal(h.calls.fetch.length, 0);
    } finally { h.close(); }
  }
});
test('review: a stale closure cannot submit after actor permissions change', async () => {
  const h = harness(); try { const stale = h.button('Approve').props.onClick; h.props({ canApprove: false }); stale(); await h.settle();
    assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.confirm.length, 0);
  } finally { h.close(); }
});
test('review: a late receipt must not refresh or signal success for a different record', async () => {
  const h = harness(); let finish;
  try { h.reply(() => new Promise(resolve => { finish = resolve; })); h.button('Approve').props.onClick(); h.render();
    h.props({ policyId: 'policy-b' }); await h.click('Approve'); assert.equal(h.calls.fetch.length, 1);
    finish(reviewReceipt()); await h.settle(); assert.equal(h.calls.refresh, 0); assert.equal(h.calls.events.length, 0);
    h.reply(async () => reviewReceipt('APPROVED', 'policy-b')); await h.click('Approve'); assert.equal(h.calls.fetch.length, 2);
    assert.equal(h.calls.refresh, 1);
  } finally { h.close(); }
});
test('review: cancellation unlocks without discarding permissions', async () => {
  const h = harness(); try { h.confirm(false); await h.click('Approve'); h.confirm(true); await h.click('Approve');
    assert.equal(h.calls.fetch.length, 1); assert.equal(h.calls.confirm.length, 2);
  } finally { h.close(); }
});
test('review: Turkish confirmation and runtime feedback follow locale without resubmission', async () => {
  const h = harness('review', 'tr'); try { h.reply(async () => response(503, {})); await h.click('Onayla');
    assert.match(h.calls.confirm[0], /onaylansın/); assert.match(h.text, /doğrulanamadı/);
    h.language('en'); assert.match(h.text, /could not be confirmed/); assert.equal(h.calls.fetch.length, 1);
  } finally { h.close(); }
});
for (const status of ['Waived', 'WAIVED', 'Acknowledged', 'ACKNOWLEDGED']) {
  test(`acknowledgement: ${status} is noninteractive and has the correct meaning`, () => {
    const h = harness('ack', 'en', { status }); try {
      assert.ok(h.text.includes(status.toUpperCase() === 'WAIVED' ? 'Waived' : 'Acknowledged'));
      assert.equal(nodes(h.tree).filter(n => n.type === 'button').length, 0); assert.equal(h.calls.fetch.length, 0);
    } finally { h.close(); }
  });
}
test('acknowledgement: confirmed matching receipt refreshes once and explicit cancel sends nothing', async () => {
  const h = harness('ack'); try { h.confirm(false); await h.click('Acknowledge'); assert.equal(h.calls.fetch.length, 0);
    h.confirm(true); await h.click('Acknowledge'); assert.equal(h.calls.refresh, 1); assert.equal(h.calls.events.length, 2);
    await h.click('Acknowledge'); assert.equal(h.calls.fetch.length, 1);
  } finally { h.close(); }
});
for (const [name, override] of [['wrong policy', { policyId: 'policy-b' }], ['missing version', { policyVersion: '' }],
  ['invalid time', { acknowledgedAt: 'not-a-date' }], ['missing identifier', { id: '' }]]) {
  test(`acknowledgement: ${name} cannot forge a confirmed acknowledgement`, async () => {
    const h = harness('ack'); try { h.reply(async () => { const value = await ackReceipt().json(); return response(201, { data: { ...value.data, ...override } }); });
      await h.click('Acknowledge'); assert.equal(h.calls.events.length, 0); assert.equal(h.calls.refresh, 0);
      assert.match(h.text, /could not be confirmed/); assert.equal(h.button('Acknowledge').props.disabled, true);
    } finally { h.close(); }
  });
}
test('acknowledgement: same-turn duplicate callbacks cannot write twice', async () => {
  const h = harness('ack'); let finish;
  try { h.reply(() => new Promise(resolve => { finish = resolve; })); const click = h.button('Acknowledge').props.onClick; click(); click();
    assert.equal(h.calls.fetch.length, 1); finish(ackReceipt()); await h.settle(); assert.equal(h.calls.refresh, 1);
  } finally { h.close(); }
});
