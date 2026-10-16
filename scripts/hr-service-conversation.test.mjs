/** Executable route/component doubles. Real SQL and Chromium evidence is in
 * hr-service-conversation-browser.mjs; these counts are not browser coverage. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const result = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, name => {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name); return mocks[name];
  });
  return module.exports;
}
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const receipts = compile('components/hr-service-receipts.ts', { '@/components/hr-service-action-state': { isObject: record } });
const contract = compile('components/hr-service-conversation-contract.ts', { '@/components/hr-service-receipts': receipts });
const actor = (role = 'EMPLOYEE') => ({ id: 'actor-a', tenantId: 'tenant-a', role });
const time = '2026-10-16T00:00:00.000Z';
const comment = (id = 'comment-a', extra = {}) => ({ id, body: 'Synthetic reply', visibility: 'REQUESTOR', createdAt: time, authorName: 'Synthetic author', own: false, ...extra });
const page = (role = 'EMPLOYEE') => ({ request: { id: 'request-a', tenantId: 'tenant-a', requestNumber: 'QA-1', title: 'Synthetic request', description: 'Synthetic description', status: 'CLOSED', updatedAt: time }, viewer: { actorId: 'actor-a', tenantId: 'tenant-a', role, privateNotes: receipts.serviceStaffRoles.has(role) }, before: null, nextCursor: null, comments: [comment()] });
function parsed(data, role = 'EMPLOYEE', before = null) { return contract.parseConversationPage(data, 'request-a', actor(role), before); }
for (const [name, change] of [
  ['null', () => null], ['array', () => []], ['missing request', p => ({ ...p, request: null })],
  ['foreign request', p => ({ ...p, request: { ...p.request, id: 'other' } })],
  ['foreign tenant', p => ({ ...p, request: { ...p.request, tenantId: 'other' } })],
  ['foreign viewer', p => ({ ...p, viewer: { ...p.viewer, actorId: 'other' } })],
  ['foreign viewer tenant', p => ({ ...p, viewer: { ...p.viewer, tenantId: 'other' } })],
  ['different role', p => ({ ...p, viewer: { ...p.viewer, role: 'HR_OPERATIONS' } })],
  ['expanded note access', p => ({ ...p, viewer: { ...p.viewer, privateNotes: true } })],
  ['string note access', p => ({ ...p, viewer: { ...p.viewer, privateNotes: 'false' } })],
  ['wrong page', p => ({ ...p, before: 'different-cursor' })],
  ['unknown status', p => ({ ...p, request: { ...p.request, status: 'HIDDEN' } })],
  ['oversized description', p => ({ ...p, request: { ...p.request, description: 'x'.repeat(4001) } })],
  ['non-ISO update', p => ({ ...p, request: { ...p.request, updatedAt: '2026-01-01' } })],
  ['private employee row', p => ({ ...p, comments: [comment('c', { visibility: 'PRIVATE_NOTE' })] })],
  ['unknown visibility', p => ({ ...p, comments: [comment('c', { visibility: 'TEAM' })] })],
  ['string own flag', p => ({ ...p, comments: [comment('c', { own: 'false' })] })],
  ['array row', p => ({ ...p, comments: [[]] })],
  ['duplicate rows', p => ({ ...p, comments: [comment(), comment()] })],
  ['descending tie', p => ({ ...p, comments: [comment('b'), comment('a')] })],
  ['invalid date', p => ({ ...p, comments: [comment('c', { createdAt: '2026-02-30T00:00:00.000Z' })] })],
  ['oversized body', p => ({ ...p, comments: [comment('c', { body: 'x'.repeat(4001) })] })],
  ['oversized author', p => ({ ...p, comments: [comment('c', { authorName: 'x'.repeat(201) })] })],
  ['51 rows', p => ({ ...p, comments: Array.from({ length: 51 }, (_, i) => comment('c' + String(i).padStart(3, '0'))) })],
  ['partial next page', p => ({ ...p, nextCursor: 'comment-a' })],
  ['missing next cursor', p => ({ ...p, nextCursor: undefined })]
]) test('contract rejects ' + name, () => assert.equal(parsed(change(page())), null));
test('contract accepts empty, literal text, nullable author and correctly bound staff notes', () => {
  assert.ok(parsed({ ...page(), comments: [] }));
  assert.ok(parsed({ ...page(), comments: [comment('c', { body: '<script>literal text</script>', authorName: null, own: true })] }));
  const p = page('HR_OPERATIONS'); p.comments[0].visibility = 'PRIVATE_NOTE'; assert.ok(parsed(p, 'HR_OPERATIONS'));
});
test('contract requires the oldest returned id for a full-page cursor', () => {
  const p = page(); p.comments = Array.from({ length: 50 }, (_, i) => comment('c' + String(i).padStart(3, '0'))); p.nextCursor = 'c000';
  assert.ok(parsed(p)); p.nextCursor = 'c001'; assert.equal(parsed(p), null);
  p.nextCursor = null; p.before = 'c049'; assert.equal(parsed(p, 'EMPLOYEE', 'c049'), null);
});
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => k === 'AND' ? v.every(x => matches(row, x)) : k === 'OR' ? v.some(x => matches(row, x)) :
    record(v) && !(v instanceof Date) ? ('in' in v ? v.in.includes(row[k]) : 'lt' in v ? row[k] < v.lt : false) :
    row[k] instanceof Date && v instanceof Date ? +row[k] === +v : row[k] === v);
}
function server(role = 'EMPLOYEE') {
  let ctx = { actorId: 'actor-a', tenantId: 'tenant-a', role }, capability = true, fail = false;
  const calls = [], tickets = [{ ...page().request, requestorId: 'actor-a', updatedAt: new Date(time) }];
  const rows = [], authors = [{ id: 'staff-a', tenantId: 'tenant-a', displayName: 'Synthetic staff', email: 'must-not-escape@example.test' }];
  const select = (row, options) => row && Object.fromEntries(Object.keys(options.select).map(k => [k, row[k]]));
  const read = (table, values, first) => async options => {
    calls.push({ table, options }); if (fail) throw new Error('PRIVATE_DATABASE_SECRET');
    let filtered = values.filter(v => matches(v, options.where));
    if (options.orderBy) filtered.sort((a, b) => (+b.createdAt - +a.createdAt) || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
    filtered = filtered.slice(0, options.take ?? filtered.length).map(v => select(v, options)); return first ? filtered[0] ?? null : filtered;
  };
  const tx = { hRServiceRequest: { findFirst: read('request', tickets, true) }, hRServiceComment: { findFirst: read('cursor', rows, true), findMany: read('comments', rows, false) }, userAccount: { findMany: read('authors', authors, false) } };
  const mocks = { '@prisma/client': { Prisma: { TransactionIsolationLevel: { RepeatableRead: 'RepeatableRead' } }, ServiceVisibility: { REQUESTOR: 'REQUESTOR', PRIVATE_NOTE: 'PRIVATE_NOTE' } },
    '@/lib/authorization': { can: () => capability }, '@/lib/db': { db: { $transaction: async (fn, options) => { calls.push({ table: 'tx', options }); return fn(tx); } } },
    '@/lib/hr-service-access': { isHRServiceStaffRole: role => receipts.serviceStaffRoles.has(role), hrServiceRequestWhere: async (_tx, c) => ({ tenantId: c.tenantId, ...(['EMPLOYEE', 'MANAGER'].includes(c.role) ? { requestorId: c.actorId } : {}) }) },
    '@/lib/input-validation': { asIdentifier: v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v) ? v : null }, '@/lib/request-context': { getRequestContext: async () => ctx } };
  const api = compile('app/api/hr-service/requests/[id]/conversation/route.ts', mocks);
  return { calls, rows, tickets, authors, context: v => { ctx = v; }, deny: () => { capability = false; }, fail: () => { fail = true; },
    add(id, extra = {}) { rows.push({ id, tenantId: 'tenant-a', requestId: 'request-a', authorId: 'staff-a', body: id, visibility: 'REQUESTOR', createdAt: new Date(time), ...extra }); },
    async get(query = '', id = 'request-a') { const response = await api.GET(new Request('http://localhost/api/hr-service/requests/' + id + '/conversation' + query), { params: Promise.resolve({ id }) }); return { response, body: await response.json() }; } };
}
for (const kind of ['anonymous', 'no capability']) test('route rejects ' + kind + ' before database access', async () => {
  const h = server(); if (kind === 'anonymous') h.context(null); else h.deny();
  const { response } = await h.get(); assert.equal(response.status, kind === 'anonymous' ? 401 : 403); assert.equal(h.calls.length, 0); assert.match(response.headers.get('cache-control'), /private.*no-store/);
});
for (const query of ['?before=', '?before=x&before=y', '?before=%00']) test('route rejects invalid cursor ' + query, async () => { const h = server(); assert.equal((await h.get(query)).response.status, 400); assert.equal(h.calls.length, 0); });
for (const role of ['EMPLOYEE', 'MANAGER', 'LEGAL', 'SECURITY_AUDITOR']) test('route filters private/unknown notes for ' + role, async () => {
  const h = server(role); h.add('a'); h.add('b', { visibility: 'PRIVATE_NOTE', body: 'HIDDEN_PRIVATE' }); h.add('c', { visibility: 'TEAM' });
  const { response, body } = await h.get(); assert.equal(response.status, 200); assert.equal(body.data.comments.length, 1); assert.equal(body.data.viewer.privateNotes, false); assert.ok(!JSON.stringify(body).includes('HIDDEN_PRIVATE')); assert.ok(!JSON.stringify(body).includes('must-not-escape'));
});
for (const role of ['HRBP', 'HR_OPERATIONS', 'TENANT_ADMIN']) test('route grants private history only to scoped service role ' + role, async () => { const h = server(role); h.add('a', { visibility: 'PRIVATE_NOTE' }); const { body } = await h.get(); assert.equal(body.data.comments.length, 1); assert.equal(body.data.viewer.privateNotes, true); assert.equal(h.calls[0].options.isolationLevel, 'RepeatableRead'); });
test('route pages 125 equal-timestamp messages without omissions or duplicates', async () => {
  const h = server(); for (let i = 0; i < 125; i++) h.add('c' + String(i).padStart(3, '0'));
  const seen = []; let cursor = null;
  do { const { body } = await h.get(cursor ? '?before=' + cursor : ''); assert.ok(parsed(body.data, 'EMPLOYEE', cursor)); assert.ok(body.data.comments.length <= 50); seen.push(...body.data.comments.map(r => r.id)); cursor = body.data.nextCursor; } while (cursor);
  assert.equal(seen.length, 125); assert.equal(new Set(seen).size, 125); assert.deepEqual([...seen].sort(), h.rows.map(r => r.id));
  assert.ok(h.calls.filter(c => c.table === 'comments').every(c => c.options.take === 51));
});
for (const extra of [{ requestId: 'other' }, { tenantId: 'other' }, { visibility: 'PRIVATE_NOTE' }]) test('route rejects out-of-scope cursor ' + JSON.stringify(extra), async () => { const h = server(); h.add('secret', extra); const { response, body } = await h.get('?before=secret'); assert.equal(response.status, 404); assert.ok(!JSON.stringify(body).includes('secret')); assert.equal(h.calls.filter(c => c.table === 'comments').length, 0); });
test('route denies foreign request before any conversation query', async () => { const h = server(); h.tickets[0].tenantId = 'foreign'; assert.equal((await h.get()).response.status, 404); assert.deepEqual(h.calls.map(c => c.table), ['tx', 'request']); });
test('route suppresses foreign author details and supports removed authors', async () => { const h = server(); h.add('a', { authorId: 'foreign' }); h.authors.push({ id: 'foreign', tenantId: 'other', displayName: 'PRIVATE_NAME' }); const { body } = await h.get(); assert.equal(body.data.comments[0].authorName, null); assert.ok(!JSON.stringify(body).includes('PRIVATE_NAME')); });
test('route fails closed with private no-store bounded feedback', async () => { const h = server(); h.fail(); const { response, body } = await h.get(); assert.equal(response.status, 503); assert.equal(body.data, undefined); assert.ok(!JSON.stringify(body).includes('PRIVATE_DATABASE')); assert.equal(response.headers.get('vary'), 'Cookie'); });
function nodes(n) { if (Array.isArray(n)) return n.flatMap(nodes); return n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : []; }
function text(n) { if (Array.isArray(n)) return n.map(text).join(''); return n == null || typeof n === 'boolean' ? '' : typeof n === 'object' ? text(n.props?.children) : String(n); }
function client() {
  let current = actor(), auth = true, loading = false, props = { requestId: 'request-a', locale: 'en' }, cursor = 0, effects = [], tree;
  const slots = [], calls = []; let responder = async () => ({ status: 200, redirected: false, json: async () => ({ data: page(current.role) }) });
  const saved = globalThis.fetch; globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return responder(url, init); };
  const react = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; }, useId() { const i = cursor++; return slots[i] ??= 'id-' + i; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } } };
  const jsx = (type, props) => ({ type, props });
  const component = compile('components/hr-service-conversation.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/session-provider': { useSessionContext: () => ({ session: { authenticated: auth, user: current }, loading }) },
    '@/components/use-policy-dialog': { usePolicyDialog: () => {} }, '@/components/hr-service-conversation-contract': contract,
    '@/components/hr-service-conversation.module.css': { default: new Proxy({}, { get: (_, k) => k }) } }).HRServiceConversation;
  function render() { cursor = 0; tree = component(props); for (const n of nodes(tree)) if (n.props?.ref) n.props.ref.current ??= { open: false, showModal() { this.open = true; }, close() { this.open = false; }, focus() {} }; const next = effects; effects = []; next.forEach(f => f()); return tree; }
  function button(label) { const n = nodes(tree).find(n => n.type === 'button' && text(n).trim() === label); assert.ok(n, 'Missing: ' + label + ' in ' + text(tree)); return n; }
  async function settle() { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); render(); } }
  render(); return { calls, render, settle, button, get text() { return text(tree); }, get tree() { return tree; }, reply: fn => { responder = fn; },
    async click(label) { button(label).props.onClick(); render(); await settle(); },
    props(value) { props = { ...props, ...value }; render(); }, session(value) { current = { ...current, ...value }; render(); }, logout() { auth = false; render(); }, sessionLoading(value) { loading = value; render(); },
    close() { for (const s of slots) s?.cleanup?.(); globalThis.fetch = saved; } };
}
test('client is lazy, read-only, uncached and clears history on close/reopen', async () => {
  const h = client(); try { assert.equal(h.calls.length, 0); await h.click('Conversation history'); assert.ok(h.text.includes('Synthetic reply')); assert.equal(h.calls[0].cache, 'no-store'); assert.equal(h.calls[0].credentials, 'same-origin'); assert.ok(h.calls.every(c => !c.method)); await h.click('Close'); assert.ok(!h.text.includes('Synthetic reply')); await h.click('Conversation history'); assert.equal(h.calls.length, 2); } finally { h.close(); }
});
test('client failed read does not loop and requires an explicit retry', async () => { const h = client(); try { h.reply(async () => { throw Error('PRIVATE_ERROR'); }); await h.click('Conversation history'); assert.equal(h.calls.length, 1); assert.ok(!h.text.includes('PRIVATE_ERROR')); assert.ok(h.text.includes('could not be loaded')); h.reply(async () => ({ status: 200, json: async () => ({ data: page() }) })); await h.click('Retry latest page'); assert.equal(h.calls.length, 2); assert.ok(h.text.includes('Synthetic reply')); } finally { h.close(); } });
for (const fault of ['private', 'foreign', 'html', 'redirect', '503']) test('client rejects ' + fault + ' response without rendering its contents', async () => {
  const h = client(); try { const p = page(); p.comments[0].body = 'MUST_NOT_RENDER'; if (fault === 'private') p.comments[0].visibility = 'PRIVATE_NOTE'; if (fault === 'foreign') p.viewer.actorId = 'other'; h.reply(async () => ({ status: fault === '503' ? 503 : 200, redirected: fault === 'redirect', json: async () => { if (fault === 'html') throw Error('HTML'); return { data: p }; } })); await h.click('Conversation history'); assert.ok(!h.text.includes('MUST_NOT_RENDER')); assert.ok(h.text.includes('could not be loaded')); } finally { h.close(); }
});
test('client simultaneous refresh callbacks produce one pending read', async () => { const h = client(); let done; try { await h.click('Conversation history'); h.reply(() => new Promise(resolve => { done = resolve; })); const cb = h.button('Refresh latest messages').props.onClick; cb(); cb(); h.render(); assert.equal(h.calls.length, 2); assert.ok(!h.text.includes('Synthetic reply')); done({ status: 200, json: async () => ({ data: page() }) }); await h.settle(); } finally { h.close(); } });
test('client closed read is aborted; late old reply cannot replace a new open', async () => { const h = client(); let done; try { h.reply(() => new Promise(resolve => { done = resolve; })); await h.click('Conversation history'); await h.click('Close'); assert.equal(h.calls[0].signal.aborted, true); const p = page(); p.comments[0].body = 'NEW_PAGE'; h.reply(async () => ({ status: 200, json: async () => ({ data: p }) })); await h.click('Conversation history'); done({ status: 200, json: async () => ({ data: page() }) }); await h.settle(); assert.ok(h.text.includes('NEW_PAGE')); assert.ok(!h.text.includes('Synthetic reply')); } finally { h.close(); } });
for (const change of ['record', 'tenant', 'role', 'actor', 'logout']) test('client ' + change + ' change hides old history and rejects captured callbacks', async () => { const h = client(); try { await h.click('Conversation history'); const cb = h.button('Refresh latest messages').props.onClick; if (change === 'record') h.props({ requestId: 'other' }); else if (change === 'logout') h.logout(); else h.session({ [change === 'tenant' ? 'tenantId' : change === 'actor' ? 'id' : 'role']: 'other' }); cb(); await h.settle(); assert.equal(h.calls.length, 1); assert.ok(!h.text.includes('Synthetic reply')); } finally { h.close(); } });
test('client failed reauthorization discards a previously visible private page', async () => { const h = client(); try { h.session({ role: 'HR_OPERATIONS' }); await h.click('Conversation history'); assert.ok(h.text.includes('Synthetic reply')); h.reply(async () => ({ status: 403, json: async () => ({ error: 'PRIVATE_DETAILS' }) })); await h.click('Refresh latest messages'); assert.ok(!h.text.includes('Synthetic reply')); assert.ok(!h.text.includes('PRIVATE_DETAILS')); } finally { h.close(); } });
test('client language switch translates feedback without another read', async () => { const h = client(); try { h.reply(async () => ({ status: 503 })); await h.click('Conversation history'); h.props({ locale: 'tr' }); assert.ok(h.text.includes('Konuşma yüklenemedi')); assert.equal(h.calls.length, 1); } finally { h.close(); } });
test('client older page is explicitly bound and replaces rather than grows browser memory', async () => { const h = client(); try { const p = page(); p.comments = Array.from({ length: 50 }, (_, i) => comment('c' + String(i).padStart(3, '0'))); p.nextCursor = 'c000'; h.reply(async () => ({ status: 200, json: async () => ({ data: p }) })); await h.click('Conversation history'); const q = page(); q.before = 'c000'; q.comments[0].body = 'Older reply'; h.reply(async () => ({ status: 200, json: async () => ({ data: q }) })); await h.click('Older messages'); assert.match(h.calls[1].url, /before=c000$/); assert.ok(h.text.includes('Older reply')); assert.ok(!h.text.includes('Synthetic reply')); } finally { h.close(); } });

test('client same-principal session refresh cannot automatically reopen stale private history', async () => { const h = client(); try { h.session({ role: 'HR_OPERATIONS' }); await h.click('Conversation history'); assert.ok(h.text.includes('Synthetic reply')); h.sessionLoading(true); h.sessionLoading(false); assert.ok(!h.text.includes('Synthetic reply')); assert.equal(h.calls.length, 1); await h.click('Conversation history'); assert.equal(h.calls.length, 2); } finally { h.close(); } });
