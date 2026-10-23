import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, name => { assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name]; });
  return module.exports;
}
const copy = compile('lib/engagement-authoring-copy.ts');
const unknown = 'The result could not be confirmed. Reload current records before trying another change.';
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text(node.props?.children);
}
const json = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
const audience = { relationshipScoped: true, orgUnits: [{ id: 'org-a', name: 'Synthetic Org' }], positions: [{ id: 'pos-a', positionCode: 'QA', title: 'Synthetic Seat', orgUnitId: 'org-a' }] };
const survey = () => ({ id: 'survey-a', code: 'QA', name: 'Customer-authored title', description: null, createdById: 'author-a', editable: true, campaignCount: 0, questions: [{ id: 'question-a', questionKey: 'Q1', prompt: 'Customer-authored question', type: 'SCALE', required: true, orderIndex: 1, options: [], dimension: null }] });

/** Deliberately small hook/component harness. Production React, layout and
 * database persistence are verified separately by the browser workflow. */
function harness(kind, locale = 'en', initialProps = {}) {
  const slots = []; let cursor = 0, effects = [], tree, props = { surveys: [survey()], canWrite: true, ...initialProps };
  const calls = { fetch: [], refresh: 0, confirms: [], reload: 0 };
  const savedFetch = globalThis.fetch, savedWindow = globalThis.window;
  let respond = async () => json(200, { data: audience }), confirm = true;
  globalThis.fetch = async (url, init = {}) => { calls.fetch.push({ url, ...init }); return respond(url, init); };
  globalThis.window = { confirm: message => { calls.confirms.push(message); return confirm; }, location: { reload: () => calls.reload++ }, dispatchEvent: () => {} };
  function state(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }
  const react = {
    useState: state,
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo: fn => { cursor++; return fn(); },
    useId: () => { const i = cursor++; return `test-${i}`; },
    useTransition: () => { cursor++; return [false, fn => fn()]; },
    useEffect: (fn, deps) => {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); }
    }
  };
  const jsx = (type, props) => ({ type, props });
  const modules = compile(`components/${kind === 'survey' ? 'engagement-survey-authoring' : 'engagement-campaign-create-form'}.tsx`, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'lucide-react': new Proxy({}, { get: (_, name) => String(name) }),
    'next/navigation': { useRouter: () => ({ refresh: () => calls.refresh++ }) },
    '@/components/locale-provider': { useLocale: () => ({ locale }) },
    '@/lib/engagement-authoring-copy': copy,
    '@/components/engagement-authoring.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) }
  });
  const component = kind === 'survey' ? modules.EngagementSurveyAuthoring : modules.EngagementCampaignCreateForm;
  function render() { cursor = 0; tree = component(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; }
  async function settle() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
  function button(name) { const result = nodes(tree).find(n => n.type === 'button' && text(n).trim() === name); assert.ok(result, `Button missing: ${name}\n${text(tree)}`); return result; }
  function input(label) { const n = nodes(tree).find(n => n.type === 'label' && text(n.props.children?.[0]) === label); assert.ok(n, `Label missing: ${label}`); return nodes(n).find(n => ['input', 'textarea', 'select'].includes(n.type)); }
  render();
  return { calls, render, settle, button, input, get tree() { return tree; }, get text() { return text(tree); },
    async click(name) { button(name).props.onClick(); render(); await settle(); },
    change(label, value) { input(label).props.onChange({ target: { value, checked: value } }); render(); },
    respond: fn => { respond = fn; }, confirm: value => { confirm = value; }, locale: value => { locale = value; render(); },
    props: value => { props = { ...props, ...value }; render(); },
    close() { for (const slot of slots) slot?.cleanup?.(); globalThis.fetch = savedFetch; globalThis.window = savedWindow; }
  };
}

for (const locale of ['en', 'tr']) test(`survey: ${locale} labels, edit form, confirmation and validation use selected locale`, async () => {
  const h = harness('survey', locale), c = key => copy.authoringText(locale, key);
  try {
    await h.click(c('Survey authoring'));
    for (const name of ['Create survey', 'Edit survey', 'Delete survey', 'Add question']) h.button(c(name));
    for (const name of ['Survey code', 'Survey name', 'Question key', 'Prompt']) h.input(c(name));
    assert.ok(h.text.includes('Customer-authored title')); assert.ok(h.text.includes('Customer-authored question'));
    await h.click(c('Create survey')); assert.ok(h.text.includes(c('Survey code and name are required.'))); assert.equal(h.calls.fetch.length, 0);
    await h.click(c('Edit survey')); h.input(c('Name')); h.button(c('Save survey'));
    h.confirm(false); await h.click(c('Delete survey')); assert.deepEqual(h.calls.confirms, [c('Delete this unused survey and its questions?')]); assert.equal(h.calls.fetch.length, 0);
    h.locale(locale === 'tr' ? 'en' : 'tr');
    assert.ok(h.text.includes(copy.authoringText(locale === 'tr' ? 'en' : 'tr', 'Survey code and name are required.')) === false, 'Beginning an edit clears old errors');
  } finally { h.close(); }
});

