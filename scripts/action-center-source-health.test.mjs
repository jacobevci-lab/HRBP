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
const keys = ['growthDegraded','employeeLifecycleDegraded','documentSignatureDegraded','recruitingDegraded','policyDegraded','workforcePlanningDegraded','privacyDegraded','engagementDegraded','workflowDefinitionDegraded'];
const summaryKeys = ['total','overdue','dueSoon','critical','workflow','hrService','employeeRelations','documents','onboarding','offboarding','leave','timeAttendance','compensation','payroll','benefits','performance','learning','developmentPlans','succession','recruiting','policies','workforcePlanning','privacy','engagement'];
const healthy = () => Object.fromEntries(keys.map(k => [k, false]));
const stamp = '2026-10-05T12:00:00.000Z';
const row = { id: 'time:health-qa', kind: 'time-attendance', title: 'QA time', subtitle: 'Test only', module: 'time-attendance', href: '/module/time-attendance', subjectType: 'Employment', subjectId: 'qa-employee', status: 'SUBMITTED', createdAt: stamp, dueAt: null, urgency: 'normal', action: { type: 'approve-time', entryId: 'health-qa' }, secondaryAction: { type: 'reject-time', entryId: 'health-qa' } };
const envelope = (flags = healthy(), items = [row]) => ({ data: { items, summary: Object.fromEntries(summaryKeys.map(k => [k, k === 'total' ? items.length : 0])), generatedAt: stamp, ...flags } });
const plain = v => JSON.parse(JSON.stringify(v));

