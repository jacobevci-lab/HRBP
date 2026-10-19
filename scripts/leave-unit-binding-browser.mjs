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
const out = '.audit/leave-unit-binding'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  limitations: ['Disposable PostgreSQL/production Next.js/Chromium with signed synthetic employee sessions.',
    'No work-calendar, holiday, legal-entitlement or automatic day/hour conversion is tested or introduced.',
    'Post-commit response loss is an explicit browser transport injection; no SMTP or dispatcher is started.'] };
const db = new PrismaClient(), browser = await chromium.launch(), contexts = [];
const marker = 'qabind-' + randomUUID().slice(0, 8), year = new Date().getUTCFullYear() + 2;
const c = (locale, en, tr) => locale === 'tr' ? tr : en;
async function check(name, page, fn) {
  const row = { name, passed: false };
  try { Object.assign(row, await fn(), { passed: true }); }
  catch (error) {
    row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 600);
    if (page) await page.screenshot({ path: `${out}/failure-${report.tests.length}.jpg`, fullPage: false }).catch(() => {});
  }
  report.tests.push(row); console.log('LEAVE_UNIT_BINDING_CASE ' + JSON.stringify(row));
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
  const id = marker + '-user'; assert.ok(id.length <= 24);
  await db.userAccount.create({ data: { id, tenantId, subject: id, email: id + '@example.test', displayName: 'Synthetic unit binding employee', role: 'EMPLOYEE', active: true, localAuthEnabled: true, localPasswordHash: admin.localPasswordHash } });
  const person = await db.person.create({ data: { tenantId, givenName: 'Synthetic', familyName: id, workEmail: id + '@example.test' } });
  const employment = await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date('2020-01-01') } });
  const lastIdentity = { id, employmentId: employment.id, tenantId };
  // Additive server precondition checks on a type whose unit changes after the
  // actual signed page was read. All mutations below are disposable fixtures.
  for (const [locale, month] of [['en', '09'], ['tr', '10']]) {
    const { id, employmentId, tenantId } = lastIdentity;
    const kind = await db.leaveType.create({ data: { tenantId, code: marker + '-bind-' + locale,
      name: 'Synthetic unit precondition ' + locale, unit: 'DAYS', requiresApproval: false, annualAllowance: '8' } });
    const balance = await db.leaveBalance.create({ data: { tenantId, employmentId, leaveTypeId: kind.id, periodYear: year, opening: '8' } });
    const ctx = await signed(id, employmentId, tenantId, locale, 'light', locale === 'tr' ? 390 : 1280);
    const page = await screen(ctx, locale, 'light');
    const panel = page.locator('[data-leave-self-service]'), form = panel.locator('form');
    const sent = []; page.on('request', req => { if(req.method() === 'POST' && req.url() === origin + '/api/leave/requests') sent.push(req.postDataJSON()); });
    const fill = async (day) => {
      await form.locator('[name="leaveTypeId"]').selectOption(kind.id);
      await form.locator('[name="startsAt"]').fill(`${year}-${month}-${day}`);
      await form.locator('[name="endsAt"]').fill(`${year}-${month}-${day}`);
      await form.locator('[name="units"]').fill('1.25');
      await form.locator('[name="reason"]').fill('Synthetic retained unit draft');
    };
    await check(`${locale}: a displayed DAYS draft is rejected after its server type changes to HOURS`, page, async () => {
      await fill('15');
      assert.equal(await form.locator('[name="units"]').getAttribute('data-leave-unit'), 'DAYS');
      await db.leaveType.update({ where: { id: kind.id }, data: { unit: 'HOURS' } });
      const [response] = await Promise.all([page.waitForResponse(r => r.url() === origin + '/api/leave/requests' && r.request().method() === 'POST'), form.locator('[type="submit"]').click()]);
      assert.equal(response.status(), 409); assert.equal((await response.json()).code, 'LEAVE_UNIT_CHANGED');
      await panel.locator('[data-leave-result="rejected"]').waitFor();
      assert.equal(sent.at(-1).expectedUnit, 'DAYS');
      assert.ok((await panel.locator('[data-leave-result]').innerText()).includes(c(locale, 'unit changed', 'birimi değişmiş')));
      assert.equal(await form.locator('[name="units"]').inputValue(), '1.25');
      assert.equal(await form.locator('[name="reason"]').inputValue(), 'Synthetic retained unit draft');
      assert.equal(await db.leaveRequest.count({ where: { tenantId, employmentId, leaveTypeId: kind.id } }), 0);
      assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(), '0');
      const screenshot = `leave-unit-conflict-${locale}.jpg`;
      await panel.locator('[data-leave-result]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: out + '/' + screenshot, fullPage: false });
      return { screenshot, expectedUnit: 'DAYS', currentUnit: 'HOURS', status: 409 };
    });
    await check(`${locale}: explicitly reloading/re-entering HOURS creates one correctly bound quantity and audit`, page, async () => {
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      await fill('15');
      assert.equal(await form.locator('[name="units"]').getAttribute('data-leave-unit'), 'HOURS');
      const [response] = await Promise.all([page.waitForResponse(r => r.url() === origin + '/api/leave/requests' && r.request().method() === 'POST'), form.locator('[type="submit"]').click()]);
      assert.equal(response.status(), 201); const receipt = (await response.json()).data;
      assert.equal(sent.at(-1).expectedUnit, 'HOURS'); assert.equal(receipt.validatedUnit, 'HOURS');
      await panel.locator('[data-leave-result="saved"]').waitFor();
      assert.equal(await db.leaveRequest.count({ where: { tenantId, employmentId, leaveTypeId: kind.id } }), 1);
      assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(), '1.25');
      const audit = await db.auditEvent.findFirstOrThrow({ where: { tenantId, resourceId: receipt.id, action: 'leave-request.created-auto-approved' } });
      assert.equal(audit.purpose, 'Leave quantity verified in HOURS at creation');
    });
    await check(`${locale}: wrong unit in a real post-commit receipt retains the draft and blocks duplicate submission`, page, async () => {
      await fill('16'); let committed;
      await ctx.route(origin + '/api/leave/requests', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch(); assert.equal(response.status(), 201);
        const body = await response.json(); committed = body.data.id;
        assert.equal(body.data.validatedUnit, 'HOURS'); body.data.validatedUnit = 'DAYS';
        await route.fulfill({ response, json: body });
      });
      const before = sent.length; await form.locator('[type="submit"]').click();
      await panel.locator('[data-leave-result="unknown"]').waitFor();
      assert.equal(await form.locator('[name="units"]').inputValue(), '1.25');
      assert.equal(await form.locator('[name="reason"]').inputValue(), 'Synthetic retained unit draft');
      assert.ok(await form.locator('[type="submit"]').isDisabled());
      await form.evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(sent.length, before + 1); assert.ok(committed);
      assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id: committed } })).units.toString(), '1.25');
      assert.equal((await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(), '2.5');
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: committed, action: 'leave-request.created-auto-approved' } }), 1);
      await ctx.unroute(origin + '/api/leave/requests');
    });
    await check(`${locale}: legacy API callers remain compatible without falsely receiving a unit proof`, page, async () => {
      const response = await ctx.request.post(origin + '/api/leave/requests', { headers: { origin }, data: {
        employmentId, leaveTypeId: kind.id, startsAt: `${year}-${month}-17`, endsAt: `${year}-${month}-17`, units: '1.25' } });
      assert.equal(response.status(), 201); const data = (await response.json()).data;
      assert.equal(data.validatedUnit, undefined); assert.equal(data.status, 'APPROVED');
      const audit = await db.auditEvent.findFirstOrThrow({ where: { tenantId, resourceId: data.id, action: 'leave-request.created-auto-approved' } });
      assert.ok(!audit.purpose?.includes('quantity verified'));
    });
    await page.close();
  }
} catch (error) {
  report.setupFailure = { code: typeof error?.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : 'SETUP_ERROR', completedCases: report.tests.length };
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map(ctx => ctx.close().catch(() => {}))); await browser.close(); await db.$disconnect();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2)); console.log('LEAVE_UNIT_BINDING_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 8 || report.tests.some(t => !t.passed)) process.exitCode = 1;
