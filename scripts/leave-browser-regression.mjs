/** Real browser/form/HTTP/PostgreSQL checks plus explicitly labelled response-loss simulation.
 * Mutations and fixtures are confined to the disposable loopback application/database. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit'); assert.equal(database.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [], failures: [],
  scope: 'Employee self-service, EN/TR, desktop/mobile, real form login and database writes. Delayed/HTML/lost responses are browser transport fault injections after real server processing. No production, SSO or external providers.' };
await mkdir('.audit', { recursive: true });
async function scenario(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); console.log('LEAVE_BROWSER_PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false }); report.failures.push(name); throw error; }
}
try {
  for (const [locale, width] of [['en', 1280], ['tr', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const jsErrors = []; page.on('pageerror', error => jsErrors.push(error.name));
    const posts = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.startsWith('/api/leave/requests')) posts.push(path);
    });
    const panel = page.locator('[data-leave-self-service="true"]');
    const form = panel.locator('form');
    const checkSession = async () => {
      const r = await context.request.get(origin + '/api/auth/session'); assert.equal(r.status(), 200);
      const body = await r.json(); assert.equal(body.authenticated, true); assert.equal(body.user.id, 'qa-audit-employee');
      return body.user;
    };
    let employee, leaveType, balance, firstId;
    const year = new Date().getUTCFullYear() + 4;
    const date = day => `${year}-${locale === 'tr' ? '07' : '06'}-${String(day).padStart(2, '0')}`;
    async function fill(day, reason) {
      await form.locator('select[name="leaveTypeId"]').selectOption(leaveType.id);
      await form.locator('input[name="startsAt"]').fill(date(day));
      await form.locator('input[name="endsAt"]').fill(date(day));
      await form.locator('input[name="units"]').fill('0.10');
      await form.locator('textarea[name="reason"]').fill(reason);
    }
    async function waitNotice(outcome) { await panel.locator(`[data-leave-result="${outcome}"]`).waitFor(); }
    async function used() { return (await db.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } })).used.toString(); }
    async function savedRow(day) {
      const rows = await db.leaveRequest.findMany({ where: { tenantId: employee.tenantId, leaveTypeId: leaveType.id, startsAt: new Date(date(day)) } });
      assert.equal(rows.length, 1); assert.equal(rows[0].employmentId, employee.employmentId); return rows[0];
    }
    async function cancelRow(id) {
      const row = panel.locator(`[data-leave-request-id="${id}"]`);
      await row.waitFor(); page.once('dialog', dialog => dialog.accept());
      await row.locator('button').click();
      await waitNotice('saved');
      await page.waitForFunction(id => {
        const row = document.querySelector(`[data-leave-request-id="${id}"]`);
        return row && /cancelled|iptal/i.test(row.innerText) && !row.querySelector('button');
      }, id);
      assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id } })).status, 'CANCELLED');
      assert.equal(await used(), '0.2');
    }
    try {
      await scenario(`${locale}: real form sign-in opens employment-scoped self-service`, async () => {
        await page.goto(origin + '/auth/sign-in?returnTo=%2Fmodule%2Fleave', { waitUntil: 'networkidle' });
        await page.locator('#local-identifier').fill('audit.employee');
        await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        await page.locator('.local-auth-card button[type="submit"]').click();
        await panel.waitFor(); employee = await checkSession(); assert.ok(employee.employmentId);
        assert.equal(await panel.locator('h3').innerText(), locale === 'tr' ? 'İzin self-servis' : 'Leave self-service');
      });
      leaveType = await db.leaveType.create({ data: { tenantId: employee.tenantId, code: `QA-BROWSER-${randomUUID().slice(0, 8)}`, name: `QA browser ${locale}`, requiresApproval: false, annualAllowance: '0.30', unit: 'DAYS' } });
      balance = await db.leaveBalance.create({ data: { tenantId: employee.tenantId, employmentId: employee.employmentId, leaveTypeId: leaveType.id, periodYear: year, opening: '0.30', used: '0.20' } });
      await page.reload({ waitUntil: 'networkidle' }); await panel.waitFor();
      await scenario(`${locale}: same-turn double form submit sends one POST and disables editing while pending`, async () => {
        await fill(10, `QA ${locale} original draft`);
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const arrived = new Promise(resolve => { started = resolve; });
        const path = origin + '/api/leave/requests';
        const handler = async route => {
          if (route.request().method() !== 'POST') return route.continue();
          started(); await gate;
          const response = await route.fetch(); await route.fulfill({ response });
        };
        await context.route(path, handler); const before = posts.length;
        try {
          await form.evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
          await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('No leave request observed')), 10000))]);
          assert.equal(posts.length - before, 1);
          for (const name of ['leaveTypeId', 'startsAt', 'endsAt', 'units', 'reason']) assert.equal(await form.locator(`[name="${name}"]`).isDisabled(), true);
          assert.equal(await form.locator('textarea').inputValue(), `QA ${locale} original draft`);
        } finally { release(); }
        await waitNotice('saved'); await context.unroute(path, handler);
        const row = await savedRow(10); firstId = row.id; assert.equal(row.status, 'APPROVED');
        assert.equal(await used(), '0.3');
        assert.equal(await db.auditEvent.count({ where: { resourceId: row.id, action: 'leave-request.created-auto-approved', tenantId: employee.tenantId } }), 1);
        await page.waitForFunction(() => document.querySelector('[data-leave-self-service] textarea')?.value === '');
        await panel.locator(`[data-leave-request-id="${firstId}"]`).waitFor();
      });
      await scenario(`${locale}: dismissing cancellation confirms no POST and no state change`, async () => {
        const before = posts.length;
        page.once('dialog', dialog => dialog.dismiss());
        await panel.locator(`[data-leave-request-id="${firstId}"] button`).click();
        assert.equal(posts.length, before); assert.equal((await db.leaveRequest.findUniqueOrThrow({ where: { id: firstId } })).status, 'APPROVED');
      });
      await scenario(`${locale}: explicit cancellation refunds exactly once and closes its button`, async () => {
        const before = posts.length; await cancelRow(firstId); assert.equal(posts.length - before, 1);
        assert.equal(await db.auditEvent.count({ where: { resourceId: firstId, action: 'leave-request.self-cancelled', tenantId: employee.tenantId } }), 1);
      });
      await scenario(`${locale}: real API rejection keeps entered values and permits correction`, async () => {
        await fill(13, `QA ${locale} keep rejected draft`);
        await form.locator('[name="endsAt"]').fill(date(12));
        const before = posts.length;
        await form.locator('button[type="submit"]').click(); await waitNotice('rejected');
        assert.equal(posts.length - before, 1); assert.equal(await form.locator('textarea').inputValue(), `QA ${locale} keep rejected draft`);
        assert.equal(await form.locator('textarea').isDisabled(), false); assert.equal(await used(), '0.2');
        assert.equal(await db.leaveRequest.count({ where: { leaveTypeId: leaveType.id, startsAt: new Date(date(13)) } }), 0);
      });
      for (const [mode, day] of [['html-after-commit', 16], ['connection-lost-after-commit', 18]]) {
        let committedId;
        await scenario(`${locale}: ${mode} is not success, retains draft and blocks repeat submission`, async () => {
          await fill(day, `QA ${locale} ${mode}`);
          const path = origin + '/api/leave/requests'; let completed;
          const handler = async route => {
            if (route.request().method() !== 'POST') return route.continue();
            const response = await route.fetch(); assert.equal(response.status(), 201);
            committedId = (await response.json()).data.id;
            if (mode === 'html-after-commit') await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>proxy replacement, not a save receipt</html>' });
            else await route.abort('failed');
            completed = true;
          };
          await context.route(path, handler); const before = posts.length;
          try {
            await form.locator('button[type="submit"]').click(); await waitNotice('unknown');
            assert.equal(completed, true); assert.equal(await panel.locator('[data-leave-result="saved"]').count(), 0);
            assert.equal(await form.locator('textarea').inputValue(), `QA ${locale} ${mode}`);
            assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
            await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            assert.equal(posts.length - before, 1); const row = await savedRow(day); assert.equal(row.id, committedId);
            assert.equal(await used(), '0.3');
            assert.equal(await db.auditEvent.count({ where: { resourceId: row.id, action: 'leave-request.created-auto-approved', tenantId: employee.tenantId } }), 1);
          } finally { await context.unroute(path, handler); }
        });
        await scenario(`${locale}: explicit reload after ${mode} recovers actual committed record without replay`, async () => {
          const before = posts.length;
          await panel.locator('[data-leave-recovery] button').click();
          await page.waitForLoadState('networkidle');
          await panel.waitFor();
          await panel.locator(`[data-leave-request-id="${committedId}"]`).waitFor();
          assert.equal(posts.length, before); assert.equal(await panel.locator('[data-leave-result="unknown"]').count(), 0);
          assert.equal((await savedRow(day)).id, committedId); await checkSession();
          await cancelRow(committedId);
        });
      }
      await scenario(`${locale}: final identity, layout and Javascript checks remain healthy`, async () => {
        await checkSession(); assert.deepEqual(jsErrors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
        assert.equal(await used(), '0.2');
      });
    } finally { await context.close(); }
  }
} finally {
  await writeFile('.audit/leave-browser-regression.json', JSON.stringify(report, null, 2));
  await browser.close(); await db.$disconnect();
}
assert.equal(report.failures.length, 0);
assert.equal(report.checks.length, 20, 'Both languages must complete every intended scenario');
console.log('LEAVE_BROWSER_SUMMARY ' + JSON.stringify({ passed: report.checks.length, failures: report.failures }));
