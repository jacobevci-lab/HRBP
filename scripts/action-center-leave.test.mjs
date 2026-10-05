/** Production adapter, row component and Action Center with instrumented React/transport.
 * Real Chromium/PostgreSQL coverage lives in leave-decision-browser-regression.mjs. */
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
    throw new Error(`Unexpected import ${name}`);
  }, AbortController, Event, ...globals }, { filename: path });
  return module.exports;
}
const adapter = load('lib/action-center-leave-control.ts');
const item = (changes = {}) => ({ id: 'leave:r1', kind: 'leave', title: 'QA leave', subtitle: 'QA report',
  module: 'leave', href: '/module/leave?request=r1', subjectType: 'Employment', subjectId: 'e1', status: 'PENDING',
  createdAt: '2026-01-01', dueAt: null, urgency: 'normal', action: { type: 'approve-leave', requestId: 'r1' },
  secondaryAction: { type: 'reject-leave', requestId: 'r1' }, ...changes });
const plain = value => JSON.parse(JSON.stringify(value));
for (const [name, changes, allowed] of [
  ['paired', {}, ['APPROVED', 'REJECTED']],
  ['approval only', { secondaryAction: null }, ['APPROVED']],
  ['rejection only', { action: null }, ['REJECTED']]
]) test(`adapter exposes only server-provided ${name}`, () => {
  assert.deepEqual(plain(adapter.actionCenterLeaveControl(item(changes))), { requestId: 'r1', allowedDecisions: allowed });
});
for (const [name, candidate] of [
  ['null', null], ['array', []], ['empty', {}], ['no actions', item({ action: null, secondaryAction: null })],
  ['mixed IDs', item({ secondaryAction: { type: 'reject-leave', requestId: 'r2' } })],
  ['wrong kind', item({ kind: 'payroll' })], ['foreign primary', item({ action: { type: 'approve-payroll', runId: 'r1' } })],
  ['foreign secondary', item({ secondaryAction: { type: 'reject-time', entryId: 'r1' } })],
  ['array primary', item({ action: [] })], ['numeric secondary', item({ secondaryAction: 3 })],
  ...['', ' r1', 'r1\n', 'a'.repeat(192), 12, ['r1'], {}].map(id => [`invalid id ${JSON.stringify(id)}`, item({ action: { type: 'approve-leave', requestId: id }, secondaryAction: null })])
]) test(`adapter fails closed: ${name}`, () => assert.equal(adapter.actionCenterLeaveControl(candidate), null));
for (const candidate of [item(), item({ kind: 'payroll' }), item({ kind: 'time-attendance', action: null }), item({ action: null, secondaryAction: null })]) {
  test(`leave metadata cannot fall through to generic writes: ${JSON.stringify(candidate.action)}/${candidate.kind}`, () => assert.equal(adapter.isActionCenterLeaveItem(candidate), true));
}
test('ordinary non-leave metadata retains the generic path', () => {
  assert.equal(adapter.isActionCenterLeaveItem(item({ kind: 'workflow', action: { type: 'complete-workflow' }, secondaryAction: null })), false);
});
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const descend = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(descend) : [node, ...descend(node.props?.children)];
function rowHarness({ registry = new Map(), requestId = 'r1', allowedDecisions, disabled = false, locale = 'en', confirm = true, submit = async () => ({ outcome: 'unknown' }) } = {}) {
  const state = [], refs = [], cleanups = [], calls = [], acks = [], events = [];
  let si = 0, ri = 0, initial = true, tree, reloads = 0;
  const mod = load('components/leave-decision-buttons.tsx', {
    react: {
      useState(value) { const i = si++; if (initial) state[i] = typeof value === 'function' ? value() : value; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef(value) { const i = ri++; if (initial) refs[i] = { current: value }; return refs[i]; },
      useEffect(fn) { if (initial) cleanups.push(fn()); }
    }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/navigation': { useRouter: () => ({ refresh() {} }) },
    'lucide-react': { Check: 'check', X: 'x' }, '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/lib/leave-client-action': {
      async submitLeaveAction(...args) { calls.push(args); return submit(...args); },
      async acknowledgeLeaveNotification(id) { acks.push(id); return true; }
    }
  }, { window: { confirm: () => confirm, dispatchEvent(e) { events.push(e.type); }, location: { reload() { reloads++; } } } });
  const wrapper = mod.LeaveDecisionButtons({ requestId, allowedDecisions, attemptRegistry: registry, disabled });
  const render = () => { si = ri = 0; tree = wrapper.type(wrapper.props); initial = false; return tree; };
  const nodes = () => descend(tree);
  render();
  return { render, nodes, calls, acks, events, registry, props: wrapper.props,
    button: decision => nodes().find(n => n.props['data-decision'] === decision),
    result: () => nodes().find(n => n.props['data-leave-decision-result'])?.props['data-leave-decision-result'],
    async flush() { await tick(); render(); }, unmount() { cleanups.forEach(fn => fn?.()); }, get reloads() { return reloads; }
  };
}
for (const locale of ['en', 'tr']) {
  for (const outcome of [{ outcome: 'unknown' }, { outcome: 'rejected', status: 409 }, { outcome: 'saved', id: 'r1', status: 'APPROVED' }]) {
    test(`${locale} ${outcome.outcome} survives filter unmount/remount without another decision`, async () => {
      const registry = new Map(), h = rowHarness({ locale, registry, submit: async () => outcome });
      h.button('APPROVED').props.onClick(); await h.flush(); h.unmount();
      const returned = rowHarness({ locale, registry });
      assert.equal(returned.result(), outcome.outcome); assert.equal(returned.button('APPROVED'), undefined);
      assert.equal(returned.button('REJECTED'), undefined); assert.equal(returned.calls.length, 0);
      assert.equal(h.calls.length, 1);
    });
  }
  test(`${locale} pending row is sealed before request; hiding it aborts without unlocking`, async () => {
    let resolve; const registry = new Map(), h = rowHarness({ locale, registry, submit: () => new Promise(r => { resolve = r; }) });
    const approve = h.button('APPROVED'), reject = h.button('REJECTED');
    approve.props.onClick(); reject.props.onClick();
    assert.equal(h.calls.length, 1); assert.equal(registry.get('r1').outcome, 'unknown');
    h.unmount(); assert.equal(h.calls[0][1].signal.aborted, true);
    const returned = rowHarness({ locale, registry }); assert.equal(returned.result(), 'unknown');
    resolve({ outcome: 'saved', id: 'r1', status: 'APPROVED' }); await h.flush();
    assert.equal(h.acks.length, 0); assert.equal(h.events.length, 0); assert.equal(registry.get('r1').outcome, 'unknown');
  });
  test(`${locale} dismissing confirmation does not seal or submit`, () => {
    const h = rowHarness({ locale, confirm: false }); h.button('APPROVED').props.onClick();
    assert.equal(h.calls.length, 0); assert.equal(h.registry.size, 0);
  });
}
for (const decision of ['APPROVED', 'REJECTED']) test(`a ${decision}-only row never invents opposite authority`, async () => {
  const h = rowHarness({ allowedDecisions: [decision] });
  assert.ok(h.button(decision)); assert.equal(h.button(decision === 'APPROVED' ? 'REJECTED' : 'APPROVED'), undefined);
  h.button(decision).props.onClick(); await h.flush(); assert.equal(h.calls[0][0].decision, decision);
});
test('loading or failed queue can disable a row even against direct event invocation', () => {
  const h = rowHarness({ disabled: true });
  assert.ok(h.button('APPROVED').props.disabled); h.button('APPROVED').props.onClick();
  assert.equal(h.calls.length, 0); assert.equal(h.registry.size, 0);
});
test('registry protects a duplicate representation of the same resource', async () => {
  const registry = new Map(), a = rowHarness({ registry }), b = rowHarness({ registry });
  a.button('APPROVED').props.onClick(); b.button('REJECTED').props.onClick();
  await a.flush(); assert.equal(a.calls.length, 1); assert.equal(b.calls.length, 0);
});
test('another request does not inherit the first request lock', () => {
  const registry = new Map([['r1', { outcome: 'unknown' }]]), h = rowHarness({ registry, requestId: 'r2' });
  assert.ok(h.button('APPROVED')); h.button('APPROVED').props.onClick(); assert.equal(h.calls.length, 1);
});
test('explicit reload cannot replay a decision and is click-locked', () => {
  const registry = new Map([['r1', { outcome: 'unknown' }]]), h = rowHarness({ registry });
  const reload = h.nodes().find(n => Object.hasOwn(n.props, 'data-leave-decision-reload'));
  reload.props.onClick(); reload.props.onClick(); assert.equal(h.reloads, 1); assert.equal(h.calls.length, 0);
});
function centerHarness(rows, { loading = false, error = null, busy = null } = {}) {
  const values = [], refs = []; let si = 0, ri = 0, initial = true;
  const icons = Object.fromEntries(['AlertTriangle','BadgeDollarSign','BookOpenCheck','BriefcaseBusiness','CalendarCheck2','CheckCircle2','ClipboardCheck','Clock3','ExternalLink','FileClock','HeartHandshake','ReceiptText','RefreshCw','Search','ShieldAlert','SlidersHorizontal','Target','TimerReset','UserMinus','UserPlus','UsersRound','Workflow'].map(name => [name, name]));
  const mod = load('components/workflow-action-center.tsx', {
    'next/link': { default: 'link' }, 'lucide-react': icons, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/locale-provider': { useLocale: () => ({ locale: 'en' }) },
    '@/components/leave-decision-buttons': { LeaveDecisionButtons: 'LEAVE_CONTROL' },
    '@/lib/action-center-leave-control': adapter,
    '@/lib/action-center-queue': load('lib/action-center-queue.ts'),
    react: {
      useState(value) { const i = si++; if (initial) values[i] = typeof value === 'function' ? value() : value; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
      useRef(value) { const i = ri++; if (initial) refs[i] = { current: value }; return refs[i]; },
      useEffect() {}, useCallback(fn) { return fn; }, useMemo(fn) { return fn(); }
    }
  });
  const render = () => { si = ri = 0; const tree = mod.WorkflowActionCenter({}); initial = false; return tree; };
  render(); values[0] = rows; values[5] = loading; values[6] = busy; values[7] = error;
  return { render, values, nodes: () => descend(render()) };
}
for (const changes of [{}, { secondaryAction: null }, { action: null }]) test('Action Center actually delegates the displayed leave row with a page-owned registry', () => {
  const h = centerHarness([item(changes)]), one = h.nodes().find(n => n.type === 'LEAVE_CONTROL');
  assert.ok(one); assert.equal(one.props.requestId, 'r1'); assert.deepEqual(plain(one.props.allowedDecisions), plain(adapter.actionCenterLeaveControl(item(changes)).allowedDecisions));
  const registry = one.props.attemptRegistry; assert.equal(typeof registry.set, 'function');
  h.values[0] = []; assert.equal(h.nodes().filter(n => n.type === 'LEAVE_CONTROL').length, 0);
  h.values[0] = [item(changes)]; assert.equal(h.nodes().find(n => n.type === 'LEAVE_CONTROL').props.attemptRegistry, registry);
});
for (const options of [{ loading: true }, { error: 'load failed' }, { busy: 'other' }]) test(`Action Center passes unavailability into leave controls: ${JSON.stringify(options)}`, () => {
  assert.equal(centerHarness([item()], options).nodes().find(n => n.type === 'LEAVE_CONTROL').props.disabled, true);
});
test('mismatched leave actions have navigation only, never generic mutation buttons', () => {
  const h = centerHarness([item({ secondaryAction: { type: 'reject-leave', requestId: 'r2' } })]);
  assert.equal(h.nodes().filter(n => n.type === 'LEAVE_CONTROL').length, 0);
  const row = h.nodes().find(n => n.type === 'tr' && n.props.id === 'action-item-leave:r1');
  assert.equal(descend(row).filter(n => n.type === 'button').length, 0);
});
test('generic handlers cannot issue a leave decision outside the checked component', () => {
  const source = readFileSync('components/workflow-action-center.tsx', 'utf8');
  assert.ok(!source.includes('/api/leave/requests/'));
  for (const name of ['executeQuickAction', 'executeSecondaryAction']) {
    const fn = source.slice(source.indexOf(`async function ${name}`));
    assert.match(fn.slice(0, fn.indexOf('const copy')), /isActionCenterLeaveItem\(item\)/);
  }
});
test('mandatory validation and browser stages preserve earlier suites', () => {
  const workflow = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.match(workflow, /scripts\/action-center-leave\.test\.mjs/);
  assert.match(workflow, /HRBP_LEAVE_DECISION_SURFACE=action-center node scripts\/leave-decision-browser-regression\.mjs/);
  assert.match(workflow, /node scripts\/leave-api-regression\.mjs\s+node scripts\/leave-browser-regression\.mjs\s+node scripts\/module-workspace-browser-regression\.mjs\s+node scripts\/core-workspace-browser-regression\.mjs\s+node scripts\/platform-remediation-gate\.mjs/);
});