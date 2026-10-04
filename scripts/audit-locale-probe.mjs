// Diagnostic only: reproduce the exact locale wait, without changing application code.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin='http://localhost:3100';
const db=new URL(process.env.DATABASE_URL||'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true');
assert.ok(['localhost','127.0.0.1'].includes(db.hostname));
assert.equal(db.pathname,'/hrbp_audit');
await mkdir('.diagnostics/screenshots',{recursive:true});
const browser=await chromium.launch();const report=[];
async function snapshot(page){return page.evaluate(()=>({
 path:location.pathname,lang:document.documentElement.lang,stored:localStorage.getItem('hrbp-locale'),
 localeCookies:document.cookie.split(';').filter(x=>x.trim().startsWith('hrbp-locale=')),
 roots:[...document.querySelectorAll('.audit-live-page')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{locale:e.getAttribute('data-audit-locale'),display:s.display,visibility:s.visibility,width:r.width,height:r.height,heading:e.querySelector('h1')?.textContent};}),
 buttons:[...document.querySelectorAll('.locale-toggle button')].map(b=>({text:b.textContent,pressed:b.getAttribute('aria-pressed'),type:b.type,formAction:b.form?.action??null})),
 loading:document.querySelector('.app-shell')?.getAttribute('data-session-loading')
}));}
try{
 for(const mode of ['natural','regression-init','seed-once']){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  if(mode!=='natural'){
   await context.addCookies([{name:'hrbp-locale',value:'en',url:origin}]);
   await context.addInitScript(mode=>{
    if(mode==='regression-init'||localStorage.getItem('hrbp-locale')===null)localStorage.setItem('hrbp-locale','en');
    if(mode==='regression-init'||localStorage.getItem('hrbp-theme')===null)localStorage.setItem('hrbp-theme','light');
   },mode);
  }
  const page=await context.newPage();const events=[];
  page.on('request',r=>{if(new URL(r.url()).pathname==='/module/audit')events.push({type:'request',navigation:r.isNavigationRequest(),rsc:r.headers().rsc??null,prefetch:r.headers()['next-router-prefetch']??null});});
  page.on('response',r=>{if(new URL(r.url()).pathname==='/module/audit')events.push({type:'response',status:r.status(),contentType:r.headers()['content-type']});});
  page.on('pageerror',e=>events.push({type:'error',name:e.name,message:e.message.slice(0,250)}));
  try{
   await page.goto(origin+'/auth/sign-in',{waitUntil:'load'});
   await page.locator('#local-identifier').fill('local.admin');
   await page.locator('#local-password').fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
   await Promise.all([page.waitForURL(origin+'/',{waitUntil:'load'}),page.locator('button.auth-local-submit').click()]);
   await page.goto(origin+'/module/audit',{waitUntil:'load'});
   await page.locator('.app-shell[data-session-loading="false"]').waitFor();
   for(const locale of ['tr','en','tr']){
    const before=await snapshot(page);let error=null;
    await page.locator('.locale-toggle button').filter({hasText:locale.toUpperCase()}).click();
    try{await page.locator(`.audit-live-page[data-audit-locale="${locale}"]`).waitFor({timeout:10000});}catch(e){error=e.message.slice(0,350);}
    const after=await snapshot(page);
    const principal=await context.request.get(origin+'/api/auth/session');const session=await principal.json();
    const row={mode,locale,before,after,error,principal:{status:principal.status(),authenticated:session.authenticated,role:session.user?.role},events:[...events]};
    report.push(row);console.log('AUDIT_LOCALE_PROBE '+JSON.stringify(row));
    if(error)await page.screenshot({path:`.diagnostics/screenshots/${mode}-${report.length}.png`});
   }
  }catch(e){report.push({mode,error:e.message.slice(0,350),events});}
  finally{await context.close();}
 }
}finally{await browser.close();await writeFile('.diagnostics/locale-probe.json',JSON.stringify(report,null,2));}
