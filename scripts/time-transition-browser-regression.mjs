/** Real forms, transition API and disposable PostgreSQL; response faults occur after commit. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100', url = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.pathname, '/hrbp_audit'); assert.equal(url.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const db = new PrismaClient(), browser = await chromium.launch({ headless: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [], failures: [],
  scope: 'TimeEntryTransitionButtons in the Time & Attendance operating view. MANAGER/HR_OPERATIONS, EN desktop/TR mobile; real login, unchanged APIs and disposable PostgreSQL. Deliberate response failures and direct database fixtures only in flagged localhost. Action Center and employee create/submit console are outside this slice.' };
await mkdir('.audit', { recursive: true });
async function scenario(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); console.log('TIME_TRANSITION_PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false }); report.failures.push(name); throw error; }
}
async function eventually(fn) {
  for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  assert.fail('Expected database/UI state was not observed');
}
async function login(context, identifier, locale) {
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin, sameSite: 'Lax' }]);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(origin + '/auth/sign-in?returnTo=%2Fmodule%2Ftime-attendance', { waitUntil: 'networkidle' });
  await page.locator('#local-identifier').fill(identifier);
  await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
  await page.locator('.local-auth-card button[type="submit"]').click();
  await page.waitForURL(origin + '/module/time-attendance');
  return page;
}
try {
  const seed = await db.userAccount.findUniqueOrThrow({ where: { id: 'qa-audit-admin' } });
  const manager = await db.userAccount.findUniqueOrThrow({ where: { id: 'qa-audit-manager' } });
  // UserAccount does not carry an employment foreign key; resolve the signed identity.
  const identityContext = await browser.newContext();
  let managerEmploymentId;
  try {
    await login(identityContext, 'audit.manager', 'en');
    const session = await (await identityContext.request.get(origin + '/api/auth/session')).json();
    assert.equal(session.authenticated, true); assert.equal(session.user.id, manager.id);
    managerEmploymentId = session.user.employmentId; assert.ok(managerEmploymentId);
  } finally { await identityContext.close(); }
  const hrSubject = 'qa-time-hr-' + randomUUID();
  const hr = await db.userAccount.create({ data: { tenantId: seed.tenantId, subject: hrSubject, displayName: 'QA time HR',
    email: hrSubject + '@example.test', role: 'HR_OPERATIONS', active: true, localAuthEnabled: true, localPasswordHash: seed.localPasswordHash } });
  for (const role of ['manager', 'hr']) for (const [locale, width] of [['en', 1280], ['tr', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    const label = name => `${role}/${locale}: ${name}`;
    const actor = role === 'manager' ? manager : hr;
    let page;
    const posts = [], patches = [], errors = [];
    const identity = async () => {
      const response = await context.request.get(origin + '/api/auth/session'); const body = await response.json();
      assert.equal(body.authenticated, true); assert.equal(body.user.id, actor.id); assert.equal(body.user.role, actor.role);
    };
    try {
      await scenario(label('real form login with expected principal'), async () => {
        page = await login(context, role === 'manager' ? 'audit.manager' : hrSubject, locale); await identity();
      });
      page.on('pageerror', error => errors.push(error.name));
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path.startsWith('/api/time/entries/') && path.endsWith('/transition')) posts.push(path);
        if (request.method() === 'PATCH' && path === '/api/notifications') patches.push(path);
      });
      async function fixture({ status = 'SUBMITTED', schedule = true, employmentId } = {}) {
        const tenantId = actor.tenantId;
        if (!employmentId) {
          const person = await db.person.create({ data: { tenantId, givenName: 'QA time', familyName: 'Transition', employeeNumber: randomUUID() } });
          const employment = await db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE',
            startDate: new Date('2025-01-01'), managerEmploymentId: managerEmploymentId } });
          employmentId = employment.id;
          if (schedule) {
            const workSchedule = await db.workSchedule.create({ data: { tenantId, code: 'QT-' + randomUUID(), name: 'QA time schedule',
              timezone: 'UTC', weeklyMinutes: 2400, effectiveFrom: new Date('2025-01-01') } });
            await db.workScheduleAssignment.create({ data: { tenantId, employmentId, scheduleId: workSchedule.id, effectiveFrom: new Date('2025-01-01') } });
          }
        }
        const workDate = new Date(); workDate.setUTCHours(0, 0, 0, 0);
        const record = await db.timeEntry.create({ data: { tenantId, employmentId, workDate, minutes: 480, overtimeMinutes: 30, status, source: 'QA_TRANSITION',
          ...(status === 'APPROVED' ? { approvedById: manager.id, approvedAt: new Date() } : {}) } });
        const notice = await db.notificationOutbox.create({ data: { tenantId, recipientUserId: actor.id, eventType: 'TIME_ENTRY_APPROVAL_REQUIRED',
          resourceType: 'TimeEntry', resourceId: record.id, dedupeKey: randomUUID(), status: 'DELIVERED', channel: 'IN_APP', deliveredAt: new Date() } });
        await page.goto(origin + '/module/time-attendance', { waitUntil: 'networkidle' });
        const control = page.locator(`[data-time-transition-id="${record.id}"]`); await control.waitFor();
        return { record, notice, control, path: `/api/time/entries/${record.id}/transition` };
      }
      const state = f => db.timeEntry.findUniqueOrThrow({ where: { id: f.record.id } });
      const unread = async f => (await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.notice.id } })).readAt === null;
      const audit = (f, action) => db.auditEvent.count({ where: { tenantId: actor.tenantId, resourceId: f.record.id,
        ...(action ? { action: 'time-entry.' + action.toLowerCase() } : { resourceType: 'TimeEntry' }) } });
      let f = await fixture();
      await scenario(label('localized approval and dismissible confirmation perform no write'), async () => {
        assert.match(await f.control.locator('[data-time-target="APPROVED"]').innerText(), locale === 'tr' ? /Onayla/ : /Approve/);
        const before = posts.length; page.once('dialog', d => d.dismiss()); await f.control.locator('[data-time-target="APPROVED"]').click();
        assert.equal(posts.length, before); assert.equal((await state(f)).status, 'SUBMITTED'); assert.equal(await unread(f), true);
      });
      await scenario(label('opposite same-turn clicks submit once and acknowledge a verified approval'), async () => {
        let release, arrive; const gate = new Promise(r => { release = r; }), arrived = new Promise(r => { arrive = r; });
        const handler = async route => { arrive(); await gate; const response = await route.fetch(); await route.fulfill({ response }); };
        await context.route(origin + f.path, handler); const before = posts.length;
        page.once('dialog', d => d.accept());
        try {
          await f.control.evaluate(el => { el.querySelector('[data-time-target="APPROVED"]').click(); el.querySelector('[data-time-target="REJECTED"]').click(); });
          await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('No transition request')), 15000))]);
          assert.equal(posts.length - before, 1); assert.equal(await f.control.locator('[data-time-target="REJECTED"]').isDisabled(), true); assert.equal(await unread(f), true);
        } finally { release(); }
        await eventually(async () => (await state(f)).status === 'APPROVED' && !(await unread(f)));
        assert.equal(await audit(f), 1); assert.equal((await state(f)).minutes, 480); assert.equal((await state(f)).overtimeMinutes, 30);
        await context.unroute(origin + f.path, handler);
      });
      await scenario(label('rejection remains saved when notification cleanup returns 503'), async () => {
        f = await fixture();
        const handler = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Deliberate badge failure' }) });
        await context.route(origin + '/api/notifications', handler);
        page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="REJECTED"]').click();
        await f.control.locator('[data-time-transition-result="saved"]').waitFor();
        assert.equal((await state(f)).status, 'REJECTED'); assert.equal(await unread(f), true); assert.equal(await audit(f), 1);
        assert.equal(await f.control.locator('[data-time-target]').count(), 0);
        await context.unroute(origin + '/api/notifications', handler);
      });
      for (const mode of ['html-after-commit', 'lost-after-commit', 'wrong-id-after-commit']) await scenario(label(mode + ' seals the row and reloads without replay'), async () => {
        f = await fixture(); const before = posts.length, beforePatches = patches.length;
        const handler = async route => {
          const response = await route.fetch(); assert.equal(response.status(), 200);
          if (mode === 'lost-after-commit') await route.abort('failed');
          else if (mode === 'html-after-commit') await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Deliberate response failure</html>' });
          else { const body = await response.json(); body.data.id = 'other-record'; await route.fulfill({ response, body: JSON.stringify(body) }); }
        };
        await context.route(origin + f.path, handler); page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="APPROVED"]').click();
        await f.control.locator('[data-time-transition-result="unknown"]').waitFor();
        assert.equal((await state(f)).status, 'APPROVED'); assert.equal(await audit(f), 1); assert.equal(await unread(f), true);
        assert.equal(patches.length, beforePatches); assert.equal(await f.control.locator('[data-time-target]').count(), 0);
        await context.unroute(origin + f.path, handler);
        await f.control.locator('[data-time-transition-reload]').click(); await page.waitForLoadState('networkidle');
        assert.equal(posts.length - before, 1); assert.equal(await audit(f), 1); await identity();
      });
      await scenario(label('missing effective schedule is a real 409 with no audit or acknowledgement'), async () => {
        f = await fixture({ schedule: false }); page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="APPROVED"]').click();
        await f.control.locator('[data-time-transition-result="rejected"]').waitFor();
        assert.equal((await state(f)).status, 'SUBMITTED'); assert.equal(await audit(f), 0); assert.equal(await unread(f), true);
        assert.equal(await f.control.locator('[data-time-target]').count(), 0);
      });
      await scenario(label('stale state does not replay or close a notification'), async () => {
        f = await fixture(); await db.timeEntry.update({ where: { id: f.record.id }, data: { status: 'REJECTED' } });
        page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="APPROVED"]').click();
        await f.control.locator('[data-time-transition-result="rejected"]').waitFor();
        assert.equal((await state(f)).status, 'REJECTED'); assert.equal(await audit(f), 0); assert.equal(await unread(f), true);
      });
      if (role === 'manager') {
        await scenario(label('self-approval stays hidden and is rejected by the actual API'), async () => {
          f = await fixture({ employmentId: managerEmploymentId });
          assert.equal(await f.control.locator('[data-time-target]').count(), 0);
          const response = await context.request.post(origin + f.path, { headers: { Origin: origin }, data: { status: 'APPROVED' } });
          assert.equal(response.status(), 403); assert.equal((await state(f)).status, 'SUBMITTED'); assert.equal(await audit(f), 0);
        });
      } else {
        await scenario(label('operational draft submission clears metadata and does not acknowledge'), async () => {
          f = await fixture({ status: 'DRAFT' }); const beforePatches = patches.length;
          page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="SUBMITTED"]').click();
          await f.control.locator('[data-time-transition-result="saved"]').waitFor();
          assert.equal((await state(f)).status, 'SUBMITTED'); assert.equal((await state(f)).approvedById, null);
          assert.equal((await state(f)).approvedAt, null); assert.equal(await audit(f), 1); assert.equal(patches.length, beforePatches);
        });
        await scenario(label('the actual approver cannot also lock for payroll'), async () => {
          f = await fixture(); page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="APPROVED"]').click();
          await eventually(async () => (await state(f)).status === 'APPROVED');
          await page.reload({ waitUntil: 'networkidle' });
          page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="LOCKED"]').click();
          await f.control.locator('[data-time-transition-result="rejected"]').waitFor();
          assert.equal((await state(f)).status, 'APPROVED'); assert.equal(await audit(f, 'LOCKED'), 0);
        });
        await scenario(label('independent HR lock after actual manager approval persists exactly once'), async () => {
          f = await fixture();
          const independent = await browser.newContext();
          try {
            await login(independent, 'audit.manager', 'en');
            const approval = await independent.request.post(origin + f.path, { headers: { Origin: origin }, data: { status: 'APPROVED' } });
            assert.equal(approval.status(), 200);
          } finally { await independent.close(); }
          await page.reload({ waitUntil: 'networkidle' }); const beforePatches = patches.length;
          page.once('dialog', d => d.accept()); await f.control.locator('[data-time-target="LOCKED"]').click();
          await f.control.locator('[data-time-transition-result="saved"]').waitFor();
          assert.equal((await state(f)).status, 'LOCKED'); assert.equal((await state(f)).approvedById, manager.id);
          assert.equal(await audit(f, 'APPROVED'), 1); assert.equal(await audit(f, 'LOCKED'), 1);
          assert.equal(patches.length, beforePatches); assert.equal(await f.control.locator('[data-time-target]').count(), 0);
        });
      }
      await scenario(label('principal, JavaScript health and document width remain intact'), async () => {
        await identity(); assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      });
    } finally { await context.close(); }
  }
} finally {
  await writeFile('.audit/time-transition-browser.json', JSON.stringify(report, null, 2));
  await browser.close(); await db.$disconnect();
}
console.log('TIME_TRANSITION_BROWSER ' + JSON.stringify({ checks: report.checks.length, failures: report.failures }));
