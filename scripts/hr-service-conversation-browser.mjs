/** Real read-only conversation UI/SQL acceptance. All setup is synthetic and
 * restricted to disposable localhost PostgreSQL; never run on customer data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
const origin = 'http://localhost:3100', database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname)); assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/hr-service-conversation'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Production Next.js, Chromium, signed synthetic sessions and disposable PostgreSQL.',
  limitations: ['Not provider deployment or customer UAT.', '50-message pages are replaced, not a whole-history export.',
    'No durable command idempotency, write-revision binding, attachment or routing change.',
    'No background polling; explicit refresh reauthorizes. Already disclosed data cannot be recalled.',
    'Author names are current directory names; message timestamps are UTC.'] };
const db = new PrismaClient(), browser = await chromium.launch(), contexts = [], ticketIds = [];
const marker = 'qaconv-' + randomUUID().slice(0, 8), selfId = marker + '-self', staffId = marker + '-staff', peerId = marker + '-peer';
let tenantId, foreignTenant, personId, employmentId, sequence = 0;
const publicText = 'Synthetic public reply ' + marker, privateText = 'Synthetic PRIVATE note ' + marker;
const label = (locale, en, tr) => locale === 'tr' ? tr : en;
async function context(id, locale = 'en', theme = 'light', width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(ctx);
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (id) assert.equal((await ctx.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: id, password } })).status(), 200);
  await ctx.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await ctx.addInitScript(({ locale, theme }) => { localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme); }, { locale, theme });
  return ctx;
}
async function fixture(status = 'IN_PROGRESS', otherTenant = false) {
  const record = await db.hRServiceRequest.create({ data: { tenantId: otherTenant ? foreignTenant : tenantId,
    requestNumber: marker + '-' + (++sequence), requestorId: selfId, subjectEmploymentId: otherTenant ? null : employmentId,
    category: 'QA', title: 'Synthetic conversation ' + sequence, description: 'Synthetic original description', status, priority: 'MEDIUM' } });
  ticketIds.push(record.id); return record;
}
async function add(ticket, body, visibility = 'REQUESTOR', extra = {}) {
  return db.hRServiceComment.create({ data: { tenantId: ticket.tenantId, requestId: ticket.id, authorId: staffId, body, visibility, ...extra } });
}
async function ready(page, ticket) {
  const response = await page.goto(origin + '/module/hr-service?request=' + encodeURIComponent(ticket.id), { waitUntil: 'load', timeout: 25000 });
  assert.equal(response.status(), 200); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
const trigger = (page, ticket, locale = 'en') => page.locator(`[data-hr-service-conversation="${ticket.id}"]`).getByRole('button', { name: label(locale, 'Conversation history', 'Konuşma geçmişi'), exact: true });
const dialog = (page, locale = 'en') => page.getByRole('dialog', { name: label(locale, 'Request conversation', 'Talep konuşması'), exact: true });
async function open(page, ticket, locale = 'en') { await ready(page, ticket); await trigger(page, ticket, locale).click(); const d = dialog(page, locale); await d.waitFor(); return d; }
async function loaded(d) { await d.locator('[aria-busy="false"]').waitFor(); }
const path = ticket => `/api/hr-service/requests/${ticket.id}/conversation`;
async function read(ctx, ticket, cursor = null) { const r = await ctx.request.get(origin + path(ticket) + (cursor ? '?before=' + encodeURIComponent(cursor) : '')); return { response: r, body: await r.json() }; }
async function shot(page, name) { const file = name + '.jpg'; await page.screenshot({ path: out + '/' + file, type: 'jpeg', quality: 80 }); return file; }
async function check(name, page, fn) {
  let row = { name, passed: false };
  try { row = { ...row, ...await fn(), passed: true }; }
  catch (error) { row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 700); row.screenshot = await shot(page, 'failure-' + report.tests.length).catch(() => null); }
  report.tests.push(row); console.log('CONVERSATION_SCENARIO ' + JSON.stringify(row)); await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
}
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } }); tenantId = template.tenantId; assert.ok(template.localPasswordHash);
  foreignTenant = marker + '-tenant'; await db.tenant.create({ data: { id: foreignTenant, name: 'Synthetic conversation tenant', region: 'QA' } });
  for (const [id, role] of [[selfId, 'EMPLOYEE'], [peerId, 'EMPLOYEE'], [staffId, 'HR_OPERATIONS']]) {
    await db.userAccount.create({ data: { id, tenantId, subject: id, email: id + '@example.test', displayName: 'Synthetic ' + role,
      role, active: true, localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  }
  const person = await db.person.create({ data: { tenantId, givenName: 'Synthetic', familyName: marker, workEmail: selfId + '@example.test' } }); personId = person.id;
  employmentId = (await db.employment.create({ data: { tenantId, personId, startDate: new Date('2026-01-01'), status: 'ACTIVE' } })).id;
  const self = await context(selfId), staff = await context(staffId), peer = await context(peerId), anonymous = await context(null);
  const sp = await self.newPage(), hp = await staff.newPage();
  const ticket = await fixture(); const pub = await add(ticket, publicText); const hidden = await add(ticket, privateText, 'PRIVATE_NOTE');
  const long = await fixture(); const tied = new Date('2026-01-01T12:00:00.000Z');
  for (let i = 0; i < 125; i++) await add(long, 'Synthetic historical message ' + i, 'REQUESTOR', { id: marker + '-c' + String(i).padStart(3, '0'), createdAt: tied });
  await add(long, privateText, 'PRIVATE_NOTE');
  await check('API: scoped read is private/no-store and does not disclose author ids or emails', sp, async () => {
    const { response, body } = await read(self, ticket); assert.equal(response.status(), 200); assert.match(response.headers()['cache-control'], /private.*no-store/); assert.match(response.headers().vary, /Cookie/);
    assert.equal(body.data.request.id, ticket.id); assert.equal(body.data.viewer.actorId, selfId); assert.equal(body.data.comments.length, 1);
    assert.equal(body.data.comments[0].id, pub.id); assert.equal(body.data.comments[0].authorId, undefined); assert.ok(!JSON.stringify(body).includes('@example.test')); assert.ok(!JSON.stringify(body).includes(privateText));
    assert.equal((await read(anonymous, ticket)).response.status(), 401); assert.equal((await read(peer, ticket)).response.status(), 404);
  });
  await check('API: all 125 equal-timestamp visible messages page without duplicates or omissions', sp, async () => {
    let before = null; const ids = [], sizes = [];
    do { const { response, body } = await read(self, long, before); assert.equal(response.status(), 200); assert.equal(body.data.before, before); sizes.push(body.data.comments.length); ids.push(...body.data.comments.map(r => r.id)); before = body.data.nextCursor; assert.ok(sizes.length <= 3); } while (before);
    assert.deepEqual(sizes, [50, 50, 25]); assert.equal(new Set(ids).size, 125); assert.deepEqual([...ids].sort(), Array.from({ length: 125 }, (_, i) => marker + '-c' + String(i).padStart(3, '0')));
  });
  await check('API: invisible, other-request and malformed cursors never broaden scope', sp, async () => {
    for (const cursor of [hidden.id, marker + '-c000', 'missing-id']) assert.equal((await read(self, ticket, cursor)).response.status(), 404);
    assert.equal((await self.request.get(origin + path(ticket) + '?before=')).status(), 400);
    assert.equal((await self.request.get(origin + path(ticket) + '?before=a&before=b')).status(), 400);
  });
  await check('API: even staff cannot read a foreign-tenant request with matching requester id', hp, async () => {
    const foreign = await fixture('CLOSED', true); await add(foreign, 'Foreign synthetic content');
    assert.equal((await read(staff, foreign)).response.status(), 404); assert.equal((await read(self, foreign)).response.status(), 404);
  });
  await check('API: repeated conversation reads do not mutate request, comments or audits', sp, async () => {
    const before = await db.hRServiceRequest.findUniqueOrThrow({ where: { id: ticket.id } });
    const audits = await db.auditEvent.count({ where: { tenantId, resourceId: ticket.id } });
    await read(self, ticket); await read(staff, ticket);
    assert.deepEqual(await db.hRServiceRequest.findUniqueOrThrow({ where: { id: ticket.id } }), before);
    assert.equal(await db.hRServiceComment.count({ where: { tenantId, requestId: ticket.id } }), 2);
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: ticket.id } }), audits);
  });
  await check('UI: staff sees labelled public replies and private HR notes', hp, async () => {
    const d = await open(hp, ticket); await loaded(d); await d.getByText(privateText, { exact: true }).waitFor();
    assert.equal(await d.getByText('Private HR note', { exact: true }).count(), 1); assert.equal(await d.locator('[data-comment-id]').count(), 2);
    return { screenshot: await shot(hp, 'staff-history') };
  });
  await check('UI: employee reads public history without private-note body or badge', sp, async () => {
    const d = await open(sp, ticket); await loaded(d); await d.getByText(publicText, { exact: true }).waitFor();
    assert.ok(!(await d.innerText()).includes(privateText)); assert.equal(await d.getByText('Private HR note', { exact: true }).count(), 0);
    assert.equal(await d.locator('[data-comment-id]').count(), 1); return { screenshot: await shot(sp, 'employee-history') };
  });
  await check('UI: closed empty request has a readable description and no mutation controls', sp, async () => {
    const t = await fixture('CLOSED'), d = await open(sp, t); await loaded(d); await d.getByText('There are no visible messages on this page.', { exact: true }).waitFor();
    assert.equal(await d.getByText(t.description, { exact: true }).count(), 1); assert.equal(await d.locator('textarea,input,select').count(), 0);
  });
  await check('UI: markup in descriptions and replies is literal, never active HTML', sp, async () => {
    const t = await fixture(); const literal = '<img src=x onerror="window.QA_EXECUTED=1"> <script>window.QA_EXECUTED=1</script>';
    await add(t, literal); await db.hRServiceRequest.update({ where: { id: t.id }, data: { description: literal } });
    const d = await open(sp, t); await loaded(d); assert.equal(await d.locator('img,script,iframe').count(), 0); assert.ok((await d.innerText()).includes(literal)); assert.equal(await sp.evaluate(() => window.QA_EXECUTED), undefined);
  });
  await check('UI: failed read stops and only explicit retry fetches the latest page', sp, async () => {
    const pattern = '**' + path(ticket); let reads = 0;
    await sp.route(pattern, route => { reads++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"PRIVATE_DIAGNOSTIC"}' }); });
    try { const d = await open(sp, ticket); await d.getByRole('alert').waitFor(); await sp.waitForTimeout(200); assert.equal(reads, 1); assert.ok(!(await d.innerText()).includes('PRIVATE_DIAGNOSTIC'));
      await sp.unroute(pattern); await d.getByRole('button', { name: 'Retry latest page', exact: true }).click(); await d.getByText(publicText, { exact: true }).waitFor();
    } finally { await sp.unroute(pattern); }
  });
  for (const fault of ['request', 'tenant', 'actor', 'private']) await check('UI: mismatched ' + fault + ' response never enters rendered history', sp, async () => {
    const pattern = '**' + path(ticket);
    await sp.route(pattern, async route => { const response = await route.fetch(), body = await response.json();
      if (fault === 'request') body.data.request.id = 'other'; if (fault === 'tenant') body.data.request.tenantId = 'other'; if (fault === 'actor') body.data.viewer.actorId = 'other';
      if (fault === 'private') body.data.comments[0].visibility = 'PRIVATE_NOTE'; body.data.comments[0].body = 'MUST_NOT_RENDER';
      await route.fulfill({ response, body: JSON.stringify(body) }); });
    try { const d = await open(sp, ticket); await d.getByRole('alert').waitFor(); assert.ok(!(await d.innerText()).includes('MUST_NOT_RENDER')); assert.equal(await d.locator('[data-comment-id]').count(), 0); }
    finally { await sp.unroute(pattern); }
  });
  await check('UI: older-page controls read all pages and reject mismatched page identity', sp, async () => {
    const d = await open(sp, long); await loaded(d); assert.equal(await d.locator('[data-comment-id]').count(), 50);
    await d.getByRole('button', { name: 'Older messages', exact: true }).click(); await loaded(d); await d.getByText('Synthetic historical message 25', { exact: true }).waitFor();
    await d.getByRole('button', { name: 'Older messages', exact: true }).click(); await loaded(d); assert.equal(await d.locator('[data-comment-id]').count(), 25);
    assert.equal(await d.getByRole('button', { name: 'Older messages', exact: true }).count(), 0);
    await d.getByRole('button', { name: 'Refresh latest messages', exact: true }).click(); await d.getByText('Synthetic historical message 124', { exact: true }).waitFor();
    const pattern = '**' + path(long) + '?before=*'; await sp.route(pattern, async route => { const response = await route.fetch(), body = await response.json(); body.data.before = null; await route.fulfill({ response, body: JSON.stringify(body) }); });
    try { await d.getByRole('button', { name: 'Older messages', exact: true }).click(); await d.getByRole('alert').waitFor(); assert.equal(await d.locator('[data-comment-id]').count(), 0); } finally { await sp.unroute(pattern); }
  });
  await check('UI: closing aborts a delayed read and a late page cannot replace a new opening', sp, async () => {
    const pattern = '**' + path(ticket); let reads = 0, release, arrived;
    const started = new Promise(resolve => { arrived = resolve; });
    await sp.route(pattern, async route => { const response = await route.fetch(), body = await response.json(); reads++;
      if (reads === 1) { body.data.comments[0].body = 'STALE_OLD_PAGE'; arrived(); await new Promise(resolve => { release = resolve; }); }
      await route.fulfill({ response, body: JSON.stringify(body) }).catch(() => {});
    });
    try { const d = await open(sp, ticket); await started; await d.getByRole('button', { name: 'Close', exact: true }).click();
      await trigger(sp, ticket).click(); await d.getByText(publicText, { exact: true }).waitFor(); release(); await sp.waitForTimeout(200); assert.ok(!(await d.innerText()).includes('STALE_OLD_PAGE')); assert.equal(reads, 2);
    } finally { release?.(); await sp.unroute(pattern); }
  });
  await check('UI: a failed reauthorization clears previously displayed messages', sp, async () => {
    const t = await fixture(); await add(t, 'Previously authorized synthetic message'); const d = await open(sp, t); await d.getByText('Previously authorized synthetic message', { exact: true }).waitFor();
    await db.hRServiceRequest.update({ where: { id: t.id }, data: { requestorId: peerId, subjectEmploymentId: null } });
    await d.getByRole('button', { name: 'Refresh latest messages', exact: true }).click(); await d.getByRole('alert').waitFor(); assert.ok(!(await d.innerText()).includes('Previously authorized synthetic message'));
  });
  await check('UI: real staff reply is persisted once and visible after employee refresh', sp, async () => {
    const t = await fixture(); const d = await open(sp, t); await loaded(d); await ready(hp, t);
    const actions = hp.locator(`[data-hr-service-actions="${t.id}"]`); await actions.locator('summary').click();
    await actions.getByLabel('Reply or note', { exact: true }).fill('Synthetic sent through actual reply form'); hp.once('dialog', modal => modal.accept());
    const [response] = await Promise.all([hp.waitForResponse(r => r.url().endsWith(`/requests/${t.id}/comments`) && r.request().method() === 'POST'), actions.getByRole('button', { name: 'Add reply', exact: true }).click()]);
    assert.equal(response.status(), 201); const saved = (await response.json()).data;
    await d.getByRole('button', { name: 'Refresh latest messages', exact: true }).click(); await d.getByText('Synthetic sent through actual reply form', { exact: true }).waitFor();
    assert.equal(await db.hRServiceComment.count({ where: { tenantId, requestId: t.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: saved.id, action: 'hr-service.comment-added' } }), 1);
  });
  for (const [locale, theme, width] of [['en', 'light', 320], ['en', 'dark', 390], ['tr', 'light', 320], ['tr', 'dark', 390]]) {
    await check(`UI: ${locale}/${theme}/${width}px modal, keyboard containment and Escape`, hp, async () => {
      const ctx = await context(staffId, locale, theme, width), page = await ctx.newPage(), t = await fixture();
      await add(t, 'Synthetic long unbroken text ' + 'x'.repeat(300)); await add(t, privateText, 'PRIVATE_NOTE'); const d = await open(page, t, locale); await loaded(d); await d.getByText(privateText, { exact: true }).waitFor();
      const geometry = await d.evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: innerWidth, scroll: el.scrollWidth, client: el.clientWidth, overflow: document.documentElement.style.getPropertyValue('overflow-y') }; });
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1); assert.ok(geometry.scroll <= geometry.client + 2); assert.equal(geometry.overflow, 'hidden');
      for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 30; i++) { await page.keyboard.press(key); assert.ok(await d.evaluate(el => el.contains(document.activeElement))); }
      const screenshot = await shot(page, `history-${locale}-${theme}-${width}`); await page.keyboard.press('Escape'); await d.waitFor({ state: 'hidden' });
      assert.ok(await trigger(page, t, locale).evaluate(el => el === document.activeElement)); return { screenshot, geometry };
    });
  }
} finally {
  await Promise.all(contexts.map(ctx => ctx.close().catch(() => {}))); await browser.close();
  // Cleanup exact generated ids only. Audit fixtures remain in the disposable database.
  if (ticketIds.length) { await db.hRServiceComment.deleteMany({ where: { requestId: { in: ticketIds }, tenantId: { in: [tenantId, foreignTenant].filter(Boolean) } } }).catch(() => {}); await db.hRServiceRequest.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {}); }
  if (employmentId) await db.employment.deleteMany({ where: { id: employmentId, tenantId } }).catch(() => {});
  if (personId) await db.person.deleteMany({ where: { id: personId, tenantId } }).catch(() => {});
  await db.userAccount.deleteMany({ where: { id: { in: [selfId, staffId, peerId] }, tenantId } }).catch(() => {});
  if (foreignTenant) await db.tenant.deleteMany({ where: { id: foreignTenant } }).catch(() => {});
  await db.$disconnect(); report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2)); console.log('CONVERSATION_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 22 || report.tests.some(t => !t.passed)) process.exitCode = 1;
