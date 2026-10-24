/** Real production UI; only synthetic records in an explicitly disposable DB. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const origin = 'http://localhost:3100', database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname)); assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/deep-ui'; await mkdir(`${out}/screenshots`, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const slugs = [...new Set([...(await readFile('lib/navigation.ts', 'utf8')).matchAll(/slug:\s*"([^"]+)"/g)].map(m => m[1]))];
const routes = slugs.map(s => s === 'dashboard' ? '/' : `/module/${s}`);
const report = { source, generatedAt: new Date().toISOString(), pages: [], links: [], tests: [], findings: [],
  limitations: ['Disposable PostgreSQL + production Next.js + Chromium only; no production or provider requests.',
    'The six-variant sweep uses a platform administrator. Restricted domain views are not business-workflow completion.',
    'Only named CRUD flows are exercised. Screenshots/control inventories do not prove every enabled action works.'] };
const db = new PrismaClient(), browser = await chromium.launch();
const marker = `QAUI-${randomUUID().slice(0, 8).toUpperCase()}`, author = marker.toLowerCase() + '-author', reader = marker.toLowerCase() + '-reader';
const persist = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
const flag = (kind, details) => report.findings.push({ kind, ...details });
const fileKey = path => path === '/' ? 'dashboard' : path.replace(/^\/module\//, '').replace(/[^a-z0-9-]/gi, '_');
async function screenshot(page, name) {
  const path = `screenshots/${name}.jpg`, height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `${out}/${path}`, type: 'jpeg', quality: 72, fullPage: height < 15000 }); return path;
}
async function login(context, identifier, expectedRole) {
  const response = await context.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier, password }, timeout: 15000 });
  assert.equal(response.status(), 200);
  const session = await context.request.get(origin + '/api/auth/session'); const value = await session.json();
  assert.equal(value.authenticated, true); if (expectedRole) assert.equal(value.user.role, expectedRole);
}
async function contextFor(locale = 'en', theme = 'light', width = 1440, identifier = 'local.admin') {
  const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (identifier) await login(context, identifier);
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await context.addInitScript(({ locale, theme }) => { localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme); }, { locale, theme });
  return context;
}
async function ready(page, path) {
  const response = await page.goto(origin + path, { waitUntil: 'load', timeout: 25000 });
  await page.locator('.app-shell[data-session-loading="false"]').waitFor({ timeout: 12000 });
  await page.evaluate(() => document.fonts.ready); return response;
}
async function scenario(name, page, fn) {
  try { const detail = await fn(); report.tests.push({ name, passed: true, ...detail }); }
  catch (error) {
    const row = { name, passed: false, error: String(error.message).replaceAll(password, '[redacted]').slice(0, 600) };
    row.screenshot = await screenshot(page, `failure-${report.tests.length}`).catch(() => null);
    report.tests.push(row); flag('FLOW_FAILURE', row);
  }
  console.log('UI_SCENARIO ' + JSON.stringify(report.tests.at(-1))); await persist();
}
async function mutation(page, path, method, click) {
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method, { timeout: 20000 }), click()]); return response;
}
async function locale(page, value) {
  await page.locator('.locale-toggle button').filter({ hasText: value.toUpperCase() }).click();
  await page.waitForFunction(v => document.documentElement.lang === v, value);
}
try {
  const account = await db.userAccount.findUnique({ where: { id: 'user-local-test-admin' }, select: { tenantId: true, localPasswordHash: true } });
  assert.ok(account?.localPasswordHash);
  // TENANT_ADMIN intentionally has no engagement:write. Do not widen grants.
  for (const [subject, role] of [[author, 'HR_OPERATIONS'], [reader, 'EMPLOYEE']]) await db.userAccount.create({ data: {
    id: subject, tenantId: account.tenantId, subject, role, displayName: 'Synthetic QA', email: `${subject}@example.test`, active: true, localAuthEnabled: true, localPasswordHash: account.localPasswordHash
  } });
  const variants = [['desktop-en-light', 'en', 'light', 1440], ['desktop-tr-dark', 'tr', 'dark', 1440], ['tablet-tr-light', 'tr', 'light', 768], ['mobile-en-dark', 'en', 'dark', 390], ['mobile-tr-light', 'tr', 'light', 390], ['narrow-tr-dark', 'tr', 'dark', 320]];
  const links = new Set();
  for (const [variant, lang, theme, width] of variants) {
    const context = await contextFor(lang, theme, width), page = await context.newPage();
    try {
      for (const path of routes) {
        const errors = [], serverErrors = [];
        const onError = e => errors.push(e.name), onResponse = r => { if (r.status() >= 500) serverErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); };
        page.on('pageerror', onError); page.on('response', onResponse);
        try {
          const response = await ready(page, path);
          await page.waitForFunction(v => document.documentElement.lang === v, lang);
          if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.locator('.theme-toggle').click();
          await page.waitForFunction(v => document.documentElement.dataset.theme === v, theme);
          const data = await page.evaluate(() => {
            const area = document.querySelector('.page-content') || document.body;
            return { title: area.querySelector('h1')?.textContent?.trim(), lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
              width: document.documentElement.scrollWidth, viewport: innerWidth,
              unavailable: area.querySelectorAll('[data-core-workspace-state="unavailable"],[data-module-workspace-state="unavailable"]').length,
              brokenImages: [...area.querySelectorAll('img')].filter(e => e.complete && !e.naturalWidth).length,
              buttons: [...area.querySelectorAll('button')].map(e => ({ text: e.textContent.trim(), disabled: e.disabled, label: e.getAttribute('aria-label') })),
              forms: area.querySelectorAll('form').length, hrefs: [...document.querySelectorAll('a[href]')].map(e => e.getAttribute('href')) };
          });
          for (const href of data.hrefs) {
            const u = new URL(href, page.url());
            if (u.origin === origin && !/^\/api\/auth\//.test(u.pathname)) links.add(u.pathname + u.search);
          }
          delete data.hrefs;
          const row = { path, variant, status: response.status(), ...data, errors, serverErrors };
          if (!variant.startsWith('narrow')) row.screenshot = await screenshot(page, `${fileKey(path)}--${variant}`);
          report.pages.push(row);
          if (row.status >= 400 || errors.length || serverErrors.length || row.unavailable || row.brokenImages) flag('PAGE_FAILURE', row);
          if (row.width > width + 2) flag('DOCUMENT_OVERFLOW', { path, variant, width: row.width, viewport: width, screenshot: row.screenshot });
        } catch (error) { const row = { path, variant, error: error.name }; report.pages.push(row); flag('PAGE_TEST_FAILURE', row); }
        finally { page.off('pageerror', onError); page.off('response', onResponse); }
      }
    } finally { await context.close(); }
    console.log('UI_VARIANT ' + variant); await persist();
  }
  assert.equal(report.pages.length, routes.length * 6);
  const context = await contextFor(), page = await context.newPage();
  try {
    for (const path of links) {
      try { const r = await context.request.get(origin + path, { timeout: 15000, maxRedirects: 0 }); const row = { path, status: r.status() }; report.links.push(row); if (r.status() >= 400) flag('BROKEN_LINK', row); }
      catch (error) { flag('LINK_TEST_FAILURE', { path, error: error.name }); }
    }
    let positionId, personId, surveyId, questionId;
    async function fillPosition(code = marker) {
      await page.locator('#positionCode').fill(code); await page.locator('#title').fill(marker + ' test position');
      const org = await page.locator('#orgUnitId option').evaluateAll(options => options.find(o => o.value)?.value); assert.ok(org); await page.locator('#orgUnitId').selectOption(org);
    }
    await scenario('positions: empty required fields block POST', page, async () => {
      await ready(page, '/module/positions/new'); let writes = 0;
      const listener = r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/positions') writes++; }; page.on('request', listener);
      try { await page.locator('.record-form button[type=submit]').click(); assert.ok(await page.locator('input:invalid,select:invalid').count()); assert.equal(writes, 0); } finally { page.off('request', listener); }
    });
    await scenario('positions: create through UI and verify register + persisted row', page, async () => {
      await ready(page, '/module/positions/new'); await fillPosition();
      const response = await mutation(page, '/api/positions', 'POST', () => page.locator('.record-form button[type=submit]').click()); assert.equal(response.status(), 201); positionId = (await response.json()).data.id;
      await page.waitForURL('**/module/positions'); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.ok((await page.locator('.page-content').innerText()).includes(marker)); assert.equal((await db.position.findUnique({ where: { id: positionId } })).positionCode, marker);
      return { screenshot: await screenshot(page, 'position-created') };
    });
    await scenario('positions: duplicate conflict preserves draft and one stored row', page, async () => {
      assert.ok(positionId); await ready(page, '/module/positions/new'); await fillPosition();
      const response = await mutation(page, '/api/positions', 'POST', () => page.locator('.record-form button[type=submit]').click()); assert.equal(response.status(), 409); await page.locator('.form-error').waitFor();
      assert.equal(await page.locator('#positionCode').inputValue(), marker); assert.equal(await db.position.count({ where: { positionCode: marker } }), 1);
    });
    await scenario('positions: aborted transport preserves entered fields', page, async () => {
      await ready(page, '/module/positions/new'); await fillPosition(marker + '-NET'); await page.route('**/api/positions', r => r.abort());
      try { await page.locator('.record-form button[type=submit]').click(); await page.locator('.form-error').waitFor(); assert.equal(await page.locator('#positionCode').inputValue(), marker + '-NET'); assert.equal(await db.position.count({ where: { positionCode: marker + '-NET' } }), 0); } finally { await page.unroute('**/api/positions'); }
    });
    await scenario('people: create through UI; 360, assignment and onboarding persist', page, async () => {
      assert.ok(positionId); await ready(page, '/module/people/new');
      for (const [id, value] of [['employeeNumber', marker], ['givenName', 'Synthetic'], ['familyName', marker], ['workEmail', marker.toLowerCase() + '@example.test'], ['startDate', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)]]) await page.locator('#' + id).fill(value);
      await page.locator('#positionId').selectOption(positionId);
      const response = await mutation(page, '/api/people', 'POST', () => page.locator('.record-form button[type=submit]').click()); assert.equal(response.status(), 201); personId = (await response.json()).data.person.id;
      await page.waitForURL('**/module/employee-360?person=*'); await page.reload({ waitUntil: 'load' }); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      assert.ok((await page.locator('.page-content').innerText()).includes(marker)); assert.ok(await db.employment.findFirst({ where: { personId, positionId } })); assert.ok(await db.onboardingPlan.findFirst({ where: { personId } }));
      return { screenshot: await screenshot(page, 'employee-created') };
    });
    for (const identifier of [null, reader]) {
      const denied = await contextFor('en', 'light', 1440, identifier), deniedPage = await denied.newPage();
      try { for (const kind of ['people', 'positions']) await scenario(`${identifier ? 'employee' : 'anonymous'}: direct ${kind} create cannot expose choices`, deniedPage, async () => {
        await deniedPage.goto(`${origin}/module/${kind}/new`, { waitUntil: 'load' });
        if (!identifier) await deniedPage.waitForURL(u => u.pathname === '/auth/sign-in', { waitUntil: 'load', timeout: 15000 });
        else await deniedPage.locator('[data-record-create-state="restricted"]').waitFor();
        assert.equal(await deniedPage.locator('#positionId option,#orgUnitId option').count(), 0);
      }); } finally { await denied.close(); }
    }
    await login(context, author, 'HR_OPERATIONS');
    await scenario('survey: required-field validation is visible', page, async () => { await ready(page, '/module/engagement'); await page.getByRole('button', { name: 'Survey authoring', exact: true }).click(); await page.getByRole('button', { name: 'Create survey', exact: true }).click(); await page.getByText('Survey code and name are required.', { exact: true }).waitFor(); });
    await scenario('survey: create through UI and select saved record', page, async () => {
      await page.getByLabel('Survey code', { exact: true }).fill(marker); await page.getByLabel('Survey name', { exact: true }).fill(marker + ' survey');
      const response = await mutation(page, '/api/engagement/surveys', 'POST', () => page.getByRole('button', { name: 'Create survey', exact: true }).click()); assert.equal(response.status(), 201); surveyId = (await response.json()).data.id;
      await page.getByRole('button', { name: 'Edit survey', exact: true }).waitFor(); assert.equal(await page.getByLabel('Survey', { exact: true }).inputValue(), surveyId);
    });
    await scenario('survey: metadata edit persists', page, async () => {
      assert.ok(surveyId); await page.getByRole('button', { name: 'Edit survey', exact: true }).click(); await page.getByLabel('Name', { exact: true }).fill(marker + ' edited');
      const response = await mutation(page, `/api/engagement/surveys/${surveyId}`, 'PATCH', () => page.getByRole('button', { name: 'Save survey', exact: true }).click()); assert.equal(response.status(), 200); assert.equal((await db.engagementSurvey.findUnique({ where: { id: surveyId } })).name, marker + ' edited');
    });
    await scenario('question: create and edit through UI', page, async () => {
      assert.ok(surveyId); await page.getByLabel('Question key', { exact: true }).fill('QA_Q1'); await page.getByLabel('Prompt', { exact: true }).fill('Synthetic initial question');
      const created = await mutation(page, `/api/engagement/surveys/${surveyId}/questions`, 'POST', () => page.getByRole('button', { name: 'Add question', exact: true }).click()); assert.equal(created.status(), 201); questionId = (await created.json()).data.id;
      await page.getByRole('row').filter({ hasText: 'QA_Q1' }).getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Prompt', { exact: true }).fill('Synthetic edited question');
      const edited = await mutation(page, `/api/engagement/surveys/${surveyId}/questions/${questionId}`, 'PATCH', () => page.getByRole('button', { name: 'Save question', exact: true }).click()); assert.equal(edited.status(), 200); await page.getByText('Synthetic edited question', { exact: true }).waitFor();
    });
    await scenario('authoring: opened EN/TR form fits 320px and 390px', page, async () => {
      assert.ok(questionId);
      for (const lang of ['tr', 'en']) { await locale(page, lang); await page.getByRole('button', { name: lang === 'tr' ? 'Anketi sil' : 'Delete survey', exact: true }).waitFor();
        for (const width of [320, 390]) { await page.setViewportSize({ width, height: 844 }); const actual = await page.evaluate(() => document.documentElement.scrollWidth); const image = await screenshot(page, `authoring-${lang}-${width}`); assert.ok(actual <= width + 2, `${image}: ${actual}px exceeds ${width}px`); }
      }
    });
    await scenario('survey: cancelling deletion preserves record', page, async () => {
      await page.setViewportSize({ width: 1440, height: 1000 }); await locale(page, 'en'); assert.ok(surveyId);
      page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Delete survey', exact: true }).click(); assert.ok(await db.engagementSurvey.findUnique({ where: { id: surveyId } }));
    });
    await scenario('question: confirmed deletion removes record', page, async () => {
      assert.ok(questionId); page.once('dialog', d => d.accept()); const response = await mutation(page, `/api/engagement/surveys/${surveyId}/questions/${questionId}`, 'DELETE', () => page.getByRole('row').filter({ hasText: 'QA_Q1' }).getByRole('button', { name: 'Delete', exact: true }).click()); assert.equal(response.status(), 200);
      await page.getByText('No questions authored yet.', { exact: true }).waitFor(); assert.equal((await db.engagementSurvey.findUnique({ where: { id: surveyId }, include: { questions: true } })).questions.length, 0);
    });
    await scenario('survey: confirmed unused-survey deletion survives reload', page, async () => {
      assert.ok(surveyId); page.once('dialog', d => d.accept()); const response = await mutation(page, `/api/engagement/surveys/${surveyId}`, 'DELETE', () => page.getByRole('button', { name: 'Delete survey', exact: true }).click()); assert.equal(response.status(), 200); assert.equal(await db.engagementSurvey.findUnique({ where: { id: surveyId } }), null);
      await ready(page, '/module/engagement'); await page.getByRole('button', { name: 'Survey authoring', exact: true }).click(); assert.ok(!(await page.getByLabel('Survey', { exact: true }).locator('option').allTextContents()).some(t => t.includes(marker)));
    });
    await scenario('campaign: failed audience read does not loop and requires explicit retry', page, async () => {
      await ready(page, '/module/engagement'); let reads = 0;
      await page.route('**/api/engagement/audience-options', r => { reads++; return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic"}' }); });
      const panel = page.locator('[data-engagement-campaign-create]');
      try { await panel.getByRole('button', { name: 'New campaign', exact: true }).click(); await panel.getByRole('button', { name: 'Retry audience loading', exact: true }).waitFor(); assert.equal(await panel.getByRole('button', { name: 'Create draft campaign', exact: true }).isDisabled(), true); await page.waitForTimeout(750); assert.equal(reads, 1); }
      finally { await page.unroute('**/api/engagement/audience-options'); }
      const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/engagement/audience-options'), panel.getByRole('button', { name: 'Retry audience loading', exact: true }).click()]); assert.equal(response.status(), 200);
    });
    await scenario('campaign: UI creates a persisted DRAFT from an authored API fixture', page, async () => {
      const s = await context.request.post(origin + '/api/engagement/surveys', { headers: { origin }, data: { code: marker + '-C', name: marker + ' campaign survey' } }); assert.equal(s.status(), 201); const id = (await s.json()).data.id;
      const q = await context.request.post(origin + `/api/engagement/surveys/${id}/questions`, { headers: { origin }, data: { questionKey: 'Q1', prompt: 'Synthetic campaign question', type: 'SCALE', required: true } }); assert.equal(q.status(), 201);
      await ready(page, '/module/engagement'); const panel = page.locator('[data-engagement-campaign-create]'); await panel.getByRole('button', { name: 'New campaign', exact: true }).click();
      await panel.getByLabel('Survey', { exact: true }).selectOption(id); await panel.getByLabel('Campaign name', { exact: true }).fill(marker + ' draft');
      const response = await mutation(page, '/api/engagement/campaigns', 'POST', () => panel.getByRole('button', { name: 'Create draft campaign', exact: true }).click()); assert.equal(response.status(), 201);
      const saved = await db.surveyCampaign.findUnique({ where: { id: (await response.json()).data.id } }); assert.equal(saved.surveyId, id); assert.equal(saved.status, 'DRAFT'); assert.equal(saved.createdById, author);
      await ready(page, '/module/engagement'); await page.getByText(marker + ' draft', { exact: true }).waitFor(); return { screenshot: await screenshot(page, 'campaign-created') };
    });
  } finally { await context.close(); }
} catch (error) { flag('AUDIT_INCOMPLETE', { error: String(error.message).replaceAll(password, '[redacted]').slice(0, 500) }); }
finally {
  await browser.close(); await db.$disconnect();
  report.summary = { modules: slugs.length, views: report.pages.length, screenshots: report.pages.filter(p => p.screenshot).length, links: report.links.length, tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length, findings: report.findings.length };
  report.completedAt = new Date().toISOString(); await persist(); console.log('UI_DEEP_AUDIT_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.findings.length) process.exitCode = 1;
