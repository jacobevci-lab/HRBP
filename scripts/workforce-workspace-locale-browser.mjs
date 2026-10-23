/** Read-only UI acceptance on signed synthetic accounts in the existing
 * disposable PostgreSQL + production Next.js + Chromium inspection job. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const origin='http://localhost:3100', url=new URL(process.env.DATABASE_URL || 'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true');
assert.ok(['postgres:','postgresql:'].includes(url.protocol));
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/hrbp_audit');assert.equal(url.search,'');
const password=process.env.HRBP_TEST_ADMIN_PASSWORD;assert.ok(password);
const out='.audit/workforce-workspace-locale';await mkdir(out,{recursive:true});
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),generatedAt:new Date().toISOString(),tests:[],
  limitations:['Read-only signed synthetic admin views; no new business writes or external providers.',
    'Fixed UI copy in leave, time-attendance, benefits and learning only. Customer labels and preformatted dates are preserved.',
    'Chromium viewport checks do not certify every locale, assistive technology or physical device.']};
let browser;const contexts=[];
async function check(name,fn){const result={name,passed:false};try{Object.assign(result,await fn(),{passed:true});}catch(e){result.error=String(e.message).replaceAll(password,'[redacted]').slice(0,500);}report.tests.push(result);console.log('WORKFORCE_LOCALE_CASE '+JSON.stringify(result));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
const definitions=[
 ['leave','Request & approval queue','Talep ve onay kuyruğu','Employee','Çalışan'],
 ['time-attendance','Attendance operating view','Zaman ve devam kayıtları','Worked','Çalışılan süre'],
 ['benefits','Plan coverage & enrollment','Plan kapsamı ve katılım','Employer cost','İşveren maliyeti'],
 ['learning','Assigned learning','Atanmış eğitimler','Completed or waived','Tamamlanan veya muaf']
];
try{
 browser=await chromium.launch();
 for(const [locale,theme,width] of [['en','light',1440],['tr','light',390],['tr','dark',320]]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});contexts.push(context);
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const login=await context.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier:'local.admin',password}});assert.equal(login.status(),200);
  const session=await (await context.request.get(origin+'/api/auth/session')).json();assert.equal(session.authenticated,true);assert.equal(session.user.role,'TENANT_ADMIN');
  for(const [slug,en,tr,enColumn,trColumn] of definitions){
   await context.addCookies([{name:'hrbp-locale',value:locale,url:origin}]);
   const page=await context.newPage();page.setDefaultTimeout(12000);
   await page.addInitScript(({locale,theme})=>{localStorage.setItem('hrbp-locale',locale);localStorage.setItem('hrbp-theme',theme);},{locale,theme});
   await check(`${slug}: ${locale}/${theme}/${width}px authenticated copy and layout`,async()=>{
    const response=await page.goto(origin+'/module/'+slug,{waitUntil:'networkidle'});assert.equal(response.status(),200);
    await page.locator('.app-shell[data-session-loading="false"]').waitFor();
    const panel=page.locator(`[data-workforce-live="${slug}"]`);await panel.waitFor();
    await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.locator('.theme-toggle').click();
    await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
    assert.equal(await panel.getAttribute('lang'),locale);
    assert.equal(await panel.getByRole('heading',{name:locale==='tr'?tr:en,exact:true}).count(),1);
    assert.equal(await panel.getByRole('heading',{name:locale==='tr'?en:tr,exact:true}).count(),0);
    assert.ok((await panel.locator('th').allTextContents()).includes(locale==='tr'?trColumn:enColumn));
    const geometry=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.documentWidth<=width+2);
    if(slug==='leave'){
     const style=await panel.locator('.workforce-approval-description').evaluate(el=>{const s=getComputedStyle(el);return{size:parseFloat(s.fontSize),line:parseFloat(s.lineHeight),width:el.getBoundingClientRect().width};});
     assert.equal(style.size,12);assert.ok(style.line>=18);assert.ok(style.width<=width);geometry.approval=style;
    }
    const current=await (await context.request.get(origin+'/api/auth/session')).json();assert.equal(current.user.id,session.user.id);assert.equal(current.user.tenantId,session.user.tenantId);
    const screenshot=`${slug}-${locale}-${theme}-${width}.jpg`;await panel.screenshot({path:out+'/'+screenshot,type:'jpeg',quality:80});
    return{geometry,screenshot};
   });
   if(locale==='en')await check(`${slug}: changing locale refreshes live server copy without changing signed identity`,async()=>{
    const panel=page.locator(`[data-workforce-live="${slug}"]`);
    const values=await panel.locator('.workpay-metric strong,.growth-metric strong').allTextContents();
    await page.locator('.locale-toggle button').filter({hasText:'TR'}).click();
    await page.waitForFunction(slug=>document.querySelector(`[data-workforce-live="${slug}"]`)?.lang==='tr',slug);
    assert.equal(await panel.getByRole('heading',{name:tr,exact:true}).count(),1);
    // The only metric whose text changes with locale is the "Live" marker and duration units.
    const after=await panel.locator('.workpay-metric strong,.growth-metric strong').allTextContents();
    assert.deepEqual(after.map(v=>v.match(/[\d.]+/)?.[0]??null),values.map(v=>v.match(/[\d.]+/)?.[0]??null));
    const current=await (await context.request.get(origin+'/api/auth/session')).json();assert.equal(current.user.id,session.user.id);assert.equal(current.user.role,session.user.role);
   });
   await page.close();
  }
 }
}catch(e){report.tests.push({name:'SETUP_ERROR',passed:false,error:String(e.message).replaceAll(password,'[redacted]').slice(0,500)});}
finally{
 for(const context of contexts)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
 report.summary={tests:report.tests.length,passed:report.tests.filter(t=>t.passed).length,failed:report.tests.filter(t=>!t.passed).length,expected:16};
 await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log('WORKFORCE_LOCALE_SUMMARY '+JSON.stringify(report.summary));
 if(report.summary.failed||report.summary.tests!==16)process.exitCode=1;
}
