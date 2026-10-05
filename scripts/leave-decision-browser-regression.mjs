/** Real manager/HR form login + unchanged APIs + disposable PostgreSQL.
 * Fault scenarios modify only the browser-facing response AFTER a real decision commits. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100';
const surface = process.env.HRBP_LEAVE_DECISION_SURFACE || 'module';
assert.ok(['module', 'action-center'].includes(surface), 'Only the two fixed local surfaces are supported');
const actionCenter = surface === 'action-center';
const pagePath = actionCenter ? '/module/workflows' : '/module/leave';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit'); assert.equal(database.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const db = new PrismaClient(), browser = await chromium.launch({ headless: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), surface, checks: [], failures: [],
  scope: 'MANAGER and HR_OPERATIONS, EN desktop/TR mobile, real login/decision API/PostgreSQL. Request/identity seeds and deliberate response-loss/notification failures in fixed disposable localhost only.' };
await mkdir('.audit', { recursive: true });
async function scenario(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); console.log('LEAVE_DECISION_PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false }); report.failures.push(name); throw error; }
}
async function eventually(fn) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  assert.fail('Expected persisted state was not observed');
}
try {
  const seed = await db.userAccount.findUniqueOrThrow({ where: { id: 'qa-audit-admin' } });
  const hrSubject = `qa-decision-hr-${randomUUID()}`;
  const hr = await db.userAccount.create({ data: { tenantId: seed.tenantId, subject: hrSubject,
    displayName: 'QA decision HR', email: `${hrSubject}@example.test`, role: 'HR_OPERATIONS',
    active: true, localAuthEnabled: true, localPasswordHash: seed.localPasswordHash } });
  for (const role of ['manager', 'hr']) for (const [locale, width] of [['en', 1280], ['tr', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const posts = [], patches = [], jsErrors = [];
    page.on('pageerror', error => jsErrors.push(error.name));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.endsWith('/decision')) posts.push(path);
      if (request.method() === 'PATCH' && path === '/api/notifications') patches.push(path);
    });
    const name = label => `${role}/${locale}: ${label}`;
    const identity = async () => {
      const r = await context.request.get(origin + '/api/auth/session'); const body = await r.json();
      assert.equal(body.authenticated, true); assert.equal(body.user.id, role === 'manager' ? 'qa-audit-manager' : hr.id);
      assert.equal(body.user.role, role === 'manager' ? 'MANAGER' : 'HR_OPERATIONS'); return body.user;
    };
    let actor, employee;
    try {
      await scenario(name('real form login and correct principal'), async () => {
        await page.goto(origin + '/auth/sign-in?returnTo=' + encodeURIComponent(pagePath), { waitUntil: 'networkidle' });
        await page.locator('#local-identifier').fill(role === 'manager' ? 'audit.manager' : hrSubject);
        await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        await page.locator('.local-auth-card button[type="submit"]').click();
        await page.waitForURL(origin + pagePath); actor = await identity();
      });
      const person = await db.person.create({ data: { tenantId: actor.tenantId, givenName: 'QA decision', familyName: 'Report', employeeNumber: randomUUID() } });
      employee = await db.employment.create({ data: { tenantId: actor.tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date('2025-01-01'), managerEmploymentId: role === 'manager' ? actor.employmentId : null } });
      async function fixture() {
        const type = await db.leaveType.create({ data: { tenantId: actor.tenantId, code: `QD-${randomUUID()}`, name: `QA decision ${randomUUID()}`, requiresApproval: true, annualAllowance: '0.30', unit: 'DAYS' } });
        const when = new Date(); when.setUTCDate(when.getUTCDate() + 1); when.setUTCHours(12, 0, 0, 0);
        const balance = await db.leaveBalance.create({ data: { tenantId: actor.tenantId, employmentId: employee.id, leaveTypeId: type.id, periodYear: when.getUTCFullYear(), opening: '0.30', used: '0.20' } });
        const record = await db.leaveRequest.create({ data: { tenantId: actor.tenantId, employmentId: employee.id, leaveTypeId: type.id, startsAt: when, endsAt: when, units: '0.10', status: 'PENDING' } });
        const notice = await db.notificationOutbox.create({ data: { tenantId: actor.tenantId, recipientUserId: actor.id, eventType: 'LEAVE_APPROVAL_REQUIRED', resourceType: 'LeaveRequest', resourceId: record.id, dedupeKey: randomUUID(), status: 'DELIVERED', channel: 'IN_APP', deliveredAt: new Date() } });
        await page.goto(origin + pagePath, { waitUntil: 'networkidle' });
        const control = page.locator(`${actionCenter ? '.workflow-action-center ' : ''}[data-leave-decision-id="${record.id}"]`); await control.waitFor();
        assert.equal(await control.locator('[data-decision="APPROVED"]').innerText(), locale === 'tr' ? 'Onayla' : 'Approve');
        return { record, balance, notice, control, path: `/api/leave/requests/${record.id}/decision` };
      }
      const state = f => db.leaveRequest.findUniqueOrThrow({ where: { id: f.record.id } });
      const used = async f => (await db.leaveBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).used.toString();
      const unread = async f => (await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.notice.id } })).readAt === null;
      const auditCount = f => db.auditEvent.count({ where: { tenantId: actor.tenantId, resourceId: f.record.id, action: { in: ['leave-request.approved', 'leave-request.rejected'] } } });
      let f = await fixture();
      await scenario(name('dismiss confirmation without decision or acknowledgement'), async () => {
        const before = posts.length; page.once('dialog', d => d.dismiss());
        await f.control.locator('[data-decision="APPROVED"]').click();
        assert.equal(posts.length, before); assert.equal((await state(f)).status, 'PENDING'); assert.equal(await unread(f), true);
      });
      await scenario(name('opposite same-turn clicks send one decision and acknowledge after verified commit'), async () => {
        let release, started; const gate = new Promise(r => { release = r; }), arrived = new Promise(r => { started = r; });
        const handler = async route => { started(); await gate; const response = await route.fetch(); await route.fulfill({ response }); };
        await context.route(origin + f.path, handler); const before = posts.length;
        page.once('dialog', d => d.accept());
        try {
          await f.control.evaluate(el => { el.querySelector('[data-decision="APPROVED"]').click(); el.querySelector('[data-decision="REJECTED"]').click(); });
          await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('No decision request')), 10000))]);
          assert.equal(posts.length - before, 1); assert.equal(await f.control.locator('[data-decision="REJECTED"]').isDisabled(), true);
          assert.equal(await unread(f), true);
        } finally { release(); }
        await eventually(async () => (await state(f)).status === 'APPROVED' && !(await unread(f)));
        assert.equal(await used(f), '0.3'); assert.equal(await auditCount(f), 1);
        await context.unroute(origin + f.path, handler);
        await page.waitForFunction(id => !document.querySelector(`[data-leave-decision-id="${id}"] [data-decision]`), f.record.id);
      });
      await scenario(name('rejection remains committed when badge cleanup fails'), async () => {
        f = await fixture();
        const handler = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated notification failure' }) });
        await context.route(origin + '/api/notifications', handler);
        page.once('dialog', d => d.accept()); await f.control.locator('[data-decision="REJECTED"]').click();
        await eventually(async () => (await state(f)).status === 'REJECTED');
        await page.waitForFunction(id => !document.querySelector(`[data-leave-decision-id="${id}"] [data-decision]`), f.record.id);
        assert.equal(await used(f), '0.2'); assert.equal(await auditCount(f), 1); assert.equal(await unread(f), true);
        await context.unroute(origin + '/api/notifications', handler);
      });
      for (const mode of ['html-after-commit', 'lost-after-commit']) await scenario(name(mode + ' seals row, retains notification and reloads without replay'), async () => {
        f = await fixture(); const before = posts.length, beforePatches = patches.length;
        let snapshot;
        if (actionCenter) {
          const response = await context.request.get(origin + '/api/action-center');
          assert.equal(response.status(), 200); snapshot = await response.json();
          assert.ok(snapshot.data.items.some(item => item.action?.requestId === f.record.id));
        }
        const handler = async route => {
          const response = await route.fetch(); assert.equal(response.status(), 200);
          if (mode === 'html-after-commit') await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>interrupted response</html>' });
          else await route.abort('failed');
        };
        await context.route(origin + f.path, handler);
        page.once('dialog', d => d.accept()); await f.control.locator('[data-decision="APPROVED"]').click();
        await f.control.locator('[data-leave-decision-result="unknown"]').waitFor();
        assert.equal(await f.control.locator('[data-decision]').count(), 0);
        assert.equal((await state(f)).status, 'APPROVED'); assert.equal(await used(f), '0.3'); assert.equal(await auditCount(f), 1);
        assert.equal(await unread(f), true); assert.equal(patches.length, beforePatches);
        await context.unroute(origin + f.path, handler);
        if (actionCenter) {
          const center = page.locator('.workflow-action-center');
          const search = center.locator('.workflow-action-search input');
          await search.fill('no-matching-row-' + randomUUID()); await f.control.waitFor({ state: 'detached' });
          await search.fill(''); await f.control.locator('[data-leave-decision-result="unknown"]').waitFor();
          assert.equal(await f.control.locator('[data-decision]').count(), 0);
          // Simulate a delayed, pre-decision queue snapshot. A read must not erase
          // the page-owned attempted-record seal or authorize an opposite write.
          const stale = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
          await context.route(origin + '/api/action-center', stale);
          try {
            await center.locator('.workflow-action-head button').click();
            await page.waitForFunction(() => !document.querySelector('.workflow-action-head button')?.disabled);
            await f.control.locator('[data-leave-decision-result="unknown"]').waitFor();
            assert.equal(await f.control.locator('[data-decision]').count(), 0);
            assert.equal(posts.length - before, 1); assert.equal(patches.length, beforePatches);
          } finally { await context.unroute(origin + '/api/action-center', stale); }
        }
        await f.control.locator('[data-leave-decision-reload]').click(); await page.waitForLoadState('networkidle');
        assert.equal(posts.length - before, 1); assert.equal(await auditCount(f), 1); await identity();
      });
      await scenario(name('real insufficient-balance rejection closes no notification and requires fresh review'), async () => {
        f = await fixture(); await db.leaveBalance.update({ where: { id: f.balance.id }, data: { used: '0.30' } });
        page.once('dialog', d => d.accept()); await f.control.locator('[data-decision="APPROVED"]').click();
        await f.control.locator('[data-leave-decision-result="rejected"]').waitFor();
        assert.equal(await f.control.locator('[data-decision]').count(), 0);
        assert.equal((await state(f)).status, 'PENDING'); assert.equal(await auditCount(f), 0); assert.equal(await unread(f), true);
      });
      if (actionCenter) {
        await scenario(name('failed queue read disables stale leave controls without a decision'), async () => {
          f = await fixture(); const before = posts.length;
          const fail = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated queue unavailability' }) });
          await context.route(origin + '/api/action-center', fail);
          try {
            await page.locator('.workflow-action-head button').click();
            await page.locator('.workflow-action-message.error').waitFor();
            assert.equal(await f.control.locator('[data-decision="APPROVED"]').isDisabled(), true);
            await f.control.locator('[data-decision="APPROVED"]').evaluate(button => button.click());
            assert.equal(posts.length, before); assert.equal((await state(f)).status, 'PENDING');
            assert.equal(await auditCount(f), 0); assert.equal(await unread(f), true);
          } finally { await context.unroute(origin + '/api/action-center', fail); }
          await page.locator('.workflow-action-head button').click();
          await page.waitForFunction(id => { const button = document.querySelector(`[data-leave-decision-id="${id}"] [data-decision="APPROVED"]`); return button && !button.disabled; }, f.record.id);
        });
        await scenario(name('mismatched action identifiers offer navigation only'), async () => {
          const response = await context.request.get(origin + '/api/action-center');
          assert.equal(response.status(), 200); const snapshot = await response.json();
          const row = snapshot.data.items.find(item => item.action?.requestId === f.record.id); assert.ok(row);
          row.secondaryAction = { type: 'reject-leave', requestId: 'different-record' };
          const malformed = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
          await context.route(origin + '/api/action-center', malformed);
          try {
            const before = posts.length;
            await page.locator('.workflow-action-head button').click();
            await f.control.waitFor({ state: 'detached' });
            const visible = page.locator(`[id="action-item-${row.id}"]`);
            assert.equal(await visible.locator('button').count(), 0); assert.equal(await visible.locator('a').count(), 1);
            assert.equal(posts.length, before); assert.equal(await auditCount(f), 0);
          } finally { await context.unroute(origin + '/api/action-center', malformed); }
        });
      }
      await scenario(name('principal and JavaScript health preserved'), async () => { await identity(); assert.deepEqual(jsErrors, []); });
    } finally { await context.close(); }
  }
} finally {
  await writeFile(actionCenter ? '.audit/leave-action-center-browser.json' : '.audit/leave-decision-browser.json', JSON.stringify(report, null, 2));
  await browser.close(); await db.$disconnect();
}
console.log('LEAVE_DECISION_BROWSER ' + JSON.stringify({ checks: report.checks.length, failures: report.failures }));
