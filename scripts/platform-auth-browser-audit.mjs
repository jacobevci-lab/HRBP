import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const origin='http://localhost:3100';
const database=new URL(process.env.DATABASE_URL||'about:blank');
if(process.env.HRBP_DISPOSABLE_AUDIT!=='true'||!['localhost','127.0.0.1'].includes(database.hostname)||database.pathname!=='/hrbp_audit') throw Error('Disposable audit database required');
const roles={admin:'TENANT_ADMIN',employee:'EMPLOYEE',manager:'MANAGER',hrbp:'HRBP'};
const slugs=['dashboard','people','organization','employee-360','recruiting','onboarding','offboarding','positions','time-attendance','leave','payroll','compensation','benefits','performance','talent','succession','learning','engagement','employee-relations','hr-service','documents','policies','workforce-planning','analytics','ai-assistant','workflows','privacy','audit','settings'];
const paths=[...slugs.map(x=>x==='dashboard'?'/':`/module/${x}`),'/module/notifications','/module/people/new','/module/positions/new','/module/employee-360/lifecycle'];
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),natural:[],controlled:[],links:[],ui:[],limitations:['Natural authenticated navigation: no logout request interception. External hosts are blocked to isolate providers.','Page renders and links do not prove every business workflow or external provider works.']};
await mkdir('.audit/screenshots',{recursive:true});
const db=new PrismaClient();
// The previous disposable probe deactivated this synthetic account deliberately.
await db.userAccount.update({where:{id:'qa-audit-employee'},data:{active:true}});
await db.$disconnect();
async function login(role){
 const response=await fetch(origin+'/api/auth/local',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/json'},body:JSON.stringify({identifier:`audit.${role}`,password:process.env.HRBP_TEST_ADMIN_PASSWORD})});
 if(response.status!==200)throw Error(`Fixture login failed: ${role}/${response.status}`);
 const raw=response.headers.get('set-cookie');if(!raw)throw Error('Missing fixture cookie');
 const part=raw.split(';')[0];return{name:part.slice(0,part.indexOf('=')),value:decodeURIComponent(part.slice(part.indexOf('=')+1)),url:origin,httpOnly:true,secure:false,sameSite:'Lax'};
}
async function principal(context){const r=await context.request.get(origin+'/api/auth/session');let body={};try{body=await r.json();}catch{}return{status:r.status(),authenticated:body.authenticated===true,id:body.user?.id??null,role:body.user?.role??null};}
const browser=await chromium.launch({headless:true});
try{
 for(const [role,expectedRole] of Object.entries(roles)){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addCookies([await login(role)]);
  const before=await principal(context),requests=[];
  const page=await context.newPage();
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/auth/logout'){const h=r.headers();requests.push({method:r.method(),prefetch:h['next-router-prefetch']??null,rsc:h.rsc??null,purpose:h.purpose??h['sec-purpose']??null});}});
  const response=await page.goto(origin+'/',{waitUntil:'networkidle',timeout:20000});
  await page.waitForTimeout(1000);
  const after=await principal(context);
  report.natural.push({role,expectedRole,before,after,pageStatus:response?.status(),logoutRequests:[...requests],principalLost:before.authenticated&&!after.authenticated});
  await page.locator('.topbar-logout').click();
  await page.waitForURL('**/auth/sign-in?signedOut=1');
  const signedOut=await principal(context);
  report.natural.at(-1).explicitSignOutWorks=!signedOut.authenticated;
  await context.close();
 }
 console.log('AUDIT_NATURAL_SESSION '+JSON.stringify(report.natural));
 for(const [role,expectedRole] of Object.entries(roles)){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});let blocked=0;
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();return route.continue();});
  await context.addCookies([await login(role)]);
  const page=await context.newPage();let errors=[],serverFailures=[];
  page.on('pageerror',e=>errors.push(e.message.slice(0,300)));
  page.on('response',r=>{if(r.status()>=500)serverFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
  const links=new Map();
  for(const path of paths){
   errors=[];serverFailures=[];const before=await principal(context);const blockedBefore=blocked;
   try{
    const response=await page.goto(origin+path,{waitUntil:'load',timeout:25000});
    await page.locator('.app-shell[data-session-loading="false"]').waitFor({timeout:3000}).catch(()=>{});
    const after=await principal(context);
    const state=await page.evaluate(()=>{
     const area=document.querySelector('.page-content')||document.body,text=area.innerText||'';
     const fallback=text.match(/protected fallback|korumalı yedek|data plane could not initialize|live governed data is temporarily unavailable|canlı yönetişimli veri geçici olarak kullanılamıyor/i);
     const denied=/access is restricted|access is denied|access is limited|access is not permitted|access denied|your signed role does not include|erişim kısıtlı|erişim reddedildi/i.test(text);
     const preview=/safe demo data|read-only staging preview|live tenant data and mutations are disabled|güvenli demo verisi|salt-okunur staging önizlemesi/i.test(text);
     const at=fallback?.index??0;
     return{heading:area.querySelector('h1,h2')?.textContent?.trim().slice(0,120),sessionLabel:document.querySelector('.session-identity .user-copy strong')?.textContent,denied,preview,protectedFallback:!!fallback,fallbackExcerpt:fallback?text.slice(Math.max(0,at-80),at+280):null,textSize:text.length,overflow:document.documentElement.scrollWidth>innerWidth+2,buttons:area.querySelectorAll('button').length,links:[...area.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),label:a.textContent.trim().slice(0,80)}))};
    });
    const principalVerified=before.authenticated&&after.authenticated&&before.role===expectedRole&&after.role===expectedRole&&before.id===`qa-audit-${role}`&&after.id===`qa-audit-${role}`;
    report.controlled.push({role,path,status:response?.status(),principalVerified,denied:state.denied,preview:state.preview,protectedFallback:state.protectedFallback,fallbackExcerpt:state.fallbackExcerpt,heading:state.heading,sessionLabel:state.sessionLabel,textSize:state.textSize,buttons:state.buttons,overflow:state.overflow,errors:[...new Set(errors)],serverFailures,blockedLogoutPrefetches:blocked-blockedBefore});
    if(role==='admin'){
     for(const l of state.links)if(l.href?.startsWith('/')&&!l.href.startsWith('//'))links.set(l.href,l);
     if(await page.locator('.theme-toggle').count()){
      const theme=await page.evaluate(()=>document.documentElement.dataset.theme);await page.locator('.theme-toggle').click();const themeChanged=theme!==await page.evaluate(()=>document.documentElement.dataset.theme);await page.locator('.theme-toggle').click();
      await page.locator('.locale-toggle button').filter({hasText:'TR'}).click();await page.waitForLoadState('networkidle');
      const tr=await page.evaluate(()=>({selected:document.documentElement.lang==='tr',heading:document.querySelector('.page-content h1')?.textContent,englishWorkspaceLabels:['Survey campaigns','Workforce scenarios','My requests','Anonymity controls'].filter(x=>(document.querySelector('.page-content')?.textContent||'').includes(x))}));
      await page.locator('.locale-toggle button').filter({hasText:'EN'}).click();await page.waitForLoadState('networkidle');
      report.ui.push({path,themeChanged,turkishSelected:tr.selected,turkishHeading:tr.heading,remainingEnglishLabels:tr.englishWorkspaceLabels,principalAfterToggles:(await principal(context)).role});
     }
    }
   }catch(e){report.controlled.push({role,path,status:0,principalVerified:false,error:e.message.slice(0,300)});}
  }
  if(role==='admin'){
   for(const l of links.values()){
    if(/^\/api\/auth\//.test(l.href))continue;
    try{const r=await context.request.get(origin+l.href,{maxRedirects:0,timeout:15000});report.links.push({...l,status:r.status(),location:r.headers().location??null});}catch(e){report.links.push({...l,status:0,error:e.name});}
   }
   await page.setViewportSize({width:390,height:844});
   for(const path of paths){
    try{const r=await page.goto(origin+path,{waitUntil:'load',timeout:25000});const p=await principal(context);const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,width:document.documentElement.scrollWidth,viewport:innerWidth}));report.controlled.push({role:'admin-mobile',path,status:r?.status(),principalVerified:p.authenticated&&p.role===expectedRole&&p.id==='qa-audit-admin',...m});if(m.overflow||['/module/onboarding','/module/settings','/module/workforce-planning'].includes(path))await page.screenshot({path:'.audit/screenshots/'+path.replace(/[^a-z0-9-]/gi,'_')+'.png'});}catch(e){report.controlled.push({role:'admin-mobile',path,status:0,principalVerified:false,error:e.name});}
   }
  }
  await context.close();
 }
}finally{await browser.close();}
const summary={source:report.source,natural:report.natural,controlledCount:report.controlled.length,principalVerifiedCount:report.controlled.filter(x=>x.principalVerified).length,principalFailures:report.controlled.filter(x=>!x.principalVerified),httpFailures:report.controlled.filter(x=>x.status>=500||x.status===0),jsFailures:report.controlled.filter(x=>x.errors?.length),serverFailures:report.controlled.filter(x=>x.serverFailures?.length),adminProtectedFallbacks:report.controlled.filter(x=>x.role==='admin'&&x.protectedFallback),unexpectedPreviews:report.controlled.filter(x=>x.preview),mobileOverflow:report.controlled.filter(x=>x.role==='admin-mobile'&&x.overflow),adminLinks:report.links.length,nonSuccessfulLinks:report.links.filter(x=>x.status>=400||x.status===0),ui:report.ui,modules:report.controlled.map(x=>({role:x.role,path:x.path,status:x.status,principalVerified:x.principalVerified,denied:x.denied,preview:x.preview,protectedFallback:x.protectedFallback,overflow:x.overflow})),limitations:report.limitations};
await writeFile('.audit/auth-browser-report.json',JSON.stringify(report,null,2));await writeFile('.audit/auth-browser-summary.json',JSON.stringify(summary,null,2));
console.log('AUDIT_AUTHENTICATED_BROWSER '+JSON.stringify(summary));