test('survey: changing locale preserves customer draft and translates existing validation', async () => {
  const h = harness('survey'); try {
    await h.click('Survey authoring'); h.change('Survey code', 'DRAFT'); await h.click('Create survey'); h.locale('tr');
    assert.equal(h.input('Anket kodu').props.value, 'DRAFT'); assert.ok(h.text.includes('Anket kodu ve adı zorunludur.'));
  } finally { h.close(); }
});

test('survey: creator/campaign locks and absent write capability never expose edit/delete actions', async () => {
  const h = harness('survey', 'tr', { surveys: [{ ...survey(), editable: false, campaignCount: 1 }] }); try {
    await h.click('Anket hazırlama'); assert.ok(h.text.includes('Anket kilitli'));
    assert.ok(!h.text.includes('Anketi sil')); assert.ok(!h.text.includes('Soru ekle'));
    h.props({ canWrite: false }); assert.equal(h.tree, null); assert.equal(h.calls.fetch.length, 0);
  } finally { h.close(); }
});

test('survey: unused survey delete matches receipt; cancellation sends nothing', async () => {
  const h = harness('survey'); try {
    await h.click('Survey authoring'); h.confirm(false); await h.click('Delete survey'); assert.equal(h.calls.fetch.length, 0);
    h.confirm(true); h.respond(async () => json(200, { data: { id: 'survey-a' } })); await h.click('Delete survey');
    assert.equal(h.calls.fetch[0].method, 'DELETE'); assert.equal(h.calls.fetch[0].url, '/api/engagement/surveys/survey-a'); assert.equal(h.calls.refresh, 1);
    assert.equal(h.input('Survey').props.value, '');
  } finally { h.close(); }
});

for (const mode of ['wrong-id', 'html', 'network']) test(`survey: ${mode} result preserves draft, blocks replay and offers only reload`, async () => {
  const h = harness('survey', 'tr'); try {
    await h.click('Anket hazırlama'); await h.click('Anketi düzenle'); h.change('Ad', 'Unsaved?');
    h.respond(async () => { if (mode === 'network') throw Error('private-network-detail'); if (mode === 'html') return { status: 200, json: async () => { throw Error('private-html'); } }; return json(200, { data: { id: 'wrong-survey' } }); });
    await h.click('Anketi kaydet'); assert.ok(h.text.includes(copy.authoringText('tr', unknown)));
    assert.equal(h.input('Ad').props.value, 'Unsaved?');
    await h.click('Anketi kaydet'); assert.equal(h.calls.fetch.length, 1); assert.equal(h.calls.refresh, 0);
    await h.click('Güncel kayıtları yeniden yükle'); assert.equal(h.calls.reload, 1);
    assert.doesNotMatch(h.text, /private-/);
  } finally { h.close(); }
});

test('survey: simultaneous same-turn submissions use one mutation gate', async () => {
  const h = harness('survey'); let complete;
  try {
    await h.click('Survey authoring'); h.change('Survey code', 'NEW'); h.change('Survey name', 'New title');
    h.respond(() => new Promise(resolve => { complete = resolve; }));
    const click = h.button('Create survey').props.onClick; click(); click(); h.render();
    assert.equal(h.calls.fetch.length, 1); assert.ok(nodes(h.tree).find(n => n.type === 'fieldset').props.disabled);
    complete(json(201, { data: { id: 'new-survey' } })); await h.settle(); assert.equal(h.calls.refresh, 1);
  } finally { h.close(); }
});

for (const locale of ['en', 'tr']) test(`campaign: ${locale} failed audience read stops, disables creation and retries only explicitly`, async () => {
  const h = harness('campaign', locale), c = k => copy.authoringText(locale, k);
  try {
    h.respond(async () => json(503, { error: 'sensitive database details' }));
    await h.click(c('New campaign')); assert.equal(h.calls.fetch.length, 1);
    assert.ok(h.text.includes(c('Audience options could not be loaded. Retry explicitly to continue.')));
    assert.ok(!h.text.includes('sensitive')); assert.equal(h.button(c('Create draft campaign')).props.disabled, true);
    await h.settle(); await h.settle(); assert.equal(h.calls.fetch.length, 1, 'Loading false must not start a retry loop');
    h.respond(async () => json(200, { data: audience })); await h.click(c('Retry audience loading'));
    assert.equal(h.calls.fetch.length, 2); assert.equal(h.button(c('Create draft campaign')).props.disabled, false);
    h.input(c('Campaign name')); h.input(c('Anonymity threshold'));
  } finally { h.close(); }
});

