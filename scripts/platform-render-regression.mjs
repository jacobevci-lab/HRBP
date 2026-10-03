/** Natural browser checks. Only the disposable localhost database may be used. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://localhost:3100';
const database = new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/hrbp_audit');
const actorId = 'user-local-test-admin';
const report = { checks: [], downloads: [], viewports: [], failures: [] };
await mkdir('.audit/downloads', { recursive: true });
await mkdir('.audit/screenshots', { recursive: true });
const browser = await chromium.launch();
async function check(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); }
  catch (error) {
    report.checks.push({ name, passed: false });
    report.failures.push({ name, message: String(error.message).slice(0,400) });
  }
}
async function identity(context) {
  const response = await context.request.get(origin + '/api/auth/session');
  assert.equal(response.status(), 200);
  const session = await response.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.id, actorId);
  assert.equal(session.user.role, 'TENANT_ADMIN');
}
async function contextFor(locale = 'en', theme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // No application request, logout, download or prefetch is suppressed.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await context.addInitScript(({locale,theme}) => {
    localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme);
  }, { locale, theme });
  return context;
}
async function signIn(page) {
  const response = await page.goto(origin + '/auth/sign-in', { waitUntil: 'load' });
  assert.equal(response.status(), 200);
  await page.locator('#local-identifier').fill('local.admin');
  await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(origin + '/', { waitUntil: 'load' }),
    page.locator('button.auth-local-submit').click()
  ]);
  await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await identity(page.context());
}
function csvRows(source) {
  const rows=[]; let row=[], field='', quoted=false;
  source=source.replace(/^\uFEFF/, '');
  for(let i=0;i<source.length;i++) {
    const char=source[i];
    if(char==='"') { if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted; }
    else if(char===','&&!quoted){row.push(field);field='';}
    else if(char==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=char;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  assert.equal(quoted,false,'CSV has unterminated quoted field');return rows;
}
try {
  await check('audit: actual sign-in, no unsolicited export, localized filters and real CSV download', async () => {
    const context = await contextFor();
    try {
      const page = await context.newPage(); const exportRequests=[], errors=[];
      page.on('request',r=>{if(new URL(r.url()).pathname==='/api/audit/export')exportRequests.push({method:r.method(),prefetch:!!r.headers()['next-router-prefetch']});});
      page.on('pageerror',error=>errors.push(error.message));
      await signIn(page);
      const response=await page.goto(origin+'/module/audit',{waitUntil:'load',timeout:25000});
      assert.equal(response.status(),200);
      await page.locator('.audit-live-page[data-audit-locale="en"]').waitFor();
      await page.locator('.app-shell[data-session-loading="false"]').waitFor();
      await page.waitForTimeout(800); // Observe normal viewport-driven prefetch, not a readiness test.
      await page.locator('.audit-live-heading a[download]').hover();
      await page.waitForTimeout(600);
      assert.equal(exportRequests.length,0,'Viewing/hovering the page must not fetch the CSV');
      for(const locale of ['tr','en']) {
        await page.locator('.locale-toggle button').filter({hasText:locale.toUpperCase()}).click();
        await page.locator(`.audit-live-page[data-audit-locale="${locale}"]`).waitFor({timeout:10000});
        assert.equal(await page.locator('.audit-live-page h1').textContent(),locale==='tr'?'Denetim Defteri':'Audit Ledger');
        await identity(context);
      }
      const filter=page.locator('.audit-filter-bar');
      await filter.locator('input[name="q"]').fill('auth.local-succeeded');
      await filter.locator('select[name="actor"]').selectOption(actorId);
      await filter.locator('select[name="resource"]').selectOption('UserAccount');
      await filter.locator('select[name="classification"]').selectOption('INTERNAL');
      await filter.locator('select[name="days"]').selectOption('7');
      await Promise.all([
        page.waitForURL(url=>url.pathname==='/module/audit'&&url.searchParams.get('q')==='auth.local-succeeded',{waitUntil:'load'}),
        filter.locator('button[type="submit"]').click()
      ]);
      await page.locator('.audit-live-page[data-audit-locale="en"]').waitFor();
      const downloadLink=page.locator('.audit-live-heading a[download]');
      const target=new URL(await downloadLink.getAttribute('href'),origin);
      for(const [key,value] of Object.entries({q:'auth.local-succeeded',actor:actorId,resource:'UserAccount',classification:'INTERNAL',days:'7'}))assert.equal(target.searchParams.get(key),value);
      assert.equal(exportRequests.length,0);
      const [download]=await Promise.all([page.waitForEvent('download'),downloadLink.click()]);
      assert.match(download.suggestedFilename(),/^hrbp-audit-\d{4}-\d{2}-\d{2}\.csv$/);
      await download.saveAs('.audit/downloads/filtered-audit.csv');
      assert.equal(await download.failure(),null);
      const rows=csvRows(await readFile('.audit/downloads/filtered-audit.csv','utf8'));
      assert.deepEqual(rows[0],['id','occurredAt','actorId','action','resourceType','resourceId','classification','ipAddress','purpose','hash','previousHash']);
      assert.ok(rows.length>1,'The actual sign-in must appear in the filtered export');
      for(const row of rows.slice(1)){assert.equal(row[2],actorId);assert.equal(row[3],'auth.local-succeeded');assert.equal(row[4],'UserAccount');assert.equal(row[6],'INTERNAL');}
      assert.equal(exportRequests.length,1);assert.equal(exportRequests[0].prefetch,false);
      assert.equal(new URL(page.url()).pathname,'/module/audit');
      await identity(context);assert.deepEqual(errors,[]);
      const anonymous=await browser.newContext();
      try { const denied=await anonymous.request.get(target.href);assert.equal(denied.status(),401); } finally {await anonymous.close();}
      report.downloads.push({records:rows.length-1,requestCount:exportRequests.length,filtersPreserved:true,principalRetained:true,anonymousDenied:true});
    } finally { await context.close(); }
  });
  for(const locale of ['en','tr'])for(const theme of ['light','dark']) {
    await check(`workflows: ${locale}/${theme}, hydrated narrow-screen controls and local table scrolling`, async () => {
      const context=await contextFor(locale,theme);
      try {
        const page=await context.newPage();await signIn(page);
        for(const width of [320,390,768]){
          await page.setViewportSize({width,height:844});
          const response=await page.goto(origin+'/module/workflows',{waitUntil:'load',timeout:25000});
          assert.equal(response.status(),200);
          await page.locator('.app-shell[data-session-loading="false"]').waitFor();
          await page.waitForFunction(()=>{
            const buttons=[...document.querySelectorAll('.workflow-action-head button,.workflow-history-controls button')];
            return buttons.length>=2&&buttons.every(b=>!b.disabled);
          },null,{timeout:15000});
          await page.waitForTimeout(350);
          await identity(context);
          const state=await page.evaluate(()=>({
            width:document.documentElement.scrollWidth,viewport:innerWidth,lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,
            tables:[...document.querySelectorAll('.workflow-action-table-wrap')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowX})),
            controls:[...document.querySelectorAll('.workflow-history-controls select,.workflow-history-controls button,.workflow-history-controls a')].map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width};})
          }));
          report.viewports.push(state);
          if(state.width>width+2)await page.screenshot({path:`.audit/screenshots/workflows-${locale}-${theme}-${width}.png`});
          assert.equal(state.lang,locale);assert.equal(state.theme,theme);
          assert.ok(state.width<=width+2,`Document overflow: ${state.width}px at ${width}px (${locale}/${theme})`);
          assert.ok(state.controls.length>=4);
          for(const c of state.controls)assert.ok(c.left>=0&&c.right<=width+1&&c.width>0,'Each filter/export control stays reachable');
          assert.ok(state.tables.length>=2);
          for(const t of state.tables)assert.ok(['auto','scroll'].includes(t.overflow)&&t.scroll>t.client,'Wide tables retain local horizontal scrolling');
        }
      }finally{await context.close();}
    });
  }
} finally {
  await browser.close();
  await writeFile('.audit/render-regression.json',JSON.stringify(report,null,2));
  console.log('RENDER_REGRESSION '+JSON.stringify(report));
}
assert.deepEqual(report.failures,[],'Natural download/layout regression failed; do not merge');
