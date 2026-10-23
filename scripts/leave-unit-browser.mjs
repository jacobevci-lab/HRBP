/** Real form/unit/receipt checks. Disposable local DB, signed employment sessions.
 * No calendar conversion, business-rule modification or external delivery. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit'); assert.equal(database.search, '');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/leave-unit'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  limitations: ['Disposable PostgreSQL/production Next.js/Chromium with signed synthetic employee sessions.',
    'No work-calendar, holiday, legal-entitlement or automatic day/hour conversion is tested or introduced.',
    'Post-commit response loss is an explicit browser transport injection; no SMTP or dispatcher is started.'] };
const db = new PrismaClient(), browser = await chromium.launch(), contexts = [];
const marker = 'qaunit-' + randomUUID().slice(0, 8), year = new Date().getUTCFullYear() + 2;
const c = (locale, en, tr) => locale === 'tr' ? tr : en;
async function check(name, page, fn) {
  const row = { name, passed: false };
  try { Object.assign(row, await fn(), { passed: true }); }
  catch (error) {
    row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 600);
    if (page) await page.screenshot({ path: `${out}/failure-${report.tests.length}.jpg`, fullPage: false }).catch(() => {});
  }
  report.tests.push(row); console.log('LEAVE_UNIT_CASE ' + JSON.stringify(row));
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
}
async function signed(id, employmentId, tenantId, locale, theme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }); contexts.push(ctx);
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const login = await ctx.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: id, password } });
  assert.equal(login.status(), 200, 'Synthetic local login must succeed');
  const session = await ctx.request.get(origin + '/api/auth/session'); const s = await session.json();
  assert.equal(s.authenticated, true); assert.equal(s.user.id, id); assert.equal(s.user.tenantId, tenantId);
  assert.equal(s.user.role, 'EMPLOYEE'); assert.equal(s.user.employmentId, employmentId);
  await ctx.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await ctx.addInitScript(({ locale, theme }) => { localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme); }, { locale, theme });
  return ctx;
}
async function screen(ctx, locale, theme) {
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  await page.goto(origin + '/module/leave', { waitUntil: 'networkidle' });
  await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.locator('.theme-toggle').click();
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  await page.locator('[data-leave-self-service]').waitFor(); return page;
}
try {
  const admin = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } });
  const tenantId = admin.tenantId; assert.ok(admin.localPasswordHash);
  const types = {};
  for (const [key, unit, approval, allowance] of [['day', 'DAYS', true, null], ['hour', 'HOURS', false, '8'], ['other', 'DAYS', false, null]]) {
    types[key] = await db.leaveType.create({ data: { tenantId, code: marker + '-' + key, name: 'Synthetic ' + key, unit, requiresApproval: approval, annualAllowance: allowance } });
  }
  let lastIdentity;
  for (const [locale, theme, width, month] of [['en', 'light', 1280, '06'], ['tr', 'dark', 390, '07']]) {
    const id = marker + '-' + locale; assert.ok(id.length <= 24);
    await db.userAccount.create({ data: { id, tenantId, subject: id, email: id + '@example.test', displayName: 'Synthetic unit employee', role: 'EMPLOYEE', active: true, localAuthEnabled: true, localPasswordHash: admin.localPasswordHash } });
    const person = await db.person.create({ data: { tenantId, givenName: 'Synthetic', familyName: id, workEmail: id + '@example.test' } });
    const employment = await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date('2020-01-01') } });
    const balance = await db.leaveBalance.create({ data: { tenantId, employmentId: employment.id, leaveTypeId: types.hour.id, periodYear: year, opening: '8' } });
    const ctx = await signed(id, employment.id, tenantId, locale, theme, width), page = await screen(ctx, locale, theme);
    lastIdentity = { id, employmentId: employment.id, tenantId };
    const panel = page.locator('[data-leave-self-service]'), form = panel.locator('form');
    const select = form.locator('[name="leaveTypeId"]'), amount = form.locator('[name="units"]');
    const reason = `Synthetic ${locale} retained reason`, date = `${year}-${month}-12`;
    const posts = []; page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/leave/requests')) posts.push(r); });
    let hourlyId;
    await check(`${locale}: amount is unavailable before selection and DAYS is visibly labelled`, page, async () => {
      assert.ok(await amount.isDisabled()); assert.ok(await form.locator('[type="submit"]').isDisabled());
      await select.selectOption(types.day.id); assert.equal(await amount.getAttribute('data-leave-unit'), 'DAYS');
      assert.equal(await form.getByLabel(c(locale, 'Amount (days)', 'Miktar (gün)'), { exact: true }).count(), 1);
      await form.locator('[name="startsAt"]').fill(date); await form.locator('[name="endsAt"]').fill(date);
      await amount.fill('0.50'); await form.locator('[name="reason"]').fill(reason);
      assert.equal(posts.length, 0);
    });
    await check(`${locale}: dismissed day/hour switch preserves amount, dates and reason without a POST`, page, async () => {
      page.once('dialog', d => d.dismiss()); await select.selectOption(types.hour.id);
      assert.equal(await select.inputValue(), types.day.id); assert.equal(await amount.inputValue(), '0.50');
      assert.equal(await form.locator('[name="startsAt"]').inputValue(), date);
      assert.equal(await form.locator('[name="endsAt"]').inputValue(), date);
      assert.equal(await form.locator('[name="reason"]').inputValue(), reason); assert.equal(posts.length, 0);
    });
    await check(`${locale}: same-unit type switch retains amount and exposes automatic-approval guidance`, page, async () => {
      let dialogs = 0; const handler = d => { dialogs++; void d.dismiss(); }; page.on('dialog', handler);
      try { await select.selectOption(types.other.id); } finally { page.off('dialog', handler); }
      assert.equal(dialogs, 0); assert.equal(await amount.inputValue(), '0.50');
      assert.ok((await form.locator('[data-leave-unit-help]').innerText()).includes(c(locale, 'automatically approved', 'otomatik onaylanır')));
    });
    await check(`${locale}: accepted unit switch clears amount only and requires a new hourly quantity`, page, async () => {
      page.once('dialog', d => d.accept()); await select.selectOption(types.hour.id);
      assert.equal(await amount.inputValue(), ''); assert.equal(await amount.getAttribute('data-leave-unit'), 'HOURS');
      assert.equal(await form.getByLabel(c(locale, 'Amount (hours)', 'Miktar (saat)'), { exact: true }).count(), 1);
      assert.equal(await form.locator('[name="reason"]').inputValue(), reason);
      assert.equal(await form.locator('[name="startsAt"]').inputValue(), date);
      assert.equal(await form.locator('[name="endsAt"]').inputValue(), date);
      await form.locator('[type="submit"]').click(); assert.equal(posts.length, 0);
      assert.equal(await amount.evaluate(el => el.validity.valueMissing), true);
      await amount.fill('1.25');
    });
    await check(`${locale}: fractional hours persist exactly once and a verified save resets the unit`, page, async () => {
      const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url() === origin + '/api/leave/requests'), form.locator('[type="submit"]').click()]);
      assert.equal(response.status(), 201); const row = (await response.json()).data; hourlyId = row.id;
      await panel.locator('[data-leave-result="saved"]').waitFor();
      const stored = await db.leaveRequest.findUniqueOrThrow({ where: { id: hourlyId } });
      assert.equal(stored.employmentId, employment.id); assert.equal(stored.leaveTypeId, types.hour.id);
      assert.equal(stored.units.toString(), '1.25'); assert.equal(stored.reason, reason); assert.equal(stored.status, 'APPROVED');
      assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(), '1.25');
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: hourlyId, action: 'leave-request.created-auto-approved' } }), 1);
      await page.waitForFunction(() => document.querySelector('[data-leave-self-service] input[name="units"]')?.disabled === true);
      assert.equal(await select.inputValue(), ''); assert.equal(await form.locator('[name="reason"]').inputValue(), '');
      assert.equal(posts.length, 1);
    });
    await check(`${locale}: hourly cancellation restores the exact balance once and retains existing audit rules`, page, async () => {
      assert.ok(hourlyId); const row = panel.locator(`[data-leave-request-id="${hourlyId}"]`); await row.waitFor();
      page.once('dialog', d => d.accept());
      const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/${hourlyId}/self-cancel`) && r.request().method() === 'POST'), row.getByRole('button').click()]);
      assert.equal(response.status(), 200); await page.waitForFunction(id => !document.querySelector(`[data-leave-request-id="${id}"] button`), hourlyId);
      assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id: hourlyId } })).status, 'CANCELLED');
      assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(), '0');
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: hourlyId, action: 'leave-request.self-cancelled' } }), 1);
      assert.equal(posts.length, 2);
    });
    await check(`${locale}: lost post-commit response preserves displayed DAYS and the no-repeat guard`, page, async () => {
      await select.selectOption(types.day.id); await form.locator('[name="startsAt"]').fill(date);
      await form.locator('[name="endsAt"]').fill(date); await amount.fill('0.50'); await form.locator('[name="reason"]').fill(reason);
      let committed;
      await ctx.route(origin + '/api/leave/requests', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch(); assert.equal(response.status(), 201);
        committed = (await response.json()).data.id; await route.abort('failed');
      });
      await form.locator('[type="submit"]').click(); await panel.locator('[data-leave-result="unknown"]').waitFor();
      assert.equal(await amount.inputValue(), '0.50'); assert.equal(await amount.getAttribute('data-leave-unit'), 'DAYS');
      assert.equal(await form.locator('[name="reason"]').inputValue(), reason); assert.ok(await select.isDisabled());
      await form.evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(posts.length, 3); assert.ok(committed);
      assert.equal(await db.leaveRequest.count({ where: { tenantId, employmentId: employment.id, leaveTypeId: types.day.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: committed, action: 'leave-request.created' } }), 1);
      await ctx.unroute(origin + '/api/leave/requests');
    });
    await page.close();
  }
  assert.ok(lastIdentity);
  for (const [theme, width] of [['light', 320], ['dark', 390]]) {
    const { id, employmentId, tenantId } = lastIdentity;
    const ctx = await signed(id, employmentId, tenantId, 'tr', theme, width), page = await screen(ctx, 'tr', theme);
    await check(`tr ${theme}/${width}: explicit hourly labels and help fit the actual mobile viewport`, page, async () => {
      const panel = page.locator('[data-leave-self-service]'), form = panel.locator('form');
      await form.locator('[name="leaveTypeId"]').selectOption(types.hour.id);
      const amount = form.getByLabel('Miktar (saat)', { exact: true }); await amount.fill('1.25'); await amount.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await form.evaluate(el => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth }));
      assert.ok(geometry.documentWidth <= width + 2); assert.ok(geometry.left >= -1 && geometry.right <= width + 1);
      assert.ok(geometry.scroll <= geometry.client + 1);
      const id = await amount.getAttribute('aria-describedby'); assert.ok(id);
      assert.ok((await page.locator(`[id="${id}"]`).innerText()).includes('Gün/saat dönüşümü yapılmaz'));
      const screenshot = `leave-unit-tr-${theme}-${width}.jpg`; await page.screenshot({ path: out + '/' + screenshot, fullPage: false });
      return { geometry, screenshot };
    });
    await page.close();
  }
} catch (error) {
  report.setupFailure = { code: typeof error?.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : 'SETUP_ERROR', completedCases: report.tests.length };
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map(ctx => ctx.close().catch(() => {}))); await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2)); console.log('LEAVE_UNIT_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 16 || report.tests.some(t => !t.passed)) process.exitCode = 1;
