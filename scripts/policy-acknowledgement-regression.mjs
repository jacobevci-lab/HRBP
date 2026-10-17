/** Real acknowledgement API/SQL races, displayed-content binding and Chromium.
 * Existing race/replay/waiver assertions retained; fixtures are disposable only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/policy-acknowledgement'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Actual Next.js, PostgreSQL locks and Chromium with synthetic local identities. No production or external providers.',
  limitations: ['Policies are synthetic DB fixtures, not proof of authoring UI.', 'Displaying/confirming a document cannot prove human comprehension.', 'Audit hash binding is not an immutable off-platform content archive.'] };
const db = new PrismaClient(), browser = await chromium.launch();
const marker = 'ack-' + randomUUID().slice(0, 10), contexts = [], snapshots = new Map();
let tenantId, employmentId, userId, cookie, sequence = 0;
const hash = text => createHash('sha256').update(text).digest('hex');
async function post(policyId, options = {}) {
  const snapshot = snapshots.get(policyId);
  const response = await fetch(`${origin}/api/policies/${encodeURIComponent(policyId)}/acknowledgements`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { origin, 'content-type': 'application/json', ...(options.anonymous ? {} : { cookie }), ...options.headers },
    ...(options.noBody ? {} : { body: JSON.stringify({ policyVersion: snapshot.version, contentHash: snapshot.contentHash, ...options.body }) })
  });
  return { status: response.status, body: await response.json() };
}
async function preview(policyId, anonymous = false) {
  const r = await fetch(`${origin}/api/policies/${policyId}/acknowledgements`, { headers: anonymous ? {} : { cookie }, redirect: 'manual' });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
async function fixture({ policy: overrides = {}, assignmentStatus = 'PENDING', assignedEmploymentId = employmentId } = {}) {
  const code = `${marker}-${++sequence}`, text = overrides.contentMarkdown ?? 'Synthetic policy for isolated acknowledgement testing.';
  const policy = await db.policyRecord.create({ data: { tenantId, code, title: `Synthetic ${code}`, version: '1.0', ownerId: userId,
    contentMarkdown: text, contentHash: hash(text), effectiveFrom: new Date(Date.now() - 86400000), status: 'PUBLISHED', ...overrides } });
  if (assignmentStatus) await db.policyAssignment.create({ data: { tenantId: policy.tenantId, policyId: policy.id, employmentId: assignedEmploymentId, status: assignmentStatus } });
  // Freeze what the fixture client read. Never silently query the NEW version
  // from inside post(), which would hide stale-snapshot regressions.
  snapshots.set(policy.id, { version: policy.version, contentHash: policy.contentHash });
  return policy;
}
const rows = id => db.policyAcknowledgement.findMany({ where: { policyId: id } });
const assignment = id => db.policyAssignment.findUniqueOrThrow({ where: { policyId_employmentId: { policyId: id, employmentId } } });
const auditCount = id => db.auditEvent.count({ where: { tenantId, resourceId: id, action: 'policy.acknowledged' } });
const bindingCount = id => db.auditEvent.count({ where: { tenantId, resourceId: id, action: 'policy.acknowledgement-content-bound' } });
async function test(name, run) {
  try { report.tests.push({ name, passed: true, ...await run() }); }
  catch (error) { report.tests.push({ name, passed: false, error: String(error.message).replaceAll(password, '[redacted]').slice(0, 700) }); }
  console.log('ACK_SCENARIO ' + JSON.stringify(report.tests.at(-1)));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
async function waitForLock(label) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const result = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%/* policy-ack:${label} */%`}`;
    if (result[0].count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Expected the actual endpoint to wait on the ${label} row lock`);
}
async function race(policy, label, mutate, expected) {
  let release, held;
  const gate = new Promise(resolve => { release = resolve; }), locked = new Promise(resolve => { held = resolve; });
  const blocker = db.$transaction(async tx => { await mutate(tx); held(); await gate; }, { timeout: 10000 });
  let response;
  try {
    await Promise.race([locked, blocker.then(() => { throw Error('Writer exited before acquiring its lock'); })]);
    response = post(policy.id); await waitForLock(label); assert.equal((await rows(policy.id)).length, 0);
  } finally { release(); await blocker; }
  assert.equal((await response).status, expected); assert.equal((await rows(policy.id)).length, 0);
}
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  assert.ok(template.localPasswordHash); tenantId = template.tenantId; userId = marker + '-employee';
  await db.userAccount.create({ data: { id: userId, tenantId, subject: userId, role: 'EMPLOYEE', displayName: 'Synthetic Acknowledgement QA', email: userId + '@example.test', active: true, localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  const person = await db.person.create({ data: { tenantId, employeeNumber: marker, givenName: 'Synthetic', familyName: marker, workEmail: userId + '@example.test' } });
  employmentId = (await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date(Date.now() - 86400000) } })).id;
  const login = await fetch(origin + '/api/auth/local', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ identifier: userId, password }) });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);

  await test('ack API: anonymous and foreign-origin requests cannot write', async () => {
    const p = await fixture(); assert.equal((await post(p.id, { anonymous: true })).status, 401);
    assert.equal((await post(p.id, { headers: { origin: 'https://example.invalid' } })).status, 403); assert.equal((await rows(p.id)).length, 0);
  });
  for (const [name, options, expected] of [
    ['no assignment', { assignmentStatus: null }, 404], ['waived assignment', { assignmentStatus: 'WAIVED' }, 409],
    ['future effective date', { policy: { effectiveFrom: new Date(Date.now() + 86400000) } }, 404],
    ['expired policy', { policy: { effectiveTo: new Date(Date.now() - 60000) } }, 404],
    ['draft policy', { policy: { status: 'DRAFT' } }, 404], ['retired policy', { policy: { status: 'RETIRED' } }, 404],
    ['acknowledged status without an original receipt', { assignmentStatus: 'ACKNOWLEDGED' }, 409]
  ]) await test(`ack API: ${name} does not fabricate a receipt`, async () => {
    const p = await fixture(options), before = options.assignmentStatus === null ? null : await assignment(p.id);
    assert.equal((await post(p.id)).status, expected); assert.equal((await rows(p.id)).length, 0);
    if (before) assert.deepEqual(await assignment(p.id), before);
  });
  await test('ack API: body employmentId cannot override the verified employee', async () => {
    const person = await db.person.create({ data: { tenantId, employeeNumber: marker + '-other', givenName: 'Synthetic', familyName: 'Other' } });
    const target = await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date() } });
    const p = await fixture({ assignedEmploymentId: target.id }); assert.equal((await post(p.id, { body: { employmentId: target.id } })).status, 404); assert.equal((await rows(p.id)).length, 0);
  });
  await test('ack API: foreign-tenant policy remains unavailable even with a matching employment string', async () => {
    const foreign = await db.tenant.create({ data: { name: 'Synthetic other tenant', region: 'EU' } });
    const p = await fixture({ policy: { tenantId: foreign.id } }); assert.equal((await post(p.id)).status, 404); assert.equal((await preview(p.id)).status, 404); assert.equal((await rows(p.id)).length, 0);
  });
  for (const status of ['PENDING', 'OVERDUE']) await test(`ack API: ${status} records one receipt and preserves it on sequential replay`, async () => {
    const p = await fixture({ assignmentStatus: status }), first = await post(p.id);
    assert.equal(first.status, 201); assert.equal(first.body.meta.replayed, false); assert.equal(first.body.data.employmentId, employmentId);
    assert.equal(first.body.data.policyContentHash, p.contentHash);
    const before = (await rows(p.id))[0]; assert.equal(await auditCount(before.id), 1);
    const second = await post(p.id); assert.equal(second.status, 201); assert.equal(second.body.meta.replayed, true);
    assert.deepEqual(second.body.data, first.body.data); assert.deepEqual((await rows(p.id))[0], before);
    assert.equal(await auditCount(before.id), 1); assert.equal((await assignment(p.id)).status, 'ACKNOWLEDGED');
    const event = await db.auditEvent.findFirstOrThrow({ where: { tenantId, resourceId: before.id, action: 'policy.acknowledged' } });
    assert.deepEqual(JSON.parse(event.purpose), { schema: 'policy-ack-content/v1', version: p.version, contentHash: p.contentHash });
    const bound = await db.auditEvent.findFirstOrThrow({ where: { tenantId, resourceId: before.id, action: 'policy.acknowledgement-content-bound' } });
    assert.equal(await bindingCount(before.id), 1); assert.equal(bound.purpose, event.purpose); assert.equal(bound.actorId, before.acknowledgedBy);
  });
  await test('ack API: eight concurrent requests produce one receipt and exactly one acknowledgement audit', async () => {
    const p = await fixture(), responses = await Promise.all(Array.from({ length: 8 }, () => post(p.id)));
    assert.ok(responses.every(v => v.status === 201)); assert.equal(responses.filter(v => v.body.meta.replayed === false).length, 1); assert.equal(responses.filter(v => v.body.meta.replayed === true).length, 7);
    for (const r of responses) assert.deepEqual(r.body.data, responses[0].body.data);
    const saved = await rows(p.id); assert.equal(saved.length, 1); assert.equal(await auditCount(saved[0].id), 1); assert.equal(await bindingCount(saved[0].id), 1); return { requests: 8, receipts: 1, acknowledgementAudits: 1, contentBindingAudits: 1 };
  });
  await test('ack API: inconsistent pending assignment does not overwrite historical evidence', async () => {
    const p = await fixture(); assert.equal((await post(p.id)).status, 201); const before = (await rows(p.id))[0];
    await db.policyAssignment.update({ where: { policyId_employmentId: { policyId: p.id, employmentId } }, data: { status: 'PENDING' } });
    assert.equal((await post(p.id)).status, 409); assert.deepEqual((await rows(p.id))[0], before); assert.equal(await auditCount(before.id), 1); assert.equal((await assignment(p.id)).status, 'PENDING');
  });
  await test('ack SQL race: committed waiver wins over waiting acknowledgement', async () => {
    const p = await fixture(); await race(p, 'assignment', tx => tx.policyAssignment.update({ where: { policyId_employmentId: { policyId: p.id, employmentId } }, data: { status: 'WAIVED' } }), 409); assert.equal((await assignment(p.id)).status, 'WAIVED');
  });
  await test('ack SQL race: committed retirement makes waiting acknowledgement unavailable', async () => {
    const p = await fixture(); await race(p, 'policy', tx => tx.policyRecord.update({ where: { id: p.id }, data: { status: 'RETIRED' } }), 404); assert.equal((await assignment(p.id)).status, 'PENDING');
  });

  await test('preview API: private assigned snapshot is read-only and rejects unassigned/anonymous requests', async () => {
    const p = await fixture(), view = await preview(p.id); assert.equal(view.status, 200);
    assert.deepEqual(view.body.data, { id: p.id, title: p.title, version: p.version, contentHash: p.contentHash, contentMarkdown: p.contentMarkdown });
    assert.equal(view.headers.get('cache-control'), 'private, no-store'); assert.ok(view.headers.get('vary').split(',').map(v => v.trim().toLowerCase()).includes('cookie'), 'Next.js may add RSC Vary tokens; Cookie must remain present');
    assert.equal((await preview(p.id, true)).status, 401); assert.equal((await preview((await fixture({ assignmentStatus: null })).id)).status, 404); assert.equal((await rows(p.id)).length, 0);
  });
  await test('ack API: missing snapshot and stale version/hash fail before evidence creation', async () => {
    const p = await fixture(); assert.equal((await post(p.id, { noBody: true })).status, 400);
    assert.equal((await post(p.id, { body: { policyVersion: 'old' } })).status, 409); assert.equal((await post(p.id, { body: { contentHash: '0'.repeat(64) } })).status, 409);
    assert.equal((await rows(p.id)).length, 0);
  });
  await test('ack SQL race: same-version content edit rejects the previously read hash', async () => {
    const p = await fixture(), changed = p.contentMarkdown + ' revised';
    await race(p, 'policy', tx => tx.policyRecord.update({ where: { id: p.id }, data: { contentMarkdown: changed, contentHash: hash(changed) } }), 409);
    assert.equal((await assignment(p.id)).status, 'PENDING');
  });
  await test('ack SQL race: version change rejects the previously read version', async () => {
    const p = await fixture(); await race(p, 'policy', tx => tx.policyRecord.update({ where: { id: p.id }, data: { version: '2.0' } }), 409);
  });
  await test('ack API: inconsistent content hash and legacy unbound receipts are not silently repaired', async () => {
    const corrupt = await fixture({ policy: { contentHash: '0'.repeat(64) } }); assert.equal((await preview(corrupt.id)).status, 409); assert.equal((await post(corrupt.id)).status, 409);
    const p = await fixture({ assignmentStatus: 'ACKNOWLEDGED' });
    const old = await db.policyAcknowledgement.create({ data: { tenantId, policyId: p.id, employmentId, policyVersion: p.version, acknowledgedBy: userId } });
    assert.equal((await post(p.id)).status, 409); assert.deepEqual((await rows(p.id))[0], old); assert.equal(await auditCount(old.id), 0);
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
  await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  assert.equal((await context.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: userId, password } })).status(), 200);
  await context.addCookies([{ name: 'hrbp-locale', value: 'en', url: origin }]);
  await context.addInitScript(() => { localStorage.setItem('hrbp-locale', 'en'); localStorage.setItem('hrbp-theme', 'light'); });
  const page = await context.newPage();
  async function ready() { assert.equal((await page.goto(origin + '/module/policies', { waitUntil: 'load' })).status(), 200); await page.locator('.app-shell[data-session-loading="false"]').waitFor(); }
  const row = p => page.getByRole('row').filter({ hasText: p.code });
  async function open(p, consent = true) {
    await row(p).getByRole('button', { name: 'Read policy', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.locator('[data-policy-content]').waitFor();
    if (consent) await dialog.getByRole('checkbox', { name: 'I have read this version', exact: true }).check();
    return dialog;
  }
  async function clickAck(p) {
    page.once('dialog', d => d.accept());
    const [r] = await Promise.all([page.waitForResponse(v => new URL(v.url()).pathname === `/api/policies/${p.id}/acknowledgements` && v.request().method() === 'POST'), page.getByRole('dialog').getByRole('button', { name: 'Acknowledge', exact: true }).click()]);
    return r;
  }
  await test('ack browser: previously opened pending screen cannot turn a later waiver into acknowledgement', async () => {
    const p = await fixture(); await ready(); const dialog = await open(p);
    await db.policyAssignment.update({ where: { policyId_employmentId: { policyId: p.id, employmentId } }, data: { status: 'WAIVED' } });
    assert.equal((await clickAck(p)).status(), 409); await dialog.getByRole('alert').waitFor(); assert.equal(await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).isDisabled(), true);
    assert.equal((await rows(p.id)).length, 0); assert.equal((await assignment(p.id)).status, 'WAIVED');
    await page.screenshot({ path: `${out}/stale-waiver-rejected.jpg`, type: 'jpeg', quality: 75 });
    await ready(); await row(p).locator('[data-policy-ack-state="waived"]').waitFor(); return { screenshot: 'stale-waiver-rejected.jpg' };
  });
  await test('ack browser: lost response after actual commit preserves receipt and guard after closing/reopening', async () => {
    const p = await fixture(); await ready(); await open(p); const url = `${origin}/api/policies/${p.id}/acknowledgements`; let writes = 0;
    await page.route(url, async route => { if (route.request().method() !== 'POST') return route.continue(); writes++; const response = await route.fetch(); assert.equal(response.status(), 201); await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Synthetic lost response' }); });
    try {
      await clickAck(p); await page.getByRole('dialog').getByRole('alert').waitFor(); assert.match(await page.getByRole('dialog').innerText(), /could not be confirmed/);
      const before = (await rows(p.id))[0]; assert.ok(before); assert.equal((await post(p.id)).body.meta.replayed, true);
      assert.deepEqual((await rows(p.id))[0], before); assert.equal(await auditCount(before.id), 1);
      await page.keyboard.press('Escape'); await row(p).getByRole('button', { name: 'Read policy', exact: true }).click();
      assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Acknowledge', exact: true }).isDisabled(), true); assert.equal(writes, 1);
      await ready(); await row(p).locator('[data-policy-ack-state="acknowledged"]').waitFor();
    } finally { await page.unroute(url); }
  });
  await test('reader: requires consent, escapes policy markup, restores focus on Escape and fits 320px', async () => {
    const p = await fixture({ policy: { contentMarkdown: '# Synthetic policy\n<img src="https://example.invalid/test" onerror="window.policyXss=1">\nRead only this content.' } });
    await ready(); const dialog = await open(p, false); assert.equal(await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).isDisabled(), true);
    assert.equal(await dialog.locator('img, script, iframe').count(), 0); assert.equal(await page.evaluate(() => window.policyXss), undefined);
    assert.equal(await dialog.locator('[data-policy-content]').innerText(), p.contentMarkdown);
    await page.setViewportSize({ width: 320, height: 800 }); const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 320);
    await page.screenshot({ path: `${out}/policy-reader-320.jpg`, type: 'jpeg', quality: 75 });
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false); assert.equal(await row(p).getByRole('button', { name: 'Read policy', exact: true }).evaluate(e => e === document.activeElement), true);
    assert.equal((await rows(p.id)).length, 0); await page.setViewportSize({ width: 1440, height: 1000 }); return { screenshot: 'policy-reader-320.jpg' };
  });
  await test('reader: failed preview needs explicit read retry and never enables acknowledgement', async () => {
    const p = await fixture(); await ready(); const url = `${origin}/api/policies/${p.id}/acknowledgements`; let reads = 0;
    await page.route(url, r => { reads++; return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); });
    try {
      await row(p).getByRole('button', { name: 'Read policy', exact: true }).click(); await page.getByRole('dialog').getByRole('alert').waitFor();
      assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Acknowledge', exact: true }).count(), 0); assert.equal(reads, 1);
      await page.getByRole('dialog').getByRole('button', { name: 'Retry reading', exact: true }).click(); await page.getByRole('dialog').getByRole('alert').waitFor(); assert.equal(reads, 2);
      assert.equal((await rows(p.id)).length, 0);
    } finally { await page.unroute(url); await page.keyboard.press('Escape'); }
  });
  await test('reader: changing content after preview cannot acknowledge unseen bytes', async () => {
    const p = await fixture(); await ready(); const dialog = await open(p);
    const text = 'Changed after employee opened document'; await db.policyRecord.update({ where: { id: p.id }, data: { contentMarkdown: text, contentHash: hash(text) } });
    assert.equal((await clickAck(p)).status(), 409); await dialog.getByRole('alert').waitFor(); assert.equal((await rows(p.id)).length, 0);
    assert.equal(await dialog.locator('[data-policy-content]').innerText(), p.contentMarkdown);
    await page.screenshot({ path: `${out}/content-changed-rejected.jpg`, type: 'jpeg', quality: 75 }); return { screenshot: 'content-changed-rejected.jpg' };
  });
  await test('reader: EN/TR labelled dialogs fit narrow light/dark viewports', async () => {
    const p = await fixture(); const screenshots = [];
    for (const locale of ['en', 'tr']) for (const [width, theme] of [[320, 'light'], [390, 'dark']]) {
      const c = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' }); contexts.push(c);
      await c.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
      assert.equal((await c.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: userId, password } })).status(), 200);
      await c.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
      await c.addInitScript(({ locale, theme }) => { localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme); }, { locale, theme });
      const view = await c.newPage(); await view.goto(origin + '/module/policies', { waitUntil: 'load' });
      await view.locator('.app-shell[data-session-loading="false"]').waitFor();
      await view.waitForFunction(({ locale, theme }) => document.documentElement.lang === locale && document.documentElement.dataset.theme === theme, { locale, theme });
      await view.getByRole('row').filter({ hasText: p.code }).getByRole('button', { name: locale === 'tr' ? 'Politikayı oku' : 'Read policy', exact: true }).click();
      const dialog = view.getByRole('dialog', { name: locale === 'tr' ? 'Politika içeriği' : 'Policy content', exact: true });
      await dialog.locator('[data-policy-content]').waitFor();
      await dialog.getByRole('checkbox', { name: locale === 'tr' ? 'Bu sürümü okudum' : 'I have read this version', exact: true }).check();
      const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
      const screenshot = `reader-${locale}-${theme}-${width}.jpg`; await view.screenshot({ path: `${out}/${screenshot}`, type: 'jpeg', quality: 75 }); screenshots.push(screenshot);
      await view.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false); await c.close();
    }
    assert.equal((await rows(p.id)).length, 0); return { screenshots };
  });
  await test('ack SQL race: termination committed after session verification cannot be acknowledged', async () => {
    const p = await fixture(); await race(p, 'employment', tx => tx.employment.update({ where: { id: employmentId }, data: { status: 'TERMINATED' } }), 404);
    assert.equal((await assignment(p.id)).status, 'PENDING'); assert.equal((await post(p.id)).status, 401);
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(v => v.passed).length, failed: report.tests.filter(v => !v.passed).length };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log('ACK_SUMMARY ' + JSON.stringify(report.summary));
  if (report.summary.failed) process.exitCode = 1;
}
