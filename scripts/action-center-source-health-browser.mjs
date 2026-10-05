/** Real local manager login/queue read; injected source flags only, never domain writes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100', endpoint = origin + '/api/action-center';
const db = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
assert.ok(['localhost','127.0.0.1'].includes(db.hostname));
assert.equal(db.pathname, '/hrbp_audit'); assert.equal(db.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const keys = ['growthDegraded','employeeLifecycleDegraded','documentSignatureDegraded','recruitingDegraded','policyDegraded','workforcePlanningDegraded','privacyDegraded','engagementDegraded','workflowDefinitionDegraded'];
const healthy = Object.fromEntries(keys.map(key => [key, false]));
const report = { source: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(), checks: [], failures: [], scope: 'Manager EN desktop/TR mobile. Real form login and real queue, controlled source flags only; no domain mutation or actual database outage.' };
const browser = await chromium.launch({ headless: true });
await mkdir('.audit', { recursive: true });
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); }
  catch (e) { report.checks.push({ name, passed: false }); report.failures.push(name); throw e; }
}
try {
  for (const [locale, width] of [['en',1280],['tr',390]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], writes = []; let tracking = false;
    page.on('pageerror', e => errors.push(e.name));
    page.on('request', req => { if (tracking && ['POST','PATCH','PUT','DELETE'].includes(req.method()) && new URL(req.url()).pathname.startsWith('/api/')) writes.push(new URL(req.url()).pathname); });
    const center = page.locator('.workflow-action-center');
    const ready = () => page.waitForFunction(() => document.querySelector('.workflow-action-center')?.dataset.queueState === 'ready');
    const refresh = () => center.locator('.workflow-action-head button').click();
    const identity = async () => { const r = await context.request.get(origin + '/api/auth/session'); const b = await r.json(); assert.equal(b.authenticated, true); assert.equal(b.user.id, 'qa-audit-manager'); };
    try {
      await check(`${locale}: real form login and real source-status response`, async () => {
        await page.goto(origin + '/auth/sign-in?returnTo=%2Fmodule%2Fworkflows', { waitUntil: 'networkidle' });
        await page.locator('#local-identifier').fill('audit.manager');
        await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        await page.locator('.local-auth-card button[type="submit"]').click();
        await page.waitForURL(origin + '/module/workflows'); await ready(); await identity();
      });
      tracking = true;
      const response = await context.request.get(endpoint); assert.equal(response.status(), 200);
      const actual = await response.json();
      for (const key of keys) if (Object.hasOwn(actual.data, key)) assert.equal(typeof actual.data[key], 'boolean', `Invalid server flag ${key}`);
      const stamp = new Date().toISOString();
      const row = { id: 'time:source-health-qa', kind: 'time-attendance', title: 'HEALTH QA current', subtitle: 'Synthetic read only', module: 'time-attendance', href: '/module/time-attendance', subjectType: 'Employment', subjectId: 'source-health-qa', status: 'SUBMITTED', dueAt: null, createdAt: stamp, urgency: 'normal', action: { type: 'approve-time', entryId: 'source-health-qa' }, secondaryAction: { type: 'reject-time', entryId: 'source-health-qa' } };
      let mode = 'healthy';
      const handler = async route => {
        if (mode === 'real') return route.continue();
        const data = { ...actual.data, ...healthy, items: [row], summary: { ...actual.data.summary, total: 1, timeAttendance: 1 } };
        if (mode === 'partial' || mode === 'empty') data.recruitingDegraded = true;
        if (mode === 'empty') { data.items = []; data.summary.total = 0; }
        if (mode === 'all') for (const key of keys) data[key] = true;
        if (mode === 'unknown') for (const key of keys) delete data[key];
        if (mode === 'invalid') data.recruitingDegraded = 'false';
        return route.fulfill({ status: 200, json: { data } });
      };
      await context.route(endpoint, handler);
      await check(`${locale}: healthy reported sources preserve normal metrics and filters`, async () => {
        await refresh(); await ready();
        assert.equal(await center.getAttribute('data-source-state'), 'reported');
        assert.equal(await center.locator('[data-queue-source-health]').count(), 0);
        assert.equal(await center.locator('.workflow-action-metrics strong').first().innerText(), '1');
        await center.locator('.workflow-action-search input').fill('HEALTH QA'); await center.locator('.workflow-action-toggle').click();
      });
      await check(`${locale}: partial source is named and totals are not presented as complete`, async () => {
        mode = 'partial'; await refresh(); await ready();
        assert.equal(await center.getAttribute('data-source-state'), 'partial');
        assert.ok((await center.locator('[data-queue-source-health]').innerText()).includes(locale === 'tr' ? 'İşe alım' : 'Recruiting'));
        assert.equal(await center.locator('.workflow-action-metrics strong').first().innerText(), '—');
        assert.equal(await center.locator('tbody tr[id]').count(), 1);
        assert.equal(await center.locator('tbody .primary-button').isEnabled(), true);
      });
      await check(`${locale}: empty partial source cannot claim there is no pending work`, async () => {
        mode = 'empty'; await refresh(); await ready();
        assert.equal(await center.locator('[data-queue-incomplete-empty]').count(), 1);
        assert.ok(!(await center.innerText()).includes(locale === 'tr' ? 'Bu görünümde bekleyen aksiyon yok.' : 'No pending actions in this view.'));
      });
      await check(`${locale}: all source warnings fit without widening the document`, async () => {
        const before = await page.evaluate(() => document.documentElement.scrollWidth);
        mode = 'all'; await refresh(); await ready();
        const text = await center.locator('[data-queue-source-health]').innerText();
        assert.ok(text.includes(locale === 'tr' ? 'İş akışı tanımları' : 'Workflow definitions'));
        const after = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(after <= Math.max(before, width), `Source warning widened document: ${before} -> ${after}`);
      });
      await check(`${locale}: omitted flags are unknown rather than falsely healthy`, async () => {
        mode = 'unknown'; await refresh(); await ready();
        assert.equal(await center.getAttribute('data-source-state'), 'unknown');
        assert.equal(await center.locator('[data-queue-source-health="unknown"]').count(), 1);
      });
      await check(`${locale}: wrong boolean shape rejects the complete queue`, async () => {
        mode = 'invalid'; await refresh();
        await page.waitForFunction(() => document.querySelector('.workflow-action-center')?.dataset.queueState === 'unavailable');
        assert.equal(await center.getAttribute('data-source-state'), 'unverified');
        for (const button of await center.locator('tbody .workflow-row-actions button').all()) assert.equal(await button.isDisabled(), true);
      });
      await check(`${locale}: explicit recovery clears warnings and preserves filters without domain replay`, async () => {
        mode = 'healthy'; await refresh(); await ready();
        assert.equal(await center.locator('[data-queue-source-health]').count(), 0);
        assert.equal(await center.locator('.workflow-action-metrics strong').first().innerText(), '1');
        assert.equal(await center.locator('.workflow-action-search input').inputValue(), 'HEALTH QA');
        assert.equal(await center.locator('.workflow-action-toggle').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(writes, []);
      });
      await check(`${locale}: return to real queue retains identity and browser health`, async () => {
        mode = 'real'; await refresh(); await ready(); await identity(); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      });
    } finally { await context.close(); }
  }
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : 'Regression failed'); process.exitCode = 1;
} finally {
  await browser.close(); await writeFile('.audit/action-center-source-health-browser.json', JSON.stringify(report, null, 2));
  console.log('ACTION_CENTER_SOURCE_HEALTH_BROWSER', JSON.stringify({ checks: report.checks.length, failures: report.failures }));
}
