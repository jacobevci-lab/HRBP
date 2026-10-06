/** Real manager login + governed time transition + disposable PostgreSQL.
 * Faults alter only the browser-facing response after a real transition commits. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const origin="http://localhost:3100";
const surface=process.env.HRBP_TIME_DECISION_SURFACE||"module";
assert.ok(["module","action-center"].includes(surface));
const actionCenter=surface==="action-center";
const database=new URL(process.env.DATABASE_URL||"about:blank");
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT,"true");
assert.ok(["postgres:","postgresql:"].includes(database.protocol));
assert.ok(["localhost","127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname,"/hrbp_audit"); assert.equal(database.search,"");
assert.ok(process.env.HRBP_TEST_ADMIN_PASSWORD);

const db=new PrismaClient();
const browser=await chromium.launch({headless:true});
await mkdir(".audit",{recursive:true});
const report={source:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),surface,checks:[],failures:[],
 scope:"MANAGER, EN desktop/TR mobile, real login/TimeEntry transition/PostgreSQL; controlled response loss and notification failure on disposable localhost only."};
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log("TIME_DECISION_PASS "+name);}catch(e){report.checks.push({name,passed:false});report.failures.push(name);throw e;}}
async function eventually(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}assert.fail("Expected persisted state was not observed");}

try{
 for(const[locale,width]of[["en",1280],["tr",390]]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:locale==="tr"?"tr-TR":"en-US"});
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addCookies([{name:"hrbp-locale",value:locale,url:origin,sameSite:"Lax"}]);
  const page=await context.newPage(); page.setDefaultTimeout(10000);
  const posts=[],patches=[],jsErrors=[];
  page.on("pageerror",e=>jsErrors.push(e.name));
  page.on("request",req=>{const path=new URL(req.url()).pathname;if(req.method()==="POST"&&path.includes("/api/time/entries/")&&path.endsWith("/transition"))posts.push(path);if(req.method()==="PATCH"&&path==="/api/notifications")patches.push(path);});
  const name=label=>surface+"/"+locale+": "+label;
  const identity=async()=>{const r=await context.request.get(origin+"/api/auth/session");const b=await r.json();assert.equal(b.authenticated,true);assert.equal(b.user.id,"qa-audit-manager");assert.equal(b.user.role,"MANAGER");assert.ok(b.user.employmentId);return b.user;};
  let actor,employee,schedule;
  try{
   await check(name("real form login and manager principal"),async()=>{
    await page.goto(origin+"/auth/sign-in?returnTo="+encodeURIComponent(actionCenter?"/module/workflows":"/module/time-attendance"),{waitUntil:"networkidle"});
    await page.locator("#local-identifier").fill("audit.manager");
    await page.locator("#local-password").fill(process.env.HRBP_TEST_ADMIN_PASSWORD);
    await page.locator('.local-auth-card button[type="submit"]').click();
    await page.waitForURL(origin+(actionCenter?"/module/workflows":"/module/time-attendance")); actor=await identity();
   });
   schedule=await db.workSchedule.findFirstOrThrow({where:{tenantId:actor.tenantId,active:true}});
   const person=await db.person.create({data:{tenantId:actor.tenantId,givenName:"QA time",familyName:"Report",employeeNumber:randomUUID()}});
   employee=await db.employment.create({data:{tenantId:actor.tenantId,personId:person.id,status:"ACTIVE",startDate:new Date("2025-01-01"),managerEmploymentId:actor.employmentId}});
   await db.workScheduleAssignment.create({data:{tenantId:actor.tenantId,employmentId:employee.id,scheduleId:schedule.id,effectiveFrom:new Date("2025-01-01")}});
   async function fixture(){
    const workDate=new Date();workDate.setUTCHours(0,0,0,0);
    const startAt=new Date(workDate);startAt.setUTCHours(9,0,0,0);
    const endAt=new Date(workDate);endAt.setUTCHours(17,0,0,0);
    const record=await db.timeEntry.create({data:{tenantId:actor.tenantId,employmentId:employee.id,workDate,startAt,endAt,minutes:480,overtimeMinutes:30,status:"SUBMITTED",source:"QA_BROWSER"}});
    const notice=await db.notificationOutbox.create({data:{tenantId:actor.tenantId,recipientUserId:actor.id,eventType:"TIME_ENTRY_APPROVAL_REQUIRED",resourceType:"TimeEntry",resourceId:record.id,dedupeKey:randomUUID(),status:"DELIVERED",channel:"IN_APP",deliveredAt:new Date()}});
    const path=actionCenter?"/module/workflows":"/module/time-attendance?entry="+encodeURIComponent(record.id);
    await page.goto(origin+path,{waitUntil:"networkidle"});
    const control=actionCenter?page.locator('[data-time-decision-id="'+record.id+'"]'):page.locator('[data-time-entry-id="'+record.id+'"]');
    await control.waitFor();
    const button=decision=>actionCenter?control.locator('[data-time-decision="'+decision+'"]'):control.locator('[data-time-transition="'+decision+'"]');
    assert.equal(await button("APPROVED").count(),1);assert.equal(await button("REJECTED").count(),1);
    return{record,notice,control,button,path:"/api/time/entries/"+record.id+"/transition"};
   }
   const state=f=>db.timeEntry.findUniqueOrThrow({where:{id:f.record.id}});
   const unread=async f=>(await db.notificationOutbox.findUniqueOrThrow({where:{id:f.notice.id}})).readAt===null;
   const auditCount=f=>db.auditEvent.count({where:{tenantId:actor.tenantId,resourceType:"TimeEntry",resourceId:f.record.id,action:{in:["time-entry.approved","time-entry.rejected"]}}});

   let f=await fixture();
   await check(name("dismiss confirmation without transition"),async()=>{
    const before=posts.length;page.once("dialog",d=>d.dismiss());await f.button("APPROVED").click();
    assert.equal(posts.length,before);assert.equal((await state(f)).status,"SUBMITTED");assert.equal(await unread(f),true);
   });

   await check(name("opposite same-turn clicks send one verified decision"),async()=>{
    let release,started;const gate=new Promise(r=>{release=r;}),arrived=new Promise(r=>{started=r;});
    const handler=async route=>{started();await gate;const response=await route.fetch();await route.fulfill({response});};
    await context.route(origin+f.path,handler);const before=posts.length;page.once("dialog",d=>d.accept());
    try{
     await f.control.evaluate((el,isAC)=>{const a=isAC?'[data-time-decision="APPROVED"]':'[data-time-transition="APPROVED"]';const r=isAC?'[data-time-decision="REJECTED"]':'[data-time-transition="REJECTED"]';el.querySelector(a)?.click();el.querySelector(r)?.click();},actionCenter);
     await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(new Error("No transition request")),10000))]);
     assert.equal(posts.length-before,1);
    }finally{release();}
    await eventually(async()=>{const row=await state(f);return row.status==="APPROVED"&&row.approvedById===actor.id;});
    assert.equal(await auditCount(f),1);await eventually(async()=>!(await unread(f)));
    await context.unroute(origin+f.path,handler);
   });

   await check(name("rejection stays committed when badge cleanup fails"),async()=>{
    f=await fixture();
    const fail=route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Simulated notification failure"})});
    await context.route(origin+"/api/notifications",fail);page.once("dialog",d=>d.accept());await f.button("REJECTED").click();
    await eventually(async()=>{const row=await state(f);return row.status==="REJECTED"&&row.approvedById===actor.id;});
    assert.equal(await auditCount(f),1);assert.equal(await unread(f),true);await context.unroute(origin+"/api/notifications",fail);
   });

   for(const mode of["html-after-commit","lost-after-commit"])await check(name(mode+" becomes unknown and never replays"),async()=>{
    f=await fixture();const before=posts.length,beforePatches=patches.length;let snapshot;
    if(actionCenter){const r=await context.request.get(origin+"/api/action-center");assert.equal(r.status(),200);snapshot=await r.json();assert.ok(snapshot.data.items.some(item=>item.action?.entryId===f.record.id));}
    const handler=async route=>{const response=await route.fetch();assert.equal(response.status(),200);if(mode==="html-after-commit")await route.fulfill({status:200,contentType:"text/html",body:"<html>interrupted</html>"});else await route.abort("failed");};
    await context.route(origin+f.path,handler);page.once("dialog",d=>d.accept());await f.button("APPROVED").click();
    if(actionCenter)await f.control.locator('[data-time-decision-result="unknown"]').waitFor();else await page.locator('[data-time-entry-id="'+f.record.id+'"][data-time-transition-result="unknown"]').waitFor();
    assert.equal(await f.button("APPROVED").count(),0);assert.equal(await f.button("REJECTED").count(),0);
    await eventually(async()=>{const row=await state(f);return row.status==="APPROVED"&&row.approvedById===actor.id;});
    assert.equal(await auditCount(f),1);assert.equal(await unread(f),true);assert.equal(patches.length,beforePatches);
    await context.unroute(origin+f.path,handler);
    if(actionCenter){
     const center=page.locator(".workflow-action-center"),search=center.locator(".workflow-action-search input");
     await search.fill("no-match-"+randomUUID());await f.control.waitFor({state:"detached"});await search.fill("");await f.control.locator('[data-time-decision-result="unknown"]').waitFor();
     const stale=route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(snapshot)});
     await context.route(origin+"/api/action-center",stale);
     try{await center.locator(".workflow-action-head button").click();await page.waitForFunction(()=>!document.querySelector(".workflow-action-head button")?.disabled);await f.control.locator('[data-time-decision-result="unknown"]').waitFor();assert.equal(posts.length-before,1);}finally{await context.unroute(origin+"/api/action-center",stale);}
     await f.control.locator("[data-time-decision-reload]").click();
    }else{
     await f.control.locator("button").filter({hasText:locale==="tr"?"Yenile ve kaydı kontrol et":"Reload and check the entry"}).click();
    }
    await page.waitForLoadState("networkidle");assert.equal(posts.length-before,1);assert.equal(await auditCount(f),1);await identity();
   });
   assert.deepEqual(jsErrors,[]);
  }finally{await context.close();}
 }
}catch(error){report.failures.push(error instanceof Error?error.message:"Regression failed");process.exitCode=1;}
finally{await browser.close();await db.$disconnect();await writeFile(".audit/time-decision-browser.json",JSON.stringify(report,null,2));console.log("TIME_DECISION_BROWSER",JSON.stringify({surface,checks:report.checks.length,failures:report.failures}));}
