/** Real Chromium + real form login + real queue read; controlled response faults, no domain writes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const origin = 'http://localhost:3100', endpoint = origin + '/api/action-center';
const db = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(db.hostname));
assert.equal(db.pathname, '/hrbp_audit'); assert.equal(db.search, '');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [], failures: [],
  scope: 'MANAGER, real local login and queue read; controlled queue responses in EN desktop/TR mobile. No domain mutation or deployment test.' };
const browser = await chromium.launch({ headless: true });
await mkdir('.audit', { recursive: true });
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); }
  catch (e) { report.checks.push({ name, passed: false }); report.failures.push(name); throw e; }
}
try {
  for (const [locale, width] of [['en', 1280], ['tr', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], writes = []; page.on('pageerror', e => errors.push(e.name));
    let tracking = false;
    page.on('request', req => { if (tracking && ['POST','PATCH','DELETE','PUT'].includes(req.method()) && new URL(req.url()).pathname.startsWith('/api/')) writes.push(new URL(req.url()).pathname); });
    const center = page.locator('.workflow-action-center');
    const ready = () => page.waitForFunction(() => document.querySelector('.workflow-action-center')?.dataset.queueState === 'ready');
    const unavailable = () => page.waitForFunction(() => document.querySelector('.workflow-action-center')?.dataset.queueState === 'unavailable');
    const refresh = () => center.locator('.workflow-action-head button').click();
    const identity = async () => { const r = await context.request.get(origin + '/api/auth/session'); const body = await r.json(); assert.equal(body.authenticated, true); assert.equal(body.user.id, 'qa-audit-manager'); };
    try {
      await check(`${locale}: real login, queue decoding and principal`, async () => {
        await page.goto(origin + '/auth/sign-in?returnTo=%2Fmodule%2Fworkflows', { waitUntil: 'networkidle' });
        await page.locator('#local-identifier').fill('audit.manager');
        await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
        await page.locator('.local-auth-card button[type="submit"]').click();
        await page.waitForURL(origin + '/module/workflows'); await ready(); await identity();
      });
      tracking = true;
      const actual = await context.request.get(endpoint); assert.equal(actual.status(), 200);
      const snapshot = await actual.json(); assert.ok(snapshot.data.generatedAt);
      const stamp = new Date().toISOString();
      const timeRow = { id: 'time:queue-only-qa', kind: 'time-attendance', title: 'QUEUE QA current', subtitle: 'Synthetic read only', module: 'time-attendance', href: '/module/time-attendance', subjectType: 'Employment', subjectId: 'queue-only-qa', status: 'SUBMITTED', dueAt: null, createdAt: stamp, urgency: 'normal', action: { type: 'approve-time', entryId: 'queue-only-qa' }, secondaryAction: { type: 'reject-time', entryId: 'queue-only-qa' } };
      const valid = { data: { ...snapshot.data, items: [timeRow], summary: { ...snapshot.data.summary, total: 1, timeAttendance: 1 } } };
      let mode = 'valid';
      const handler = async route => {
        if (mode === 'real') return route.continue();
        if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>RAW_PRIVATE_QUEUE_ERROR</html>' });
        if (mode === 'missing') return route.fulfill({ status: 200, json: {} });
        if (mode === 'bad-row') return route.fulfill({ status: 200, json: { data: { ...valid.data, items: [{ ...timeRow, dueAt: 'invalid-date' }] } } });
        if (mode === 'session') return route.fulfill({ status: 401, contentType: 'text/html', body: 'RAW_PRIVATE_QUEUE_ERROR' });
        return route.fulfill({ status: 200, json: valid });
      };
      await context.route(endpoint, handler);
      await check(`${locale}: valid read-only fixture and user filters`, async () => {
        await refresh(); await ready();
        await center.locator('.workflow-action-search input').fill('QUEUE QA');
        await center.locator('.workflow-action-toggle').click();
        assert.equal(await center.locator('tbody tr[id]').count(), 1);
      });
      for (const fault of ['html', 'missing', 'bad-row']) await check(`${locale}: ${fault} is unavailable, not empty success; generic controls disabled`, async () => {
        mode = fault; await refresh(); await unavailable();
        assert.equal(await center.locator('tbody tr[id]').count(), 1);
        for (const button of await center.locator('tbody .workflow-row-actions button').all()) assert.equal(await button.isDisabled(), true);
        assert.equal(await center.locator('.workflow-action-metrics strong').first().innerText(), '—');
        assert.ok(!(await center.innerText()).includes('RAW_PRIVATE_QUEUE_ERROR'));
        assert.ok(!(await center.innerText()).includes(locale === 'tr' ? 'Bu görünümde bekleyen aksiyon yok.' : 'No pending actions in this view.'));
      });
      await check(`${locale}: explicit retry restores queue without resetting filters or submitting writes`, async () => {
        mode = 'valid'; await refresh(); await ready();
        assert.equal(await center.locator('.workflow-action-search input').inputValue(), 'QUEUE QA');
        assert.equal(await center.locator('.workflow-action-toggle').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(writes, []);
      });
      await check(`${locale}: out-of-order browser replies cannot replace a newer snapshot`, async () => {
        await context.unroute(endpoint, handler);
        let release, entered; const gate = new Promise(r => { release = r; }), firstStarted = new Promise(r => { entered = r; }); let reads = 0;
        const race = async route => {
          if (++reads === 1) { entered(); await gate; try { await route.fulfill({ status: 200, json: { data: { ...valid.data, items: [{ ...timeRow, title: 'QUEUE QA obsolete' }] } } }); } catch { /* browser cancelled the superseded read */ } }
          else await route.fulfill({ status: 200, json: valid });
        };
        await context.route(endpoint, race);
        try {
          await page.evaluate(() => window.dispatchEvent(new Event('hrbp:lifecycle-actions-changed')));
          let waiting;
          try { await Promise.race([firstStarted, new Promise((_, reject) => { waiting = setTimeout(() => reject(new Error("Queue read did not start")), 10000); })]); } finally { clearTimeout(waiting); }
          await page.evaluate(() => window.dispatchEvent(new Event('hrbp:lifecycle-actions-changed')));
          await ready(); release();
          await page.waitForTimeout(100);
          assert.equal(await center.locator('tbody tr[id] strong').first().innerText(), 'QUEUE QA current');
          assert.equal(await center.getAttribute('data-queue-state'), 'ready');
        } finally { release(); await context.unroute(endpoint, race); }
        await context.route(endpoint, handler);
      });
      await check(`${locale}: explicit session failure clears protected records`, async () => {
        mode = 'session'; await refresh(); await unavailable(); assert.equal(await center.locator('tbody tr[id]').count(), 0);
      });
      await check(`${locale}: real queue recovers, principal and browser health remain intact`, async () => {
        mode = 'real'; await refresh(); await ready(); await identity(); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      });
    } finally { await context.close(); }
  }
} catch (e) {
  report.failures.push(e instanceof Error ? e.message : 'Regression failed');
  process.exitCode = 1;
} finally {
  await browser.close(); await writeFile('.audit/action-center-queue-browser.json', JSON.stringify(report, null, 2));
  console.log('ACTION_CENTER_QUEUE_BROWSER', JSON.stringify({ checks: report.checks.length, failures: report.failures }));
}
