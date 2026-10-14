/** User-requested UI/CRUD inspection. Only an explicitly disposable loopback DB. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);
const output = '.audit/deep-ui';
await mkdir(`${output}/screenshots`, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { source, generatedAt: new Date().toISOString(), environment: 'Disposable loopback PostgreSQL + production Next.js + Chromium',
  pages: [], tests: [], findings: [], links: [], inventories: [], publicSurface: [],
  limitations: ['No production/customer CRUD or real provider calls.', 'A rendered page is not proof of every workflow or enabled button.',
    'Only explicitly named record workflows receive valid browser writes.', 'Layout and accessible-name heuristics require visual review.',
    'A public login probe is not authenticated production verification.'] };
const finding = (id, severity, detail) => report.findings.push({ id, severity, ...detail });
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const marker = `QAUI-${randomUUID().slice(0, 8).toUpperCase()}`;
const pass = process.env.HRBP_TEST_ADMIN_PASSWORD;
const slugs = [...new Set([...(await readFile('lib/navigation.ts', 'utf8')).matchAll(/slug:\s*"([^"]+)"/g)].map(x => x[1]))];
const routes = slugs.map(slug => slug === 'dashboard' ? '/' : `/module/${slug}`);
const key = path => path === '/' ? 'dashboard' : path.replace(/^\/module\//, '').replace(/[^a-z0-9-]/gi, '_');
async function contextFor(locale = 'en', theme = 'light', viewport = { width: 1440, height: 1000 }, identifier = 'local.admin') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (identifier) {
    const login = await context.request.post(`${origin}/api/auth/local`, { headers: { origin }, data: { identifier, password: pass }, timeout: 15000 });
    assert.equal(login.status(), 200, 'Disposable sign-in must succeed');
  }
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await context.addInitScript(({ locale, theme }) => {
    localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme);
  }, { locale, theme });
  return context;
}
async function ready(page, path) {
  const response = await page.goto(origin + path, { waitUntil: 'load', timeout: 25000 });
  await page.locator('.app-shell[data-session-loading="false"]').waitFor({ timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  return response;
}
async function shot(page, name) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const file = `screenshots/${name}.jpg`;
  await page.screenshot({ path: `${output}/${file}`, type: 'jpeg', quality: 72, fullPage: height <= 15000 });
  return file;
}
async function test(name, page, fn) {
  const started = Date.now();
  try { const detail = await fn(); report.tests.push({ name, passed: true, ms: Date.now() - started, ...detail }); }
  catch (error) {
    const row = { name, passed: false, ms: Date.now() - started, error: String(error.message).replaceAll(pass, '[redacted]').slice(0, 500) };
    if (page && !page.isClosed()) row.screenshot = await shot(page, `failure-${report.tests.length}`).catch(() => null);
    report.tests.push(row); finding('FLOW_FAILURE', 'HIGH', row);
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
const mutation = (page, path, method, click) => Promise.all([
  page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method, { timeout: 15000 }), click()
]).then(([response]) => response);
const links = new Map();
try {
  // Full module matrix: screenshots are taken AFTER identity and locale hydration.
  const variants = [
    { id: 'desktop-en-light', locale: 'en', theme: 'light', width: 1440, height: 1000 },
    { id: 'desktop-tr-dark', locale: 'tr', theme: 'dark', width: 1440, height: 1000 },
    { id: 'tablet-tr-light', locale: 'tr', theme: 'light', width: 768, height: 1024 },
    { id: 'mobile-en-dark', locale: 'en', theme: 'dark', width: 390, height: 844 },
    { id: 'mobile-tr-light', locale: 'tr', theme: 'light', width: 390, height: 844 },
    { id: 'narrow-tr-dark', locale: 'tr', theme: 'dark', width: 320, height: 800 }
  ];
  for (const v of variants) {
    const context = await contextFor(v.locale, v.theme, { width: v.width, height: v.height });
    const page = await context.newPage();
    try {
      for (const path of routes) {
        const errors = [], serverErrors = [];
        const onError = error => errors.push(error.name);
        const onResponse = response => { if (response.status() >= 500) serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); };
        page.on('pageerror', onError); page.on('response', onResponse);
        const started = Date.now();
        try {
          const response = await ready(page, path);
          await page.waitForFunction(locale => document.documentElement.lang === locale, v.locale, { timeout: 5000 });
          // Use the real control to correct any persisted/default theme, not CSS injection.
          if (await page.evaluate(() => document.documentElement.dataset.theme) !== v.theme) {
            await page.locator('.theme-toggle').click();
            await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, v.theme, { timeout: 3000 });
          }
          const dom = await page.evaluate(() => {
            const area = document.querySelector('.page-content') || document.body;
            const visible = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
            const label = e => e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || [...(e.labels || [])].map(x => x.textContent.trim()).join(' ') || e.getAttribute('title') || '';
            const controls = [...area.querySelectorAll('input:not([type=hidden]):not([type=password]),select,textarea')].filter(visible).map(e => ({
              tag: e.tagName, type: e.type || '', name: e.name || e.id || '', label: label(e), placeholder: e.getAttribute('placeholder') || '', required: e.required, disabled: e.disabled,
              width: Math.round(e.getBoundingClientRect().width)
            }));
            const buttons = [...area.querySelectorAll('button')].filter(visible).map(e => ({ text: e.textContent.trim(), name: label(e) || e.textContent.trim(), disabled: e.disabled, type: e.type }));
            const anchors = [...document.querySelectorAll('a[href]')].map(e => ({ href: e.getAttribute('href'), text: e.textContent.trim().slice(0, 100) }));
            return { title: area.querySelector('h1')?.textContent?.trim(), lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
              overflow: document.documentElement.scrollWidth > innerWidth + 2, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
              sessionLoading: document.querySelector('.app-shell')?.dataset.sessionLoading,
              unavailable: area.querySelectorAll('[data-core-workspace-state="unavailable"],[data-module-workspace-state="unavailable"]').length,
              headings: [...area.querySelectorAll('h2,h3')].map(e => e.textContent.trim()),
              brokenImages: [...area.querySelectorAll('img')].filter(e => e.complete && !e.naturalWidth).length,
              tables: area.querySelectorAll('table').length, forms: area.querySelectorAll('form').length, controls, buttons, anchors,
              englishAuthoringInTurkish: document.documentElement.lang === 'tr' ? buttons.filter(b => /^(Survey authoring|Create survey|Edit survey|Delete survey|Add question|Create draft campaign)$/.test(b.text)).map(b => b.text) : [] };
          });
          const row = { path, variant: v.id, status: response.status(), ms: Date.now() - started, ...dom, errors, serverErrors };
          if (!v.id.startsWith('narrow')) row.screenshot = await shot(page, `${key(path)}--${v.id}`);
          delete row.anchors; report.pages.push(row);
          if (v.id === 'desktop-en-light') report.inventories.push({ path, headings: dom.headings, forms: dom.forms, controls: dom.controls, buttons: dom.buttons });
          for (const a of dom.anchors) {
            if (!a.href || a.href.startsWith('#') || /^(mailto:|tel:)/.test(a.href)) continue;
            const u = new URL(a.href, page.url());
            if (u.origin === origin && !/^\/api\/auth\//.test(u.pathname)) links.set(u.pathname + u.search, { path: u.pathname + u.search, source: path, text: a.text });
          }
          if (row.status >= 400 || errors.length || serverErrors.length || dom.unavailable) finding('PAGE_FAILURE', 'HIGH', { path, variant: v.id, status: row.status, errors, serverErrors, unavailable: dom.unavailable, screenshot: row.screenshot });
          if (dom.overflow) finding('DOCUMENT_OVERFLOW', 'MEDIUM', { path, variant: v.id, width: dom.documentWidth, viewport: dom.viewportWidth, screenshot: row.screenshot });
          if (dom.englishAuthoringInTurkish.length) finding('UNLOCALIZED_AUTHORING', 'MEDIUM', { path, variant: v.id, controls: dom.englishAuthoringInTurkish, screenshot: row.screenshot });
          if (dom.brokenImages) finding('BROKEN_IMAGE', 'MEDIUM', { path, variant: v.id, count: dom.brokenImages });
        } catch (error) {
          const row = { path, variant: v.id, error: String(error.message).slice(0, 350), ms: Date.now() - started };
          row.screenshot = await shot(page, `${key(path)}--${v.id}-error`).catch(() => null);
          report.pages.push(row); finding('PAGE_TEST_FAILURE', 'HIGH', row);
        } finally { page.off('pageerror', onError); page.off('response', onResponse); }
      }
    } finally { await context.close(); }
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    console.log('UI_MATRIX_VARIANT ' + v.id + ' completed');
  }

  const context = await contextFor();
  const page = await context.newPage();
  try {
    // Links are evaluated on the authenticated principal; no auth actions or external links.
    for (const entry of links.values()) {
      try {
        const response = await context.request.get(origin + entry.path, { timeout: 15000, maxRedirects: 0 });
        const location = response.headers().location || '';
        const row = { ...entry, status: response.status(), location: location.split('?')[0] };
        report.links.push(row);
        if (row.status >= 400 || (row.status >= 300 && location.includes('/auth/sign-in'))) finding('BROKEN_AUTHENTICATED_LINK', 'HIGH', row);
      } catch (error) { finding('LINK_TEST_FAILURE', 'HIGH', { ...entry, error: error.name }); }
    }
    let positionId, personId, surveyId;
    await test('positions: required fields stop empty submission without a network write', page, async () => {
      await ready(page, '/module/positions/new');
      let writes = 0; const listener = r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/positions') writes++; };
      page.on('request', listener);
      try { await page.locator('button[type=submit]').click(); assert.ok(await page.locator('input:invalid,select:invalid').count()); assert.equal(writes, 0); }
      finally { page.off('request', listener); }
    });
    async function fillPosition(code = marker) {
      await page.locator('#positionCode').fill(code); await page.locator('#title').fill(`${marker} UI Test Position`);
      const orgId = await page.locator('#orgUnitId option').evaluateAll(options => options.find(o => o.value)?.value);
      assert.ok(orgId); await page.locator('#orgUnitId').selectOption(orgId);
      await page.locator('#jobFamily').fill('QA'); await page.locator('#grade').fill('QA1'); await page.locator('#location').fill('Synthetic test only');
    }
    await test('positions: create through UI, return to register and verify persistence', page, async () => {
      await ready(page, '/module/positions/new'); await fillPosition();
      const response = await mutation(page, '/api/positions', 'POST', () => page.locator('button[type=submit]').click());
      assert.equal(response.status(), 201); positionId = (await response.json()).data.id;
      await page.waitForURL('**/module/positions'); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.ok((await page.locator('.page-content').innerText()).includes(marker));
      assert.equal((await db.position.findUnique({ where: { id: positionId } })).positionCode, marker);
      return { screenshot: await shot(page, 'positions-created') };
    });
    await test('positions: duplicate code reports conflict, retains input and does not duplicate row', page, async () => {
      assert.ok(positionId); await ready(page, '/module/positions/new'); await fillPosition();
      const response = await mutation(page, '/api/positions', 'POST', () => page.locator('button[type=submit]').click());
      assert.equal(response.status(), 409); await page.locator('.form-error').waitFor();
      assert.equal(await page.locator('#positionCode').inputValue(), marker);
      assert.equal(await db.position.count({ where: { positionCode: marker } }), 1);
      return { screenshot: await shot(page, 'positions-duplicate-validation') };
    });
    await test('positions: interrupted request displays error and preserves draft', page, async () => {
      await ready(page, '/module/positions/new'); await fillPosition(`${marker}-NET`);
      await page.route('**/api/positions', r => r.abort('failed'));
      try { await page.locator('button[type=submit]').click(); await page.locator('.form-error').waitFor();
        assert.equal(await page.locator('#positionCode').inputValue(), `${marker}-NET`);
        assert.equal(await db.position.count({ where: { positionCode: `${marker}-NET` } }), 0);
      } finally { await page.unroute('**/api/positions'); }
    });
    await test('people: create employee through UI, verify 360 view, assignment and onboarding', page, async () => {
      assert.ok(positionId); await ready(page, '/module/people/new');
      await page.locator('#employeeNumber').fill(marker); await page.locator('#givenName').fill('Synthetic');
      await page.locator('#familyName').fill(marker); await page.locator('#workEmail').fill(`${marker.toLowerCase()}@example.test`);
      await page.locator('#startDate').fill(new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10));
      await page.locator('#positionId').selectOption(positionId);
      const response = await mutation(page, '/api/people', 'POST', () => page.locator('button[type=submit]').click());
      assert.equal(response.status(), 201); personId = (await response.json()).data.person.id;
      await page.waitForURL('**/module/employee-360?person=*');
      await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.ok((await page.locator('.page-content').innerText()).includes(marker));
      assert.ok(await db.employment.findFirst({ where: { personId, positionId } }));
      assert.ok(await db.onboardingPlan.findFirst({ where: { personId } }));
      await page.reload({ waitUntil: 'load' }); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.ok((await page.locator('.page-content').innerText()).includes(marker));
      return { screenshot: await shot(page, 'employee-created-360') };
    });

    // Read only: prove absence/presence of seeded live data in public form options.
    const anonymous = await contextFor('en', 'light', { width: 1440, height: 1000 }, null);
    try {
      const anonPage = await anonymous.newPage();
      for (const [path, selector, field] of [['/module/people/new', '#positionId', 'position choices'], ['/module/positions/new', '#orgUnitId', 'organization choices']]) {
        await test(`authorization: anonymous ${path} must not disclose live ${field}`, anonPage, async () => {
          const response = await ready(anonPage, path);
          const options = await anonPage.locator(`${selector} option`).allTextContents();
          const nonPlaceholderCount = Math.max(0, options.length - 1);
          const screenshot = await shot(anonPage, `anonymous-${key(path)}`);
          report.publicSurface.push({ path, status: response.status(), nonPlaceholderCount, screenshot });
          assert.equal(nonPlaceholderCount, 0, `Anonymous form exposes ${nonPlaceholderCount} seeded live ${field}`);
        });
      }
    } finally { await anonymous.close(); }

    await test('engagement: open survey authoring and validate empty form', page, async () => {
      await ready(page, '/module/engagement'); await page.getByRole('button', { name: 'Survey authoring', exact: true }).click();
      await page.getByRole('button', { name: 'Create survey', exact: true }).click();
      await page.getByText('Survey code and name are required.', { exact: true }).waitFor();
    });
    await test('engagement: create survey through UI and select persistent record', page, async () => {
      await page.getByLabel('Survey code', { exact: true }).fill(marker);
      await page.getByLabel('Survey name', { exact: true }).fill(`${marker} survey`);
      const response = await mutation(page, '/api/engagement/surveys', 'POST', () => page.getByRole('button', { name: 'Create survey', exact: true }).click());
      assert.equal(response.status(), 201); surveyId = (await response.json()).data.id;
      await page.getByRole('button', { name: 'Edit survey', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Survey', { exact: true }).inputValue(), surveyId);
    });
    await test('engagement: edit survey metadata and verify saved value', page, async () => {
      assert.ok(surveyId); await page.getByRole('button', { name: 'Edit survey', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).fill(`${marker} edited`);
      const response = await mutation(page, `/api/engagement/surveys/${surveyId}`, 'PATCH', () => page.getByRole('button', { name: 'Save survey', exact: true }).click());
      assert.equal(response.status(), 200);
      assert.equal((await db.engagementSurvey.findUnique({ where: { id: surveyId } })).name, `${marker} edited`);
    });
    let questionId;
    await test('engagement: add and edit a question through UI', page, async () => {
      assert.ok(surveyId); await page.getByLabel('Question key', { exact: true }).fill('QA_Q1');
      await page.getByLabel('Prompt', { exact: true }).fill('Synthetic initial question');
      const created = await mutation(page, `/api/engagement/surveys/${surveyId}/questions`, 'POST', () => page.getByRole('button', { name: 'Add question', exact: true }).click());
      assert.equal(created.status(), 201); questionId = (await created.json()).data.id;
      const row = page.getByRole('row').filter({ hasText: 'QA_Q1' });
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByLabel('Prompt', { exact: true }).fill('Synthetic edited question');
      const edited = await mutation(page, `/api/engagement/surveys/${surveyId}/questions/${questionId}`, 'PATCH', () => page.getByRole('button', { name: 'Save question', exact: true }).click());
      assert.equal(edited.status(), 200);
      await page.getByText('Synthetic edited question', { exact: true }).waitFor();
      return { screenshot: await shot(page, 'survey-question-edited') };
    });
    await test('engagement: delete confirmation cancellation preserves record', page, async () => {
      assert.ok(surveyId); page.once('dialog', d => d.dismiss());
      await page.getByRole('button', { name: 'Delete survey', exact: true }).click();
      assert.ok(await db.engagementSurvey.findUnique({ where: { id: surveyId } }));
    });
    await test('engagement: delete question and verify removal', page, async () => {
      assert.ok(questionId); const row = page.getByRole('row').filter({ hasText: 'QA_Q1' });
      page.once('dialog', d => d.accept());
      const response = await mutation(page, `/api/engagement/surveys/${surveyId}/questions/${questionId}`, 'DELETE', () => row.getByRole('button', { name: 'Delete', exact: true }).click());
      assert.equal(response.status(), 200);
      await page.getByText('No questions authored yet.', { exact: true }).waitFor();
      const saved = await db.engagementSurvey.findUnique({ where: { id: surveyId }, include: { questions: true } });
      assert.equal(saved.questions.length, 0);
    });
    await test('engagement: delete unused survey and verify removal survives refresh', page, async () => {
      assert.ok(surveyId); page.once('dialog', d => d.accept());
      const response = await mutation(page, `/api/engagement/surveys/${surveyId}`, 'DELETE', () => page.getByRole('button', { name: 'Delete survey', exact: true }).click());
      assert.equal(response.status(), 200); assert.equal(await db.engagementSurvey.findUnique({ where: { id: surveyId } }), null);
      await page.reload({ waitUntil: 'load' }); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      await page.getByRole('button', { name: 'Survey authoring', exact: true }).click();
      assert.ok(!(await page.getByLabel('Survey', { exact: true }).locator('option').allTextContents()).some(t => t.includes(marker)));
    });
    await test('mobile: opening authoring remains usable at 390px and 320px', page, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const at390 = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      const screenshot = await shot(page, 'mobile-survey-authoring-open');
      await page.setViewportSize({ width: 320, height: 800 });
      const at320 = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      report.tests.push({ name: 'opened-authoring-layout-evidence', at390, at320, screenshot, passed: at390.width <= 392 && at320.width <= 322 });
      assert.ok(at390.width <= 392 && at320.width <= 322, `Open authoring widths: ${JSON.stringify({ at390, at320 })}`);
    });
  } finally { await context.close(); }

  // Safe public GET-only live probe. Never use the ephemeral CI password remotely.
  if (process.env.HRBP_UI_PUBLIC_PROBE === 'true') {
    const liveOrigin = 'https://hrbp.fornostsecurity.com';
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await context.route('**/*', route => {
        const request = route.request(), u = new URL(request.url());
        return u.origin === liveOrigin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      try {
        const response = await page.goto(`${liveOrigin}/auth/sign-in`, { waitUntil: 'load', timeout: 20000 });
        report.livePublicProbe = { requestedPath: '/auth/sign-in', status: response?.status(), finalHost: new URL(page.url()).hostname,
          title: await page.title(), passwordInputs: await page.locator('input[type=password]').count(), screenshot: await shot(page, 'live-public-login') };
      } catch (error) { report.livePublicProbe = { requestedPath: '/auth/sign-in', error: error.name, authenticated: false }; }
    } finally { await context.close(); }
  }
} finally {
  await browser.close(); await db.$disconnect();
  report.completedAt = new Date().toISOString();
  report.summary = { modules: slugs.length, visualViews: report.pages.length, screenshots: report.pages.filter(p => p.screenshot).length,
    workflowTests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length,
    internalLinks: report.links.length, findings: report.findings.length };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log('UI_DEEP_AUDIT_SUMMARY ' + JSON.stringify(report.summary));
}
// Evidence is always retained. A critical flow/auth/page defect fails this gate;
// heuristics remain review candidates, not claims that every control is broken.
if (report.findings.some(f => f.severity === 'HIGH' || f.severity === 'CRITICAL')) process.exitCode = 1;
