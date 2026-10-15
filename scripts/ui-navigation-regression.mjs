/** Real navigation interactions. Never connects to a production host/database. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD;
assert.ok(password);
const out = '.audit/navigation-ui';
await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  tests: [], css: [], limitations: ['Synthetic loopback deployment only.', 'No customer records or remote integrations.'] };
const browser = await chromium.launch();

async function settled(page) {
  // Observe real CSS transitions; do not inject a stylesheet that masks defects.
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let round = 0; round < 4; round++) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const animations = [...document.querySelectorAll('.sidebar,.sidebar-overlay')]
        .flatMap(element => element.getAnimations()).filter(a => a.playState === 'running' &&
          Number.isFinite(a.effect?.getComputedTiming().endTime));
      if (!animations.length) return;
      await Promise.all(animations.map(a => a.finished.catch(() => {})));
    }
  });
}
async function view(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sidebar'), toggle = document.querySelector('.mobile-menu');
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { width: innerWidth, right: r.right, left: r.left, display: style.display,
      visibility: style.visibility, transform: style.transform, transition: style.transition,
      open: el.classList.contains('sidebar-open'), overlay: !!document.querySelector('.sidebar-overlay'),
      inert: el.inert, expanded: toggle.getAttribute('aria-expanded'), bodyOverflow: document.body.style.overflow,
      menuVisible: getComputedStyle(toggle).display !== 'none', focusedInSidebar: el.contains(document.activeElement) };
  });
}
async function closed(page) {
  await settled(page);
  const v = await view(page);
  assert.equal(v.open, false, 'closed mobile menu must not retain sidebar-open');
  assert.equal(v.overlay, false, 'closed mobile menu must not leave an overlay');
  assert.ok(v.right <= 1 || v.display === 'none' || v.visibility === 'hidden', `sidebar covers content after settling: ${JSON.stringify(v)}`);
}
async function start(locale, motion) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const login = await context.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: 'local.admin', password } });
  assert.equal(login.status(), 200);
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await context.addInitScript(({ locale }) => {
    localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', locale === 'tr' ? 'dark' : 'light');
  }, { locale });
  const page = await context.newPage();
  await page.goto(origin + '/module/people', { waitUntil: 'load' });
  await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await settled(page);
  return { context, page };
}
async function scenario(locale, motion, name, run) {
  const { context, page } = await start(locale, motion);
  const row = { locale, motion, name, passed: false };
  try { await run(page); row.passed = true; }
  catch (error) { row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 900); }
  finally {
    row.view = await view(page).catch(() => null);
    row.screenshot = `${locale}-${motion}-${report.tests.length}.jpg`;
    await settled(page).catch(() => {});
    await page.screenshot({ path: `${out}/${row.screenshot}`, type: 'jpeg', quality: 80 }).catch(() => {});
    report.tests.push(row); console.log('NAV_SCENARIO ' + JSON.stringify(row));
    await context.close();
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
}
try {
  // Capture only stylesheet rules relevant to the observed drawer. This is
  // fixture evidence, never a scan of cookies, credentials or employee content.
  const { context, page } = await start('en', 'no-preference');
  report.css = await page.evaluate(() => {
    const found = [];
    function visit(rules, media = '') {
      for (const rule of rules) {
        if (rule.cssRules) visit(rule.cssRules, media + ' ' + (rule.conditionText || ''));
        else if (/\.(sidebar|mobile-menu|mobile-close|main-area)(?![\w-])/.test(rule.selectorText || '')) {
          found.push({ media, selector: rule.selectorText, style: rule.style.cssText });
        }
      }
    }
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
    return found;
  });
  console.log('NAV_CSS ' + JSON.stringify(report.css));
  await context.close();
  for (const locale of ['en', 'tr']) for (const motion of ['no-preference', 'reduce']) {
    await scenario(locale, motion, 'desktop/mobile resize has no persistent closed-drawer overlap', async page => {
      for (const width of [1440, 390, 1440, 320, 768, 390]) {
        await page.setViewportSize({ width, height: 844 }); await settled(page);
        const v = await view(page);
        if (v.menuVisible) await closed(page);
        else assert.ok(v.right > 0 && !v.inert && !v.overlay, 'desktop navigation must remain available');
      }
    });
    await scenario(locale, motion, 'closed drawer is excluded from keyboard focus', async page => {
      await closed(page); await page.locator('.mobile-menu').focus();
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        assert.equal((await view(page)).focusedInSidebar, false, 'keyboard entered the off-screen drawer');
      }
    });
    await scenario(locale, motion, 'open drawer traps focus; Escape closes and restores trigger', async page => {
      const toggle = page.locator('.mobile-menu');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      const controlledId = await toggle.getAttribute('aria-controls'); assert.ok(controlledId);
      await toggle.click(); await settled(page);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.sidebar').getAttribute('id'), controlledId);
      assert.equal((await view(page)).focusedInSidebar, true, 'opening must focus the drawer');
      for (let i = 0; i < 38; i++) {
        await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
        assert.equal((await view(page)).focusedInSidebar, true, 'focus escaped the open drawer');
      }
      await page.keyboard.press('Escape'); await closed(page);
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
      assert.notEqual((await view(page)).bodyOverflow, 'hidden');
    });
    await scenario(locale, motion, 'backdrop and navigation link close menu without obstructing content', async page => {
      const toggle = page.locator('.mobile-menu'); await toggle.click(); await settled(page);
      await page.locator('.sidebar-overlay').click({ position: { x: 380, y: 500 } });
      await closed(page);
      await toggle.click(); await settled(page);
      await page.locator('.sidebar a[href="/module/positions"]').click();
      await page.waitForURL('**/module/positions'); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      await closed(page);
      assert.equal(await page.locator('.main-area').evaluate(el => el.inert), false);
    });
    await scenario(locale, motion, 'open mobile drawer resets across desktop breakpoint', async page => {
      await page.locator('.mobile-menu').click(); await settled(page);
      await page.setViewportSize({ width: 1440, height: 1000 }); await settled(page);
      const desktop = await view(page);
      assert.equal(desktop.overlay, false, 'mobile overlay survived desktop resize');
      assert.equal(desktop.inert, false); assert.notEqual(desktop.bodyOverflow, 'hidden');
      await page.setViewportSize({ width: 390, height: 844 }); await closed(page);
    });
  }
} finally {
  await browser.close();
  report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length,
    failed: report.tests.filter(t => !t.passed).length };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log('NAV_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.some(t => !t.passed) || report.tests.length !== 20) process.exitCode = 1;