test('known registry matches each flag propagated by current server aggregator', () => {
  assert.deepEqual(Object.keys(queue.actionQueueSourceLabels), keys);
  const source = readFileSync('lib/workflow-definition-action-continuity.ts', 'utf8');
  const returned = source.slice(source.lastIndexOf('return {'));
  const names = [...new Set(returned.match(/\b\w+Degraded\b/g))].sort();
  assert.deepEqual(names, [...keys].sort());
});
test('all explicitly false flags report no source failure without claiming full domain completeness', () => {
  const h = queue.actionQueueSourceHealth(healthy());
  assert.deepEqual(plain(h), { state: 'reported', failed: [], unknown: [] });
  assert.equal(queue.sourceHealthMessage(h, 'en'), '');
});
for (const key of keys) {
  test(`${key}: an actual failure survives decoding and is named in both locales`, () => {
    const e = envelope({ ...healthy(), [key]: true });
    const data = queue.decodeActionQueue(e); assert.ok(data);
    const h = queue.actionQueueSourceHealth(data);
    assert.deepEqual(plain(h), { state: 'partial', failed: [key], unknown: [] });
    for (const locale of ['en','tr']) assert.ok(queue.sourceHealthMessage(h, locale).includes(queue.actionQueueSourceLabels[key][locale]));
    assert.equal(data.items[0], row);
  });
  test(`${key}: missing is unknown, not false`, () => {
    const e = envelope(); delete e.data[key];
    assert.ok(queue.decodeActionQueue(e));
    assert.deepEqual(plain(queue.actionQueueSourceHealth(e.data)), { state: 'unknown', failed: [], unknown: [key] });
  });
  for (const value of ['false', 0, null, {}, []]) test(`${key}: wrong type ${JSON.stringify(value)} rejects the whole response`, () => {
    assert.equal(queue.decodeActionQueue(envelope({ ...healthy(), [key]: value })), null);
  });
}
test('legacy payload is still decodable but does not receive a healthy label', () => {
  const e = envelope({}); assert.ok(queue.decodeActionQueue(e));
  assert.deepEqual(plain(queue.actionQueueSourceHealth(e.data)), { state: 'unknown', failed: [], unknown: keys });
});
test('all failures and partially missing metadata use fixed labels, not server error text', () => {
  const flags = Object.fromEntries(keys.map(k => [k, true]));
  const h = queue.actionQueueSourceHealth({ ...flags, rawError: 'PRIVATE_ERROR' });
  assert.equal(h.failed.length, 9);
  for (const locale of ['en','tr']) assert.ok(!queue.sourceHealthMessage(h, locale).includes('PRIVATE_ERROR'));
  delete flags.policyDegraded;
  const mixed = queue.actionQueueSourceHealth(flags);
  assert.equal(mixed.state, 'partial'); assert.deepEqual(plain(mixed.unknown), ['policyDegraded']);
});
test('valid partial empty response stays a partial snapshot', () => {
  const e = envelope({ ...healthy(), privacyDegraded: true }, []);
  const data = queue.decodeActionQueue(e); assert.ok(data); assert.equal(data.items.length, 0);
  assert.equal(queue.actionQueueSourceHealth(data).state, 'partial');
});

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
    '@/components/compensation-action-center-buttons': { CompensationActionCenterButtons: 'COMP_CONTROL' },
    '@/components/payroll-action-center-button': { PayrollActionCenterButton: 'PAY_CONTROL' },
    '@/lib/action-center-time-control': {
      actionCenterTimeControl: (item) => item?.kind === 'time-attendance' ? {
        entryId: item.action?.entryId ?? item.secondaryAction?.entryId,
        allowedDecisions: [item.action?.type === 'approve-time' ? 'APPROVED' : null, item.secondaryAction?.type === 'reject-time' ? 'REJECTED' : null].filter(Boolean)
      } : null,
      isActionCenterTimeItem: (item) => item?.kind === 'time-attendance' || item?.action?.type === 'approve-time' || item?.secondaryAction?.type === 'reject-time'
    },
    '@/lib/action-center-compensation-control': { actionCenterCompensationControl: () => null, isActionCenterCompensationItem: () => false },
    '@/lib/action-center-payroll-control': { actionCenterPayrollControl: () => null, isActionCenterPayrollItem: () => false },
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
for (const locale of ['en','tr']) {
  test(`${locale}: partial queue names source, hides totals and keeps verified record actions available`, async () => {
    const h = harness(async () => Response.json(envelope({ ...healthy(), recruitingDegraded: true })), locale); await h.flush();
    assert.equal(h.nodes()[0].props['data-queue-state'], 'ready');
    const banner = h.nodes().find(n => n.props['data-queue-source-health']);
    assert.equal(banner.props['data-queue-source-health'], 'partial');
    assert.ok(JSON.stringify(banner).includes(queue.actionQueueSourceLabels.recruitingDegraded[locale]));
    const metrics = h.nodes().find(n => n.props.className === 'workflow-action-metrics');
    assert.ok(descend(metrics).filter(n => n.type === 'strong').every(n => n.props.children === '—'));
    assert.equal(h.nodes().find(n => n.type === 'TIME_CONTROL').props.disabled, false);
    h.unmount();
  });
  for (const flags of [{ ...healthy(), engagementDegraded: true }, {}]) test(`${locale}: incomplete empty view never claims no pending work (${Object.keys(flags).length} flags)`, async () => {
    const h = harness(async () => Response.json(envelope(flags, [])), locale); await h.flush();
    const output = JSON.stringify(h.nodes());
    assert.ok(!output.includes('No pending actions in this view.')); assert.ok(!output.includes('Bu görünümde bekleyen aksiyon yok.'));
    assert.ok(h.nodes().some(n => n.props['data-queue-incomplete-empty'])); h.unmount();
  });
  test(`${locale}: recovery clears warning, restores counts and retains local filters without writes`, async () => {
    let n = 0, writes = 0;
    const h = harness(async (_u, init) => { if (init.method !== 'GET') writes++; return Response.json(envelope(++n === 1 ? { ...healthy(), growthDegraded: true } : healthy())); }, locale);
    await h.flush(); h.values[3] = 'QA'; h.values[4] = true;
    h.refresh(); await h.flush();
    assert.equal(h.nodes()[0].props['data-source-state'], 'reported');
    assert.equal(h.nodes().some(n => n.props['data-queue-source-health']), false);
    assert.equal(h.values[3], 'QA'); assert.equal(h.values[4], true); assert.equal(writes, 0); h.unmount();
  });
}
test('transport failure does not label old source metadata current', async () => {
  let n = 0; const h = harness(async () => ++n === 1 ? Response.json(envelope()) : new Response('fail', { status: 503 }));
  await h.flush(); h.refresh(); await h.flush();
  assert.equal(h.nodes()[0].props['data-source-state'], 'unverified'); h.unmount();
});
test('mandatory regression workflow includes source-health checks and earlier suites', () => {
  const workflow = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.ok(workflow.includes('scripts/action-center-source-health.test.mjs'));
  assert.ok(workflow.includes('node scripts/action-center-source-health-browser.mjs'));
  assert.ok(workflow.includes('scripts/action-center-queue.test.mjs'));
  assert.ok(workflow.includes('node scripts/leave-api-regression.mjs'));
  assert.ok(workflow.includes('node scripts/platform-remediation-gate.mjs'));
});
