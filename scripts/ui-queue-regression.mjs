/** Service-queue UI lifecycle and real PostgreSQL owner races; fixtures only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
const origin = 'http://localhost:3100', url = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); assert.equal(url.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/queue-ui'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  limitations: ['Only generated service queues/accounts in disposable loopback PostgreSQL.', 'Queue ownership is not a grant of platform roles.', 'No production/customer/provider calls.'] };
const db = new PrismaClient(), browser = await chromium.launch();
const prefix = 'QAQUEUE-' + randomUUID().slice(0, 8).toUpperCase();
const name = prefix + ' queue', owner = prefix + '-owner', agent = prefix + '-agent', reader = prefix + '-reader';
let queueId, membershipId;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
const page = await context.newPage();
const root = page.locator('[data-queue-admin-state]');
const region = root.getByRole('region', { name: 'Selected queue' });
const save = () => root.getByRole('button', { name: 'Save', exact: true });
const post = (path, data) => context.request.post(origin + path, { headers: { origin, 'x-purpose': 'Synthetic service queue QA' }, data });
const del = path => context.request.delete(origin + path, { headers: { origin, 'x-purpose': 'Synthetic service queue QA' } });
async function login(ctx, identifier) {
  const r = await ctx.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: identifier.toLowerCase(), password } });
  assert.equal(r.status(), 200);
}
async function ready() {
  await page.goto(origin + '/module/hr-service', { waitUntil: 'load' });
  await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await page.locator('[data-queue-admin-state="ready"]').waitFor();
}
async function selected() {
  await page.locator('[data-queue-admin-state="ready"]').waitFor();
  await region.getByText(name, { exact: true }).waitFor();
}
async function mutation(path, method, click) {
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method), click()]);
  return response;
}
async function test(name, fn) {
  const row = { name, passed: false };
  try { if (report.tests.length > 1) assert.ok(queueId, "Create scenario did not establish a synthetic queue"); await fn(); row.passed = true; }
  catch (e) { row.error = String(e.message).replaceAll(password, '[redacted]').slice(0, 600); }
  row.screenshot = `queue-${report.tests.length}.jpg`;
  await page.screenshot({ path: `${out}/${row.screenshot}`, type: 'jpeg', quality: 78 }).catch(() => {});
  report.tests.push(row); console.log('QUEUE_SCENARIO ' + JSON.stringify(row));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
try {
  const admin = await db.userAccount.findUnique({ where: { id: 'user-local-test-admin' } });
  assert.ok(admin?.localPasswordHash);
  for (const [id, role] of [[owner, 'HR_OPERATIONS'], [agent, 'HR_OPERATIONS'], [reader, 'EMPLOYEE']]) {
    await db.userAccount.create({ data: { id, tenantId: admin.tenantId, subject: id.toLowerCase(), role, displayName: id,
      email: id.toLowerCase() + '@example.test', active: true, localAuthEnabled: true, localPasswordHash: admin.localPasswordHash } });
  }
  await login(context, 'local.admin'); await ready();
  await root.locator('summary').filter({ hasText: 'Create queue' }).click();
  await test('queue: empty create validates locally without POST', async () => {
    let writes = 0; const count = r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/hr-service/queues') writes++; };
    page.on('request', count);
    try { await root.getByRole('button', { name: 'Create', exact: true }).click(); await root.getByRole('alert').waitFor(); assert.equal(writes, 0); }
    finally { page.off('request', count); }
  });
  async function fill() {
    await root.getByLabel('Queue key', { exact: true }).fill(prefix);
    await root.getByLabel('Queue name', { exact: true }).fill(name);
    await root.getByLabel('SLA minutes', { exact: true }).fill('60');
    await root.getByLabel('Queue owner', { exact: true }).selectOption(owner);
  }
  await test('queue: create via UI selects persisted queue and initial owner', async () => {
    await fill();
    const r = await mutation('/api/hr-service/queues', 'POST', () => root.getByRole('button', { name: 'Create', exact: true }).click());
    assert.equal(r.status(), 201); queueId = (await r.json()).data.id; await selected();
    const stored = await db.hRServiceQueue.findUnique({ where: { id: queueId }, include: { memberships: true } });
    assert.equal(stored.key, prefix); assert.equal(stored.defaultSlaMinutes, 60);
    assert.equal(stored.memberships.length, 1); assert.equal(stored.memberships[0].userId, owner); assert.equal(stored.memberships[0].role, 'OWNER');
  });
  await test('queue: duplicate key preserves draft and does not create another row', async () => {
    assert.ok(queueId); await fill();
    const r = await mutation('/api/hr-service/queues', 'POST', () => root.getByRole('button', { name: 'Create', exact: true }).click());
    assert.equal(r.status(), 409); await root.getByRole('alert').waitFor();
    assert.equal(await root.getByLabel('Queue key', { exact: true }).inputValue(), prefix);
    assert.equal(await db.hRServiceQueue.count({ where: { tenantId: admin.tenantId, key: prefix } }), 1);
  });
  await root.locator('summary').filter({ hasText: 'Add or update member' }).click();
  async function chooseMember(id, role) {
    await root.getByLabel('Queue member', { exact: true }).selectOption(id); await root.getByLabel('Queue role', { exact: true }).selectOption(role);
  }
  await test('queue: add agent and change role without duplicate memberships', async () => {
    await chooseMember(agent, 'AGENT');
    let r = await mutation(`/api/hr-service/queues/${queueId}/members`, 'POST', () => save().click());
    assert.equal(r.status(), 201); membershipId = (await r.json()).data.id; await selected();
    await root.locator(`[data-queue-member-id="${membershipId}"]`).waitFor();
    await chooseMember(agent, 'OWNER');
    r = await mutation(`/api/hr-service/queues/${queueId}/members`, 'POST', () => save().click());
    assert.equal(r.status(), 201); assert.equal((await r.json()).data.id, membershipId); await selected();
    assert.equal(await db.hRServiceQueueMembership.count({ where: { queueId, userId: agent } }), 1);
    assert.equal((await db.hRServiceQueueMembership.findUnique({ where: { id: membershipId } })).role, 'OWNER');
  });
  await test('queue: cancelling member removal sends no DELETE and preserves membership', async () => {
    let writes = 0; const count = r => { if (r.method() === 'DELETE') writes++; }; page.on('request', count);
    try {
      page.once('dialog', d => d.dismiss()); await root.getByRole('button', { name: `Remove ${agent}`, exact: true }).click();
      assert.equal(writes, 0); assert.ok(await db.hRServiceQueueMembership.findUnique({ where: { id: membershipId } }));
    } finally { page.off('request', count); }
  });
  await test('queue: confirmed removal deletes the selected member and survives refresh', async () => {
    page.once('dialog', d => d.accept());
    const r = await mutation(`/api/hr-service/queues/${queueId}/members/${membershipId}`, 'DELETE', () => root.getByRole('button', { name: `Remove ${agent}`, exact: true }).click());
    assert.equal(r.status(), 200); await selected(); assert.equal(await db.hRServiceQueueMembership.findUnique({ where: { id: membershipId } }), null);
  });
  await test('queue: last owner cannot be demoted through UI', async () => {
    await chooseMember(owner, 'AGENT');
    const r = await mutation(`/api/hr-service/queues/${queueId}/members`, 'POST', () => save().click());
    assert.equal(r.status(), 409); await root.getByRole('alert').filter({ hasText: 'Assign another owner' }).waitFor();
    assert.equal(await db.hRServiceQueueMembership.count({ where: { queueId, role: 'OWNER' } }), 1);
  });
  await test('queue: last owner removal is rejected after confirmation', async () => {
    const ownerRow = await db.hRServiceQueueMembership.findFirst({ where: { queueId, userId: owner } });
    page.once('dialog', d => d.accept());
    const r = await mutation(`/api/hr-service/queues/${queueId}/members/${ownerRow.id}`, 'DELETE', () => root.getByRole('button', { name: `Remove ${owner}`, exact: true }).click());
    assert.equal(r.status(), 409); assert.ok(await db.hRServiceQueueMembership.findUnique({ where: { id: ownerRow.id } }));
  });
  await test('queue: disable/re-enable is persisted, with cancellation and inactive edit guard', async () => {
    page.once('dialog', d => d.dismiss()); await root.getByRole('button', { name: 'Disable queue', exact: true }).click();
    assert.equal((await db.hRServiceQueue.findUnique({ where: { id: queueId } })).active, true);
    for (const [label, value] of [['Disable queue', false], ['Enable queue', true]]) {
      page.once('dialog', d => d.accept());
      const r = await mutation(`/api/hr-service/queues/${queueId}`, 'PATCH', () => root.getByRole('button', { name: label, exact: true }).click());
      assert.equal(r.status(), 200); await selected();
      assert.equal((await db.hRServiceQueue.findUnique({ where: { id: queueId } })).active, value);
      if (!value) assert.equal(await save().isDisabled(), true);
    }
  });
  await test('queue: unconfirmed response prevents replay and preserves draft after actual commit', async () => {
    await chooseMember(agent, 'AGENT'); let writes = 0;
    const path = `/api/hr-service/queues/${queueId}/members`;
    await page.route('**' + path, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++; const r = await route.fetch(); assert.equal(r.status(), 201);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'unmatched-receipt' } }) });
    });
    try {
      await save().evaluate(button => { button.click(); button.click(); });
      await page.locator('[data-queue-admin-state="unconfirmed"]').waitFor();
      assert.equal(writes, 1); assert.equal(await save().isDisabled(), true);
      assert.equal(await root.getByLabel('Queue member', { exact: true }).inputValue(), agent);
      assert.equal(await db.hRServiceQueueMembership.count({ where: { queueId, userId: agent } }), 1);
    } finally { await page.unroute('**' + path); }
    await root.getByRole('button', { name: 'Reload page', exact: true }).click();
    await page.locator('[data-queue-admin-state="ready"]').waitFor();
  });
  await test('queue: open EN/TR create and membership forms fit 320px and 390px', async () => {
    for (const lang of ['en', 'tr']) {
      await page.locator('.locale-toggle button').filter({ hasText: lang.toUpperCase() }).click();
      await page.waitForFunction(v => document.documentElement.lang === v, lang);
      for (const details of await root.locator('details').all()) if (!(await details.getAttribute('open'))) {
        if (!(await details.evaluate(el => el.open))) await details.locator('summary').click();
      }
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
        await page.screenshot({ path: `${out}/queue-form-${lang}-${width}.jpg`, type: 'jpeg', quality: 80, fullPage: true });
      }
    }
  });
  await test('queue: concurrent delete/demote operations preserve an owner in real PostgreSQL', async () => {
    for (const mode of ['delete-delete', 'demote-demote', 'delete-demote']) {
      const response = await post('/api/hr-service/queues', { key: prefix + '-' + mode.toUpperCase(), name: prefix + ' ' + mode, ownerUserId: owner });
      assert.equal(response.status(), 201); const q = (await response.json()).data, a = q.memberships[0];
      const added = await post(`/api/hr-service/queues/${q.id}/members`, { userId: agent, role: 'OWNER' });
      assert.equal(added.status(), 201); const b = (await added.json()).data;
      const kinds = mode.split('-');
      const outcomes = await Promise.all([[a, owner], [b, agent]].map(([m, userId], i) => kinds[i] === 'delete'
        ? del(`/api/hr-service/queues/${q.id}/members/${m.id}`)
        : post(`/api/hr-service/queues/${q.id}/members`, { userId, role: 'AGENT' })));
      const statuses = outcomes.map(r => r.status());
      assert.equal(statuses.filter(s => s >= 200 && s < 300).length, 1, JSON.stringify(statuses));
      assert.equal(statuses.filter(s => s === 409).length, 1, JSON.stringify(statuses));
      assert.equal(await db.hRServiceQueueMembership.count({ where: { queueId: q.id, role: 'OWNER' } }), 1);
    }
  });
  await test('queue: anonymous and employee principals cannot manage memberships', async () => {
    const other = await browser.newContext();
    try {
      let r = await other.request.post(origin + `/api/hr-service/queues/${queueId}/members`, { headers: { origin }, data: { userId: agent, role: 'OWNER' } });
      assert.equal(r.status(), 401);
      await login(other, reader);
      r = await other.request.post(origin + `/api/hr-service/queues/${queueId}/members`, { headers: { origin }, data: { userId: agent, role: 'OWNER' } });
      assert.equal(r.status(), 403);
      const catalog = await other.request.get(origin + '/api/hr-service/queues');
      const value = await catalog.json(); assert.equal(value.permissions.manage, false); assert.deepEqual(value.data, []); assert.deepEqual(value.candidates, []);
    } finally { await other.close(); }
  });
} finally {
  await context.close(); await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log('QUEUE_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 13 || report.tests.some(t => !t.passed)) process.exitCode = 1;
