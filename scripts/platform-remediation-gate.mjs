import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
const origin='http://localhost:3100';
const url=new URL(process.env.DATABASE_URL||'about:blank');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,'true');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/hrbp_audit');
const base=JSON.parse(await readFile('.audit/platform-summary.json','utf8'));
const browser=JSON.parse(await readFile('.audit/auth-browser-summary.json','utf8'));
const failures=[],checks=[];
function check(name,ok,detail){checks.push({name,passed:!!ok,detail});if(!ok)failures.push(name);}
check('Seed admin can log in',base.checks.some(x=>x.category==='seed-admin-login'&&x.actual===200));
check('No invalid JSON write returns 5xx',base.invalidWrite500.length===0,base.invalidWrite500);
check('Malformed cookie cannot cause 500',base.checks.filter(x=>x.category==='malformed-cookie').every(x=>x.actual>0&&x.actual<500));
check('Unsafe return destination rejected',base.checks.some(x=>x.category==='return-to'&&x.leavesOrigin===false));
check('Disabled account rejected on existing cookie',base.checks.some(x=>x.category==='disabled-user-existing-session'&&x.actual===401));
check('Onboarding valid workflow still persists',base.checks.some(x=>x.category==='onboarding-persisted'&&x.actual==='ACTIVE'));
check('Natural navigation preserves all four principals',browser.natural.length===4&&browser.natural.every(x=>x.before.authenticated&&x.after.authenticated&&!x.principalLost&&x.logoutRequests.length===0&&x.explicitSignOutWorks),browser.natural);
check('Every tested page retains its expected principal',browser.principalFailures.length===0,browser.principalFailures);
check('Primary browser sweep has no navigation, JavaScript or server errors',base.browser500.length===0&&base.browserJsErrors.length===0&&base.serverFailurePages.length===0,{navigation:base.browser500,js:base.browserJsErrors,server:base.serverFailurePages});
check('Both mobile sweeps fit the document',base.mobileOverflow.length===0&&browser.mobileOverflow.length===0,{primary:base.mobileOverflow,principalVerified:browser.mobileOverflow});
check('No browser errors or 5xx',browser.jsFailures.length===0&&browser.httpFailures.length===0&&browser.serverFailures.length===0,{js:browser.jsFailures,http:browser.httpFailures,server:browser.serverFailures});
check('No unexpected authenticated fallback',browser.adminProtectedFallbacks.length===0&&browser.unexpectedPreviews.length===0);
check('Rendered internal links respond successfully',browser.nonSuccessfulLinks.length===0,browser.nonSuccessfulLinks);
check('Mobile pages fit viewport without document-level clipping',browser.mobileOverflow.length===0,browser.mobileOverflow);
for(const path of ['/module/engagement','/module/workforce-planning','/module/ai-assistant'])check('Turkish live labels: '+path,browser.ui.some(x=>x.path===path&&x.turkishSelected&&x.remainingEnglishLabels.length===0));
const db=new PrismaClient();const pass=process.env.HRBP_TEST_ADMIN_PASSWORD;
async function http(path,method='GET',cookie,body,headers={}){return fetch(origin+path,{method,redirect:'manual',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
async function login(){const r=await http('/api/auth/local','POST',undefined,{identifier:'audit.employee',password:pass});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
try{
 await db.userAccount.update({where:{id:'qa-audit-employee'},data:{active:true,localAuthEnabled:true}});
 const cookie=await login();const row=await db.userAccount.findUnique({where:{id:'qa-audit-employee'}});
 const prefetched=await http('/api/auth/logout','GET',cookie,undefined,{'next-router-prefetch':'1',rsc:'1'});
 check('Logout GET is side-effect-free',prefetched.status===405&&!prefetched.headers.get('set-cookie'));
 const cross=await http('/api/auth/logout','POST',cookie,{}, {origin:'https://other.invalid'});
 check('Cross-origin signout rejected',cross.status===403&&!cross.headers.get('set-cookie'));
 for(const change of [{active:false},{role:'HRBP'},{localAuthEnabled:false},{localPasswordUpdatedAt:new Date()}]){
  await db.userAccount.update({where:{id:row.id},data:change});
  for(const path of ['/api/people','/api/notifications','/api/onboarding/operations']){
   const r=await http(path,'GET',cookie);check('Old session denied after '+Object.keys(change)[0]+' at '+path,r.status===401,r.status);
  }
  const session=await(await http('/api/auth/session','GET',cookie)).json();check('Session metadata rejects '+Object.keys(change)[0],session.authenticated===false);
  await db.userAccount.update({where:{id:row.id},data:{active:true,role:row.role,localAuthEnabled:true,localPasswordUpdatedAt:row.localPasswordUpdatedAt}});
 }
 const parts=row.localPasswordHash.split('$');assert.equal(parts.length,6);
 const legacy=parts.slice(0,4).join('$')+parts[4]+parts[5];
 await db.userAccount.update({where:{id:row.id},data:{localPasswordHash:legacy}});
 const wrong=await http('/api/auth/local','POST',undefined,{identifier:'audit.employee',password:'deliberately-incorrect-password'});
 check('Legacy password still requires valid secret',wrong.status===401);
 const upgraded=await login();const repaired=await db.userAccount.findUnique({where:{id:row.id}});
 check('Legacy seed hash upgrades on valid sign-in',repaired.localPasswordHash.split('$').length===6&&!!repaired.localPasswordUpdatedAt);
 check('Upgraded session valid', (await http('/api/people','GET',upgraded)).status===200);
 check('Pre-upgrade cookie revoked', (await http('/api/people','GET',cookie)).status===401);
 const noOrigin=await fetch(origin+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{cookie:upgraded},signal:AbortSignal.timeout(10000)});check('Missing-origin logout rejected',noOrigin.status===403);
}finally{await db.$disconnect();}
await writeFile('.audit/remediation-gate.json',JSON.stringify({checks,failures},null,2));
console.log('REMEDIATION_GATE '+JSON.stringify({checks:checks.length,failures}));
assert.deepEqual(failures,[],'Platform regressions remain; inspect evidence, do not merge.');
