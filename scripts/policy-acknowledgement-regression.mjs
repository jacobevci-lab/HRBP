/** Real acknowledgement API/SQL races and stale browser screens; disposable localhost only. */
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
  scope: 'Actual Next.js endpoint, PostgreSQL locks, real local-auth sessions and Chromium; synthetic disposable fixtures only.',
  limitations: ['Fixtures are inserted directly, not proof of policy authoring UI.', 'No customer, production or external-provider verification.', 'No client content-hash binding or complete exception lifecycle verification.'] };
const db = new PrismaClient(), browser = await chromium.launch();
const marker = 'ack-' + randomUUID().slice(0, 10), contexts = [];
let tenantId, employmentId, userId, cookie, sequence = 0;
async function post(policyId, options = {}) {
  const response = await fetch(`${origin}/api/policies/${encodeURIComponent(policyId)}/acknowledgements`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { origin, ...(options.anonymous ? {} : { cookie }), ...options.headers },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = { nonJson: true }; }
  return { status: response.status, body };
}
async function fixture({ policy: overrides = {}, assignmentStatus = 'PENDING', assignedEmploymentId = employmentId } = {}) {
  const code = `${marker}-${++sequence}`;
  const policy = await db.policyRecord.create({ data: {
    tenantId, code, title: `Synthetic ${code}`, version: '1.0', ownerId: userId,
    contentMarkdown: 'Synthetic policy for isolated acknowledgement testing.',
    contentHash: createHash('sha256').update('Synthetic policy for isolated acknowledgement testing.').digest('hex'),
    effectiveFrom: new Date(Date.now() - 86400000), status: 'PUBLISHED', ...overrides
  } });
  if (assignmentStatus) await db.policyAssignment.create({ data: { tenantId: policy.tenantId, policyId: policy.id, employmentId: assignedEmploymentId, status: assignmentStatus } });
  return policy;
}
async function rows(policyId) { return db.policyAcknowledgement.findMany({ where: { policyId } }); }
async function assignment(policyId) { return db.policyAssignment.findUniqueOrThrow({ where: { policyId_employmentId: { policyId, employmentId } } }); }
async function auditCount(id) { return db.auditEvent.count({ where: { tenantId, resourceId: id, action: 'policy.acknowledged' } }); }
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
  const gate = new Promise(resolve => { release = resolve; });
  const locked = new Promise(resolve => { held = resolve; });
  const blocker = db.$transaction(async tx => { await mutate(tx); held(); await gate; }, { timeout: 10000 });
  let response;
  try {
    await Promise.race([locked, blocker.then(() => { throw Error('Writer exited before acquiring its lock'); })]);
    response = post(policy.id);
    await waitForLock(label);
    assert.equal((await rows(policy.id)).length, 0, 'No receipt may be inserted while its prerequisite writer is uncommitted');
  } finally { release(); await blocker; }
  assert.equal((await response).status, expected); assert.equal((await rows(policy.id)).length, 0);
}
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  assert.ok(template.localPasswordHash); tenantId = template.tenantId; userId = marker + '-employee';
  await db.userAccount.create({ data: { id: userId, tenantId, subject: userId, role: 'EMPLOYEE', displayName: 'Synthetic Acknowledgement QA',
    email: userId + '@example.test', active: true, localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  const person = await db.person.create({ data: { tenantId, employeeNumber: marker, givenName: 'Synthetic', familyName: marker, workEmail: userId + '@example.test' } });
  const employment = await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date(Date.now() - 86400000) } });
  employmentId = employment.id;
  const login = await fetch(origin + '/api/auth/local', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ identifier: userId, password }) });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);

  await test('ack API: anonymous and foreign-origin requests cannot write', async () => {
    const policy = await fixture(); assert.equal((await post(policy.id, { anonymous: true })).status, 401);
    assert.equal((await post(policy.id, { headers: { origin: 'https://example.invalid' } })).status, 403); assert.equal((await rows(policy.id)).length, 0);
  });
  for (const [name, options, expected] of [
    ['no assignment', { assignmentStatus: null }, 404], ['waived assignment', { assignmentStatus: 'WAIVED' }, 409],
    ['future effective date', { policy: { effectiveFrom: new Date(Date.now() + 86400000) } }, 404],
    ['expired policy', { policy: { effectiveTo: new Date(Date.now() - 60000) } }, 404],
    ['draft policy', { policy: { status: 'DRAFT' } }, 404], ['retired policy', { policy: { status: 'RETIRED' } }, 404],
    ['acknowledged status without an original receipt', { assignmentStatus: 'ACKNOWLEDGED' }, 409]
  ]) await test(`ack API: ${name} does not fabricate a receipt`, async () => {
    const policy = await fixture(options); const before = options.assignmentStatus === null ? null : await assignment(policy.id);
    assert.equal((await post(policy.id)).status, expected); assert.equal((await rows(policy.id)).length, 0);
    if (before) assert.deepEqual(await assignment(policy.id), before);
  });
  await test('ack API: body employmentId cannot override the verified employee', async () => {
    const targetPerson = await db.person.create({ data: { tenantId, employeeNumber: marker + '-other', givenName: 'Synthetic', familyName: 'Other' } });
    const target = await db.employment.create({ data: { tenantId, personId: targetPerson.id, status: 'ACTIVE', startDate: new Date() } });
    const policy = await fixture({ assignedEmploymentId: target.id });
    assert.equal((await post(policy.id, { headers: { 'content-type': 'application/json' }, body: { employmentId: target.id } })).status, 404);
    assert.equal((await rows(policy.id)).length, 0);
  });
  await test('ack API: foreign-tenant policy remains unavailable even with a matching employment string', async () => {
    const foreign = await db.tenant.create({ data: { name: 'Synthetic other tenant', region: 'EU' } });
    const policy = await fixture({ policy: { tenantId: foreign.id } });
    assert.equal((await post(policy.id)).status, 404); assert.equal((await rows(policy.id)).length, 0);
  });
  for (const status of ['PENDING', 'OVERDUE']) await test(`ack API: ${status} records one receipt and preserves it on sequential replay`, async () => {
    const policy = await fixture({ assignmentStatus: status }); const first = await post(policy.id);
    assert.equal(first.status, 201); assert.equal(first.body.meta.replayed, false); assert.equal(first.body.data.employmentId, employmentId);
    const before = (await rows(policy.id))[0]; assert.equal(await auditCount(before.id), 1);
    const second = await post(policy.id); assert.equal(second.status, 201); assert.equal(second.body.meta.replayed, true);
    assert.deepEqual(second.body.data, first.body.data); assert.deepEqual((await rows(policy.id))[0], before);
    assert.equal(await auditCount(before.id), 1); assert.equal((await assignment(policy.id)).status, 'ACKNOWLEDGED');
  });
  await test('ack API: eight concurrent requests produce one receipt and exactly one acknowledgement audit', async () => {
    const policy = await fixture(); const responses = await Promise.all(Array.from({ length: 8 }, () => post(policy.id)));
    assert.ok(responses.every(value => value.status === 201));
    assert.equal(responses.filter(value => value.body.meta.replayed === false).length, 1);
    assert.equal(responses.filter(value => value.body.meta.replayed === true).length, 7);
    for (const response of responses) assert.deepEqual(response.body.data, responses[0].body.data);
    const saved = await rows(policy.id); assert.equal(saved.length, 1); assert.equal(await auditCount(saved[0].id), 1);
    return { requests: 8, receipts: 1, acknowledgementAudits: 1 };
  });
  await test('ack API: an inconsistent pending assignment does not overwrite historical evidence', async () => {
    const policy = await fixture(); const first = await post(policy.id); assert.equal(first.status, 201);
    const before = (await rows(policy.id))[0]; await db.policyAssignment.update({ where: { policyId_employmentId: { policyId: policy.id, employmentId } }, data: { status: 'PENDING' } });
    assert.equal((await post(policy.id)).status, 409); assert.deepEqual((await rows(policy.id))[0], before);
    assert.equal(await auditCount(before.id), 1); assert.equal((await assignment(policy.id)).status, 'PENDING');
  });
  await test('ack SQL race: a committed waiver wins over the waiting acknowledgement', async () => {
    const policy = await fixture();
    await race(policy, 'assignment', tx => tx.policyAssignment.update({ where: { policyId_employmentId: { policyId: policy.id, employmentId } }, data: { status: 'WAIVED' } }), 409);
    assert.equal((await assignment(policy.id)).status, 'WAIVED');
  });
  await test('ack SQL race: a committed retirement makes the waiting acknowledgement unavailable', async () => {
    const policy = await fixture(); await race(policy, 'policy', tx => tx.policyRecord.update({ where: { id: policy.id }, data: { status: 'RETIRED' } }), 404);
    assert.equal((await assignment(policy.id)).status, 'PENDING');
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const signedIn = await context.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: userId, password } }); assert.equal(signedIn.status(), 200);
  await context.addCookies([{ name: 'hrbp-locale', value: 'en', url: origin }]);
  await context.addInitScript(() => { localStorage.setItem('hrbp-locale', 'en'); localStorage.setItem('hrbp-theme', 'light'); });
  const page = await context.newPage();
  async function ready() { const response = await page.goto(origin + '/module/policies', { waitUntil: 'load' }); assert.equal(response.status(), 200); await page.locator('.app-shell[data-session-loading="false"]').waitFor(); }
  const row = policy => page.getByRole('row').filter({ hasText: policy.code });
  await test('ack browser: a previously opened pending screen cannot turn a later waiver into acknowledgement', async () => {
    const policy = await fixture(); await ready(); await row(policy).getByRole('button', { name: 'Acknowledge', exact: true }).waitFor();
    await db.policyAssignment.update({ where: { policyId_employmentId: { policyId: policy.id, employmentId } }, data: { status: 'WAIVED' } });
    page.once('dialog', dialog => dialog.accept());
    const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === `/api/policies/${policy.id}/acknowledgements` && value.request().method() === 'POST'), row(policy).getByRole('button', { name: 'Acknowledge', exact: true }).click()]);
    assert.equal(response.status(), 409); await row(policy).getByRole('alert').waitFor();
    assert.equal(await row(policy).getByRole('button', { name: 'Acknowledge', exact: true }).isDisabled(), true);
    assert.equal((await rows(policy.id)).length, 0); assert.equal((await assignment(policy.id)).status, 'WAIVED');
    await page.screenshot({ path: `${out}/stale-waiver-rejected.jpg`, type: 'jpeg', quality: 75, fullPage: true });
    await ready(); await row(policy).locator('[data-policy-ack-state="waived"]').waitFor();
    return { screenshot: 'stale-waiver-rejected.jpg' };
  });
  await test('ack browser: lost response after actual commit is recovered without replacing the original receipt', async () => {
    const policy = await fixture(); await ready(); const url = `${origin}/api/policies/${policy.id}/acknowledgements`; let writes = 0;
    await page.route(url, async route => { writes++; const response = await route.fetch(); assert.equal(response.status(), 201); await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Synthetic lost acknowledgement response' }); });
    try {
      page.once('dialog', dialog => dialog.accept()); await row(policy).getByRole('button', { name: 'Acknowledge', exact: true }).click();
      await row(policy).getByRole('alert').waitFor(); assert.match(await row(policy).innerText(), /could not be confirmed/);
      assert.equal(await row(policy).getByRole('button', { name: 'Acknowledge', exact: true }).isDisabled(), true);
      const before = (await rows(policy.id))[0]; assert.ok(before); const replay = await post(policy.id);
      assert.equal(replay.status, 201); assert.equal(replay.body.meta.replayed, true); assert.equal(writes, 1);
      assert.deepEqual((await rows(policy.id))[0], before); assert.equal(await auditCount(before.id), 1);
      await ready(); await row(policy).locator('[data-policy-ack-state="acknowledged"]').waitFor();
    } finally { await page.unroute(url); }
  });
  await test('ack SQL race: termination committed after session verification cannot be acknowledged', async () => {
    const policy = await fixture();
    await race(policy, 'employment', tx => tx.employment.update({ where: { id: employmentId }, data: { status: 'TERMINATED' } }), 404);
    assert.equal((await assignment(policy.id)).status, 'PENDING');
    assert.equal((await post(policy.id)).status, 401, 'The now-terminated session is also rejected on a subsequent request');
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(value => value.passed).length, failed: report.tests.filter(value => !value.passed).length };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('ACK_SUMMARY ' + JSON.stringify(report.summary));
  if (report.summary.failed) process.exitCode = 1;
}
