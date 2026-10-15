/** Real policy review/acknowledgement UI on disposable loopback fixtures only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
const out = '.audit/policy-ui'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Production Next.js, Chromium, synthetic identities/policies on disposable PostgreSQL. No real provider/customer mutations.',
  limitations: ['UI click/receipt guard is not backend idempotency.', 'No claim of version-locking against edits in another session.', 'Policy fixtures are authored through API, not a new create-policy form.'] };
const db = new PrismaClient(), browser = await chromium.launch();
const marker = 'pui-' + randomUUID().slice(0, 8), contexts = [];
const authorId = marker + '-author', reviewerId = marker + '-reviewer', employeeId = marker + '-employee';
let tenantId, employmentId;
async function ctx(identifier, role, locale = 'en') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (identifier) {
    const response = await context.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier, password } });
    assert.equal(response.status(), 200, 'synthetic sign-in');
    const session = await (await context.request.get(origin + '/api/auth/session')).json();
    assert.equal(session.authenticated, true); assert.equal(session.user.role, role);
  }
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await context.addInitScript(value => { localStorage.setItem('hrbp-locale', value); localStorage.setItem('hrbp-theme', 'light'); }, locale);
  return context;
}
async function ready(page) {
  const response = await page.goto(origin + '/module/policies', { waitUntil: 'load', timeout: 25000 }); assert.equal(response.status(), 200);
  await page.locator('.app-shell[data-session-loading="false"]').waitFor({ timeout: 12000 }); await page.evaluate(() => document.fonts.ready);
}
async function shot(page, name) {
  const filename = `${name}.jpg`; await page.screenshot({ path: `${out}/${filename}`, type: 'jpeg', quality: 72, fullPage: true }); return filename;
}
async function test(name, page, run) {
  try { report.tests.push({ name, passed: true, ...await run() }); }
  catch (error) { report.tests.push({ name, passed: false, error: String(error.message).replaceAll(password, '[redacted]').slice(0, 500), screenshot: await shot(page, 'failure-' + report.tests.length).catch(() => null) }); }
  console.log('POLICY_SCENARIO ' + JSON.stringify(report.tests.at(-1)));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
function review(page, id) { return page.locator(`[data-policy-review="${id}"]`); }
function row(page, policy) { return page.getByRole('row').filter({ hasText: policy.code }); }
async function act(page, id, label, endpoint = 'review') {
  page.once('dialog', dialog => dialog.accept());
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === `/api/policies/${id}/${endpoint}` && r.request().method() === 'POST', { timeout: 15000 }),
    review(page, id).getByRole('button', { name: label, exact: true }).click()
  ]);
  return response;
}
async function status(id) { return (await db.policyRecord.findUniqueOrThrow({ where: { id } })).status; }
async function fixture(context, suffix) {
  const response = await context.request.post(origin + '/api/policies', { headers: { origin }, data: {
    code: `${marker}-${suffix}`, title: `${marker} synthetic ${suffix}`, version: '1.0', jurisdiction: 'Global',
    contentMarkdown: 'Synthetic test policy. No employee records or external delivery.', effectiveFrom: new Date(Date.now() - 3600000).toISOString()
  } });
  assert.equal(response.status(), 201); return (await response.json()).data;
}
async function audits(policyId, action) { return db.auditEvent.count({ where: { tenantId, resourceId: policyId, action } }); }
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  tenantId = template.tenantId; assert.ok(template.localPasswordHash);
  for (const [id, role] of [[authorId, 'HR_OPERATIONS'], [reviewerId, 'LEGAL'], [employeeId, 'EMPLOYEE']]) {
    await db.userAccount.create({ data: { id, tenantId, subject: id, role, displayName: 'Synthetic Policy QA', email: id + '@example.test', active: true,
      localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  }
  const position = await db.position.findFirstOrThrow({ where: { tenantId, validTo: null }, select: { id: true } });
  const person = await db.person.create({ data: { tenantId, employeeNumber: marker.toUpperCase(), givenName: 'Synthetic', familyName: marker,
    workEmail: employeeId + '@example.test', classification: 'CONFIDENTIAL' } });
  const employment = await db.employment.create({ data: { tenantId, personId: person.id, positionId: position.id, status: 'ACTIVE', startDate: new Date(Date.now() - 86400000) } });
  employmentId = employment.id;
  const author = await ctx(authorId, 'HR_OPERATIONS'), reviewer = await ctx(reviewerId, 'LEGAL'), employee = await ctx(employeeId, 'EMPLOYEE');
  const authorPage = await author.newPage(), reviewerPage = await reviewer.newPage(), employeePage = await employee.newPage();
  const policy = await fixture(author, 'lifecycle');
  await test('policy: cancel review submission without any write', authorPage, async () => {
    await ready(authorPage); let writes = 0; const listener = r => { if (r.method() === 'POST' && r.url().includes('/review')) writes++; };
    authorPage.on('request', listener); authorPage.once('dialog', dialog => dialog.dismiss());
    try { await review(authorPage, policy.id).getByRole('button', { name: 'Submit', exact: true }).click(); assert.equal(writes, 0); assert.equal(await status(policy.id), 'DRAFT'); }
    finally { authorPage.off('request', listener); }
  });
  await test('policy: submit draft through UI and persist REVIEW', authorPage, async () => {
    assert.equal((await act(authorPage, policy.id, 'Submit')).status(), 200); assert.equal(await status(policy.id), 'REVIEW');
  });
  await test('policy: owner cannot approve in UI or by direct API', authorPage, async () => {
    await ready(authorPage); assert.equal(await review(authorPage, policy.id).getByRole('button', { name: 'Approve', exact: true }).count(), 0);
    const response = await author.request.post(`${origin}/api/policies/${policy.id}/review`, { headers: { origin }, data: { action: 'APPROVE' } });
    assert.equal(response.status(), 403); assert.equal(await status(policy.id), 'REVIEW');
  });
  await test('policy: independent reviewer returns record to DRAFT', reviewerPage, async () => {
    await ready(reviewerPage); assert.equal((await act(reviewerPage, policy.id, 'Changes')).status(), 200); assert.equal(await status(policy.id), 'DRAFT');
  });
  await test('policy: resubmit and independent approval persist the correct approver', reviewerPage, async () => {
    await ready(authorPage); assert.equal((await act(authorPage, policy.id, 'Submit')).status(), 200);
    await ready(reviewerPage); assert.equal((await act(reviewerPage, policy.id, 'Approve')).status(), 200);
    const record = await db.policyRecord.findUniqueOrThrow({ where: { id: policy.id } }); assert.equal(record.status, 'APPROVED'); assert.equal(record.approvedById, reviewerId);
  });
  await test('policy: cancel publication retains APPROVED', authorPage, async () => {
    await ready(authorPage); authorPage.once('dialog', d => d.dismiss());
    await review(authorPage, policy.id).getByRole('button', { name: 'Publish', exact: true }).click(); assert.equal(await status(policy.id), 'APPROVED');
  });
  await test('policy: publication through UI survives reload', authorPage, async () => {
    assert.equal((await act(authorPage, policy.id, 'Publish', 'publish')).status(), 200); assert.equal(await status(policy.id), 'PUBLISHED');
    await ready(authorPage); assert.equal(await review(authorPage, policy.id).getByRole('button', { name: 'Publish', exact: true }).count(), 0);
    return { screenshot: await shot(authorPage, 'published-policy') };
  });
  await db.policyAssignment.create({ data: { tenantId, policyId: policy.id, employmentId, status: 'PENDING' } });
  await test('policy: employee can read its assignment but cannot review', employeePage, async () => {
    await ready(employeePage); await row(employeePage, policy).waitFor();
    assert.equal(await row(employeePage, policy).locator('[data-policy-review]').count(), 0);
    const response = await employee.request.post(`${origin}/api/policies/${policy.id}/review`, { headers: { origin }, data: { action: 'APPROVE' } }); assert.equal(response.status(), 403);
  });
  await test('policy: cancelling acknowledgement creates no receipt', employeePage, async () => {
    employeePage.once('dialog', d => d.dismiss()); await row(employeePage, policy).getByRole('button', { name: 'Acknowledge', exact: true }).click();
    assert.equal(await db.policyAcknowledgement.count({ where: { policyId: policy.id, employmentId } }), 0);
  });
  await test('policy: double-click acknowledgement sends one request and persists one receipt', employeePage, async () => {
    let writes = 0; const listener = r => { if (r.method() === 'POST' && r.url().includes(`/policies/${policy.id}/acknowledgements`)) writes++; };
    employeePage.on('request', listener); employeePage.once('dialog', d => d.accept());
    try {
      const [response] = await Promise.all([
        employeePage.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/policies/${policy.id}/acknowledgements`),
        row(employeePage, policy).getByRole('button', { name: 'Acknowledge', exact: true }).evaluate(button => { button.click(); button.click(); })
      ]);
      assert.equal(response.status(), 201); assert.equal(writes, 1);
      const saved = await db.policyAcknowledgement.findMany({ where: { policyId: policy.id, employmentId } }); assert.equal(saved.length, 1); assert.equal(saved[0].policyVersion, policy.version);
      await ready(employeePage); await row(employeePage, policy).locator('[data-policy-ack-state="acknowledged"]').waitFor();
    } finally { employeePage.off('request', listener); }
  });
  const uncertain = await fixture(author, 'lost-response');
  await test('policy: committed submission with wrong-id reply does not auto-replay or report success', authorPage, async () => {
    await ready(authorPage); let writes = 0;
    const url = `${origin}/api/policies/${uncertain.id}/review`;
    await authorPage.route(url, async route => {
      writes++; const response = await route.fetch(); assert.equal(response.status(), 200);
      const value = await response.json(); await route.fulfill({ response, json: { data: { ...value.data, id: 'different-policy' } } });
    });
    try {
      await act(authorPage, uncertain.id, 'Submit');
      const area = review(authorPage, uncertain.id); await area.getByRole('alert').waitFor(); assert.match(await area.innerText(), /could not be confirmed/);
      assert.equal(await area.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
      await area.getByRole('button', { name: 'Submit', exact: true }).evaluate(button => button.click());
      assert.equal(writes, 1); assert.equal(await status(uncertain.id), 'REVIEW');
      assert.equal(await audits(uncertain.id, 'policy.review-submitted'), 1);
      await area.getByRole('button', { name: 'Reload current record', exact: true }).click();
      await authorPage.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.equal(await review(authorPage, uncertain.id).getByRole('button', { name: 'Submit', exact: true }).count(), 0); assert.equal(writes, 1);
    } finally { await authorPage.unroute(url); }
  });
  const stale = await fixture(author, 'stale-state');
  await test('policy: state conflict stays visible and requires read-only refresh', authorPage, async () => {
    await ready(authorPage);
    assert.equal((await author.request.post(`${origin}/api/policies/${stale.id}/review`, { headers: { origin }, data: { action: 'SUBMIT' } })).status(), 200);
    assert.equal((await act(authorPage, stale.id, 'Submit')).status(), 409);
    const area = review(authorPage, stale.id); await area.getByRole('alert').waitFor(); assert.match(await area.innerText(), /state changed/);
    assert.equal(await area.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true); assert.equal(await status(stale.id), 'REVIEW');
  });
  const waived = await fixture(author, 'waived');
  // Explicit synthetic waiver fixture, not an external business approval.
  await db.policyRecord.update({ where: { id: waived.id }, data: { status: 'PUBLISHED', approvedById: reviewerId, approvedAt: new Date(), publishedAt: new Date() } });
  await db.policyAssignment.create({ data: { tenantId, policyId: waived.id, employmentId, status: 'WAIVED' } });
  const trContext = await ctx(employeeId, 'EMPLOYEE', 'tr'), trPage = await trContext.newPage();
  await test('policy: Turkish waived assignment displays Muaf, not an acknowledgement or action', trPage, async () => {
    await ready(trPage); await trPage.waitForFunction(() => document.documentElement.lang === 'tr');
    const badge = row(trPage, waived).locator('[data-policy-ack-state="waived"]'); await badge.waitFor(); assert.match(await badge.innerText(), /Muaf/);
    const acknowledgementMetric = trPage.locator('.services-metric').filter({ hasText: 'Onaylama oranı' });
    assert.equal(await acknowledgementMetric.locator('strong').innerText(), '50%', 'one acknowledgement plus one waiver is not two acknowledgements');
    assert.equal(await row(trPage, waived).getByRole('button', { name: 'Okudum / Onayla', exact: true }).count(), 0);
    assert.equal(await db.policyAcknowledgement.count({ where: { policyId: waived.id, employmentId } }), 0);
    return { screenshot: await shot(trPage, 'waived-not-acknowledged-tr') };
  });
  await test('policy: anonymous review remains unauthorized', authorPage, async () => {
    const anonymous = await ctx(null);
    const response = await anonymous.request.post(`${origin}/api/policies/${policy.id}/review`, { headers: { origin }, data: { action: 'APPROVE' } }); assert.equal(response.status(), 401);
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log('POLICY_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.some(t => !t.passed)) process.exitCode = 1;
