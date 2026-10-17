/** One real server-component refresh scenario, isolated from customer data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD;
assert.ok(password);
const out = '.audit/hr-service-revision-review';
await mkdir(out, { recursive: true });
const report = {
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Real locale server action, production Next.js, Chromium and disposable PostgreSQL.',
  tests: [],
  limitations: ['One preserved-draft refresh scenario, not whole-product visual or accessibility acceptance.']
};
const db = new PrismaClient();
const browser = await chromium.launch();
let context, page, ticket, tenantId;
const actorId = 'qa-review-' + randomUUID().slice(0, 8);
const result = { name: 'UI: locale refresh preserves a draft until explicit current-version review', passed: false };
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  tenantId = template.tenantId;
  assert.ok(template.localPasswordHash);
  await db.userAccount.create({ data: {
    id: actorId, tenantId, subject: actorId, email: actorId + '@example.test',
    displayName: 'Synthetic revision review', role: 'HR_OPERATIONS', active: true,
    localAuthEnabled: true, localPasswordHash: template.localPasswordHash
  } });
  ticket = await db.hRServiceRequest.create({ data: {
    tenantId, requestNumber: actorId, requestorId: actorId, category: 'QA',
    title: 'Synthetic revision review', description: 'Synthetic data only',
    status: 'IN_PROGRESS', priority: 'MEDIUM'
  } });
  context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  assert.equal((await context.request.post(origin + '/api/auth/local', {
    headers: { origin }, data: { identifier: actorId, password }
  })).status(), 200);
  await context.addCookies([{ name: 'hrbp-locale', value: 'en', url: origin }]);
  await context.addInitScript(() => {
    localStorage.setItem('hrbp-locale', 'en'); localStorage.setItem('hrbp-theme', 'light');
  });
  page = await context.newPage();
  assert.equal((await page.goto(origin + '/module/hr-service?request=' + ticket.id, { waitUntil: 'load' })).status(), 200);
  await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const actions = page.locator(`[data-hr-service-actions="${ticket.id}"]`);
  await actions.locator('summary').click();
  const draft = 'Synthetic draft preserved through a real server-component refresh';
  await actions.getByLabel('Reply or note', { exact: true }).fill(draft);
  const endpoint = `${origin}/api/hr-service/requests/${ticket.id}/comments`;
  const note = await context.request.post(endpoint, { headers: { origin }, data: {
    body: 'Synthetic concurrent note', visibility: 'PRIVATE_NOTE', expectedUpdatedAt: ticket.updatedAt.toISOString()
  } });
  assert.equal(note.status(), 201);
  const updatedAt = (await note.json()).data.writeReceipt.updatedAt;
  // Existing locale action re-renders server components without full navigation.
  await page.getByRole('group', { name: 'Language', exact: true }).getByRole('button', { name: 'TR', exact: true }).click();
  const review = actions.getByRole('button', { name: 'Kontrol ettiğim güncel sürümü kullan', exact: true });
  await review.waitFor();
  const input = actions.getByLabel('Yanıt veya not', { exact: true });
  const send = actions.getByRole('button', { name: 'Yanıt ekle', exact: true });
  assert.equal(await input.inputValue(), draft);
  assert.equal(await send.isDisabled(), true);
  assert.equal(await db.hRServiceComment.count({ where: { tenantId, requestId: ticket.id } }), 1);
  await review.scrollIntoViewIfNeeded();
  result.geometry = await review.evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { left: box.left, right: box.right, screen: innerWidth, height: box.height,
      radius: style.borderRadius, padding: style.paddingLeft, background: style.backgroundColor };
  });
  const geometry = result.geometry;
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.screen + 1, JSON.stringify(geometry));
  assert.ok(geometry.height >= 36);
  assert.equal(geometry.radius, '8px'); assert.equal(geometry.padding, '12px');
  assert.notEqual(geometry.background, 'rgba(0, 0, 0, 0)');
  result.screenshot = 'review-current-version-tr-light-390.jpg';
  await page.screenshot({ path: out + '/' + result.screenshot, type: 'jpeg', quality: 85 });
  await review.click();
  assert.equal(await input.inputValue(), draft);
  page.once('dialog', dialog => dialog.accept());
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === endpoint && r.request().method() === 'POST'), send.click()
  ]);
  assert.equal(response.request().postDataJSON().expectedUpdatedAt, updatedAt);
  assert.equal(response.status(), 201);
  const rows = await db.hRServiceComment.findMany({ where: { tenantId, requestId: ticket.id } });
  assert.equal(rows.length, 2); assert.equal(rows.filter(row => row.body === draft).length, 1);
  result.passed = true;
} catch (error) {
  result.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 800);
  if (page) {
    result.screenshot = 'review-failure.jpg';
    await page.screenshot({ path: out + '/' + result.screenshot, type: 'jpeg', quality: 80 }).catch(() => {});
  }
} finally {
  await context?.close().catch(() => {}); await browser.close();
  if (ticket) {
    await db.hRServiceComment.deleteMany({ where: { tenantId, requestId: ticket.id } });
    await db.hRServiceRequest.deleteMany({ where: { tenantId, id: ticket.id } });
  }
  if (tenantId) await db.userAccount.deleteMany({ where: { tenantId, id: actorId } });
  await db.$disconnect();
  report.tests.push(result);
  report.summary = { tests: 1, passed: result.passed ? 1 : 0, failed: result.passed ? 0 : 1 };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log('REVISION_REVIEW_SCENARIO ' + JSON.stringify(result));
}
if (!result.passed) process.exitCode = 1;