test('campaign: closing aborts audience load; a late reply cannot replace a newer request', async () => {
  const h = harness('campaign'); let late;
  try {
    h.respond(() => new Promise(resolve => { late = resolve; })); await h.click('New campaign');
    const signal = h.calls.fetch[0].signal; await h.click('Close campaign form'); assert.equal(signal.aborted, true);
    h.respond(async () => json(200, { data: audience })); await h.click('New campaign');
    late(json(200, { data: { ...audience, orgUnits: [{ id: 'old', name: 'STALE_DATA' }] } })); await h.settle();
    assert.ok(!h.text.includes('STALE_DATA')); assert.ok(h.text.includes('Synthetic Org'));
  } finally { h.close(); }
});

for (const bad of [null, {}, { ...audience, relationshipScoped: 'false' }, { ...audience, orgUnits: [null] }]) test(`campaign: malformed audience ${JSON.stringify(bad)} cannot enable submit`, async () => {
  const h = harness('campaign'); try {
    h.respond(async () => json(200, { data: bad })); await h.click('New campaign');
    assert.equal(h.button('Create draft campaign').props.disabled, true); assert.equal(h.calls.fetch.length, 1);
  } finally { h.close(); }
});

test('campaign: threshold and reversed dates reject locally before POST', async () => {
  const h = harness('campaign'); try {
    await h.click('New campaign'); h.change('Campaign name', 'Synthetic'); h.change('Anonymity threshold', '4'); await h.click('Create draft campaign');
    assert.ok(h.text.includes('Anonymity threshold must be an integer between 5 and 1000.')); assert.equal(h.calls.fetch.length, 1);
    h.change('Anonymity threshold', '7'); h.change('Opens at', '2027-05-02T10:00'); h.change('Closes at', '2027-05-01T10:00'); await h.click('Create draft campaign');
    assert.ok(h.text.includes('The campaign closing time must be after its opening time.')); assert.equal(h.calls.fetch.length, 1);
  } finally { h.close(); }
});

test('campaign: successful draft receipt closes form without changing write authority', async () => {
  const h = harness('campaign'); try {
    await h.click('New campaign'); h.change('Campaign name', 'Synthetic');
    h.respond(async () => json(201, { data: { id: 'draft-a', surveyId: 'survey-a', status: 'DRAFT' } })); await h.click('Create draft campaign');
    assert.equal(h.calls.fetch.at(-1).method, 'POST'); assert.equal(h.calls.refresh, 1); h.button('New campaign');
    h.props({ canWrite: false }); assert.equal(h.tree, null);
  } finally { h.close(); }
});

test('campaign: missing write authority does not load audience', async () => {
  const h = harness('campaign', 'en', { canWrite: false }); try { await h.settle(); assert.equal(h.tree, null); assert.equal(h.calls.fetch.length, 0); } finally { h.close(); }
});

test('translated error copy is allowlisted and responsive rules remain scoped', () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const key = copy.authoringError(status, 'Campaign could not be created.', 'DB secret=private');
    assert.notEqual(copy.authoringText('tr', key), key); assert.doesNotMatch(key, /secret/);
  }
  for (const path of ['components/engagement-survey-authoring.tsx', 'components/engagement-campaign-create-form.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /useLocale/); assert.match(source, /aria-expanded/); assert.match(source, /engagement-authoring\.module\.css/);
    for (const [, literal] of source.matchAll(/c\("([^"\n]+)"\)/g)) if (literal !== 'eNPS') assert.notEqual(copy.authoringText('tr', literal), literal, `Missing Turkish: ${literal}`);
  }
  const css = readFileSync('components/engagement-authoring.module.css', 'utf8');
  assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/); assert.match(css, /overflow-x: auto/);
});


test('dynamic select and textarea content cannot change the field accessible name', async () => {
  const h = harness('survey');
  try {
    await h.click('Survey authoring');
    assert.equal(h.input('Survey').props['aria-label'], 'Survey');
    assert.equal(h.input('Type').props['aria-label'], 'Type');
    await h.click('Edit');
    assert.equal(h.input('Prompt').props.value, 'Customer-authored question');
    assert.equal(h.input('Prompt').props['aria-label'], 'Prompt');
    h.locale('tr');
    assert.equal(h.input('Soru metni').props['aria-label'], 'Soru metni');
  } finally { h.close(); }
  const campaign = harness('campaign', 'tr');
  try { await campaign.click('Yeni kampanya'); assert.equal(campaign.input('Anket').props['aria-label'], 'Anket'); }
  finally { campaign.close(); }
});

test('narrow dashboard brief puts its action below the content without hiding overflow', () => {
  const css = readFileSync('components/dashboard-responsive.module.css', 'utf8');
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /grid-column: 1 \/ -1/);
  assert.doesNotMatch(css, /overflow:\s*hidden|display:\s*none/);
  assert.match(readFileSync('app/page.tsx', 'utf8'), /className=\{styles.dashboard\}/);
});
