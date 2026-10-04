/** Healthy core pages must not pass merely because a rendered error shell is HTTP 200. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD, 'Disposable fixture password is required');
const roles = { admin: 'TENANT_ADMIN', employee: 'EMPLOYEE', manager: 'MANAGER', hrbp: 'HRBP' };
const headings = {
  people: { en: 'People', tr: 'Çalışanlar' },
  organization: { en: 'Organization', tr: 'Organizasyon' },
  positions: { en: 'Positions', tr: 'Pozisyonlar' },
  'employee-360': { en: 'Employee 360', tr: 'Çalışan 360' }
};
const report = { checks: [], failures: [], scope: 'Chromium; disposable accounts; healthy renders, not real data-outage recovery' };
await mkdir('.audit', { recursive: true });
const browser = await chromium.launch();
try {
  for (const [role, expectedRole] of Object.entries(roles)) for (const locale of ['en', 'tr']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      // Use only the previously created disposable QA identities, never live accounts.
      const login = await context.request.post(origin + '/api/auth/local', {
        headers: { origin, 'content-type': 'application/json' },
        data: { identifier: `audit.${role}`, password: process.env.HRBP_TEST_ADMIN_PASSWORD },
        timeout: 15000
      });
      assert.equal(login.status(), 200, `Fixture sign-in failed for ${role}`);
      await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
      await context.addInitScript(selected => { localStorage.setItem('hrbp-locale', selected); }, locale);
      const page = await context.newPage();
      for (const [slug, titles] of Object.entries(headings)) {
        const errors = [];
        const onError = error => errors.push(error.name);
        page.on('pageerror', onError);
        try {
          const response = await page.goto(`${origin}/module/${slug}`, { waitUntil: 'load', timeout: 25000 });
          assert.equal(response.status(), 200);
          await page.locator('.app-shell[data-session-loading="false"]').waitFor({ timeout: 10000 });
          assert.equal(await page.locator('[data-core-workspace-state="unavailable"]').count(), 0, 'Error panels must never pass as healthy page renders');
          assert.equal(await page.locator('.page-heading h1').textContent(), titles[locale]);
          assert.equal(await page.locator('.module-heading-actions button[disabled]').count(), 0, 'Status labels must not be disabled action buttons');
          const sessionResponse = await context.request.get(origin + '/api/auth/session', { timeout: 15000 });
          assert.equal(sessionResponse.status(), 200);
          const session = await sessionResponse.json();
          assert.equal(session.authenticated, true);
          assert.equal(session.user.id, `qa-audit-${role}`);
          assert.equal(session.user.role, expectedRole);
          assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'Core page must fit a narrow viewport');
          assert.deepEqual(errors, []);
          report.checks.push({ role, locale, slug, passed: true });
        } catch (error) {
          const failure = { role, locale, slug, passed: false, message: String(error.message).slice(0, 300) };
          report.checks.push(failure); report.failures.push(failure);
        } finally { page.off('pageerror', onError); }
      }
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile('.audit/core-workspace-browser.json', JSON.stringify(report, null, 2));
  console.log('CORE_WORKSPACE_BROWSER ' + JSON.stringify(report));
}
assert.equal(report.checks.length, 32, 'All four roles, two locales and four core pages must be exercised');
assert.deepEqual(report.failures, [], 'Core workspace healthy-path regression failed');
