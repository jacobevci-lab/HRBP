/** Actual Next.js API + PostgreSQL concurrency. No production/provider calls or UI claims. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const origin = 'http://localhost:3100';
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.equal(url.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/policy-assignment-exception'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Actual production Next.js endpoints, local signed sessions, disposable PostgreSQL row locks. All records synthetic.',
  limitations: ['API tests are not clicks in assignment/exception administration forms.', 'Fixtures are inserted directly in the isolated database.', 'No new grants, production mutation, automatic historical repair or provider integration.', 'A policy exception approval does not automatically waive its policy assignment.'] };
const db = new PrismaClient(); const marker = 'pae-' + randomUUID().slice(0, 10);
let tenantId, seq = 0;
async function login(id) {
  const r = await fetch(origin + '/api/auth/local', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ identifier: id, password }) });
  assert.equal(r.status, 200, 'synthetic sign-in'); const cookie = r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return cookie;
}
async function post(cookie, path, data, extra = {}) {
  const r = await fetch(origin + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(data) });
  let body; try { body = await r.json(); } catch { body = { nonJson: true }; }
  return { status: r.status, body };
}
async function employee() {
  const person = await db.person.create({ data: { tenantId, employeeNumber: `${marker}-${++seq}`, givenName: 'Synthetic', familyName: marker } });
  return db.employment.create({ data: { tenantId, personId: person.id, status: 'ACTIVE', startDate: new Date(Date.now() - 86400000) } });
}
async function policy(ownerId) {
  const text = 'Synthetic assignment and exception test policy.';
  return db.policyRecord.create({ data: { tenantId, code: `${marker}-${++seq}`, title: 'Synthetic policy lifecycle test', version: '1.0', ownerId,
    contentMarkdown: text, contentHash: createHash('sha256').update(text).digest('hex'), effectiveFrom: new Date(Date.now()-86400000), status:'PUBLISHED' } });
}
async function fixtureException(p, subject, requester, extra = {}) {
  return db.policyException.create({ data: { tenantId, policyId:p.id, employmentId:subject.id, requestedById:requester, reason:'Synthetic exception', status:'REQUESTED', active:false, ...extra } });
}
async function test(name, fn) {
  try { report.tests.push({ name, passed:true, ...await fn() }); }
  catch(e) { report.tests.push({ name, passed:false, error:String(e.message).replaceAll(password,'[redacted]').slice(0,700) }); }
  console.log('ASSIGNMENT_EXCEPTION_SCENARIO ' + JSON.stringify(report.tests.at(-1)));
  await writeFile(`${out}/report.json`, JSON.stringify(report,null,2));
}
const assignments = policyId => db.policyAssignment.findMany({ where:{tenantId,policyId}, orderBy:{employmentId:'asc'} });
const exceptions = policyId => db.policyException.findMany({ where:{tenantId,policyId} });
const audits = (resourceId, action) => db.auditEvent.count({ where:{tenantId,resourceId,action} });
async function waiting(label) {
  const deadline = Date.now()+3000;
  while (Date.now()<deadline) {
    const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%/* ${label} */%`}`;
    if(rows[0].count>0) return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail('Expected actual endpoint lock wait for ' + label);
}
async function race(label, mutate, request, afterWaiting = async()=>{}) {
  let release, held;
  const gate = new Promise(resolve=>{release=resolve;}); const acquired = new Promise(resolve=>{held=resolve;});
  const writer = db.$transaction(async tx=>{await mutate(tx);held();await gate;},{timeout:10000});
  let response;
  try {
    await Promise.race([acquired, writer.then(()=>{throw Error('Writer exited before gate');})]);
    response=request(); await waiting(label); await afterWaiting();
  } finally {release();await writer;}
  return response;
}
try {
  const template=await db.userAccount.findUniqueOrThrow({where:{id:'user-local-test-admin'}});tenantId=template.tenantId;assert.ok(template.localPasswordHash);
  const authorId=marker+'-author', reviewerId=marker+'-reviewer', selfId=marker+'-self', restrictedId=marker+'-restricted';
  for(const [id,role] of [[authorId,'HR_OPERATIONS'],[reviewerId,'LEGAL'],[selfId,'EMPLOYEE'],[restrictedId,'HRBP']]) {
    await db.userAccount.create({data:{id,tenantId,subject:id,email:id+'@example.test',displayName:'Synthetic policy QA',role,active:true,localAuthEnabled:true,localPasswordHash:template.localPasswordHash}});
  }
  const selfPerson=await db.person.create({data:{tenantId,employeeNumber:marker+'-self',givenName:'Synthetic',familyName:'Employee',workEmail:selfId+'@example.test'}});
  const self=await db.employment.create({data:{tenantId,personId:selfPerson.id,status:'ACTIVE',startDate:new Date(Date.now()-86400000)}});
  const author=await login(authorId), reviewer=await login(reviewerId), own=await login(selfId), restricted=await login(restrictedId);
  const assign=(p,ids,extra={})=>post(author,`/api/policies/${p.id}/assignments`,{employmentIds:ids,...extra});
  const request=(p,subject,extra={})=>post(author,`/api/policies/${p.id}/exceptions`,{employmentId:subject.id,reason:'Synthetic exception',...extra});
  const decide=(p,e,decision,cookie=reviewer)=>post(cookie,`/api/policies/${p.id}/exceptions/${e.id}/decision`,{decision,note:'Synthetic decision'});

  await test('assignment: mixed existing ACKNOWLEDGED/WAIVED plus new subject preserves evidence and deadline',async()=>{
    const p=await policy(authorId), a=await employee(),b=await employee(),c=await employee();const dueAt=new Date(Date.now()+86400000);
    await db.policyAssignment.createMany({data:[{tenantId,policyId:p.id,employmentId:a.id,status:'ACKNOWLEDGED',dueAt},{tenantId,policyId:p.id,employmentId:b.id,status:'WAIVED',dueAt}]});
    const receipt=await db.policyAcknowledgement.create({data:{tenantId,policyId:p.id,employmentId:a.id,policyVersion:p.version,acknowledgedBy:authorId,ipAddress:'192.0.2.10'}});
    const before=await assignments(p.id);const response=await assign(p,[c.id,b.id,a.id],{dueAt:new Date(Date.now()+2*86400000).toISOString()});
    assert.equal(response.status,201);assert.deepEqual(response.body.data,{assigned:1,requested:3,skippedExisting:2});
    const after=await assignments(p.id);for(const old of before) assert.deepEqual(after.find(x=>x.id===old.id),old);
    assert.deepEqual(await db.policyAcknowledgement.findUnique({where:{id:receipt.id}}),receipt);
    const repeated=await assign(p,[a.id,b.id,c.id]);assert.equal(repeated.body.data.assigned,0);assert.equal(await audits(p.id,'policy.assignments-created'),1);
  });
  await test('assignment: eight overlapping reversed batches insert each subject once and audit only actual creates',async()=>{
    const p=await policy(authorId), subjects=await Promise.all(Array.from({length:4},employee));const ids=subjects.map(x=>x.id);
    const results=await Promise.all(Array.from({length:8},(_,i)=>assign(p,i%2?[...ids].reverse():ids)));
    assert.ok(results.every(x=>x.status===201));assert.equal(results.reduce((n,x)=>n+x.body.data.assigned,0),4);
    assert.equal((await assignments(p.id)).length,4);assert.equal(await audits(p.id,'policy.assignments-created'),results.filter(x=>x.body.data.assigned>0).length);
    return {requests:8,assignments:4};
  });
  await test('assignment: invalid deadline and duplicate/oversized/control-character IDs make no writes',async()=>{
    const p=await policy(authorId),a=await employee();
    for(const value of [123,true,{},[], 'not-date']) assert.equal((await assign(p,[a.id],{dueAt:value})).status,400);
    for(const ids of [[a.id,a.id],['bad\u0000id'],Array.from({length:501},(_,i)=>`e-${i}`)]) assert.equal((await assign(p,ids)).status,400);
    assert.equal((await assignments(p.id)).length,0);
  });
  await test('assignment: empty HRBP relationship scope cannot assign a subject',async()=>{
    const p=await policy(authorId),a=await employee();assert.equal((await post(restricted,`/api/policies/${p.id}/assignments`,{employmentIds:[a.id]})).status,403);assert.equal((await assignments(p.id)).length,0);
  });
  await test('assignment SQL: termination committed while waiting prevents assignment',async()=>{
    const p=await policy(authorId),a=await employee();const r=await race('policy-assign:employment',tx=>tx.employment.update({where:{id:a.id},data:{status:'TERMINATED'}}),()=>assign(p,[a.id]));
    assert.equal(r.status,400);assert.equal((await assignments(p.id)).length,0);
  });
  await test('assignment SQL: retirement committed while waiting prevents assignment',async()=>{
    const p=await policy(authorId),a=await employee();const r=await race('policy-assign:policy',tx=>tx.policyRecord.update({where:{id:p.id},data:{status:'RETIRED'}}),()=>assign(p,[a.id]));
    assert.equal(r.status,404);assert.equal((await assignments(p.id)).length,0);
  });
  await test('exception: eight concurrent requests create one pending record and one audit',async()=>{
    const p=await policy(authorId),a=await employee();const r=await Promise.all(Array.from({length:8},()=>request(p,a)));
    assert.equal(r.filter(x=>x.status===201).length,1);assert.equal(r.filter(x=>x.status===409).length,7);
    const saved=await exceptions(p.id);assert.equal(saved.length,1);assert.equal(await audits(saved[0].id,'policy.exception-requested'),1);
    assert.equal((await request(p,a)).status,409);assert.deepEqual(await exceptions(p.id),saved);
    return {requests:8,exceptions:1,requestAudits:1};
  });
  await test('exception: self-service requires assignment and ignores another supplied employee',async()=>{
    const p=await policy(authorId),other=await employee();const path=`/api/policies/${p.id}/exceptions`;
    assert.equal((await post(own,path,{reason:'Synthetic request',employmentId:other.id})).status,403);
    await db.policyAssignment.create({data:{tenantId,policyId:p.id,employmentId:self.id}});
    const r=await post(own,path,{reason:'Synthetic request',employmentId:other.id});assert.equal(r.status,201);assert.equal(r.body.data.employmentId,self.id);
  });
  await test('exception SQL: termination committed during request cannot create a pending exception',async()=>{
    const p=await policy(authorId),a=await employee();const r=await race('policy-exception:employment',tx=>tx.employment.update({where:{id:a.id},data:{status:'TERMINATED'}}),()=>request(p,a));
    assert.equal(r.status,400);assert.equal((await exceptions(p.id)).length,0);
  });
  await test('exception SQL: retired policy and expiry reached while waiting cannot create requests',async()=>{
    const p=await policy(authorId),a=await employee();const r=await race('policy-exception:policy',tx=>tx.policyRecord.update({where:{id:p.id},data:{status:'RETIRED'}}),()=>request(p,a));
    assert.equal(r.status,404);assert.equal((await exceptions(p.id)).length,0);
    const p2=await policy(authorId);const expiry=new Date(Date.now()+1200);
    const r2=await race('policy-exception:employment',tx=>tx.employment.update({where:{id:a.id},data:{status:'ACTIVE'}}),()=>request(p2,a,{expiresAt:expiry.toISOString()}),async()=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.getTime()-Date.now()+50)));});
    assert.equal(r2.status,409);assert.equal((await exceptions(p2.id)).length,0);
  });
  await test('exception decisions: existing compare-and-set permits only one competing APPROVE/REJECT',async()=>{
    const p=await policy(authorId),a=await employee(),e=await fixtureException(p,a,authorId);
    const responses=await Promise.all([decide(p,e,'APPROVE'),decide(p,e,'REJECT')]);assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
    assert.equal(await audits(e.id,'policy.exception-approved')+await audits(e.id,'policy.exception-rejected'),1);
  });
  await test('exception SQL: changed expiry is checked after decision row lock, not before waiting',async()=>{
    const p=await policy(authorId),a=await employee(),e=await fixtureException(p,a,authorId);
    const r=await race('policy-exception:decision',tx=>tx.policyException.update({where:{id:e.id},data:{expiresAt:new Date(Date.now()-1000)}}),()=>decide(p,e,'APPROVE'));
    assert.equal(r.status,409);assert.equal((await db.policyException.findUniqueOrThrow({where:{id:e.id}})).status,'REQUESTED');assert.equal(await audits(e.id,'policy.exception-approved'),0);
  });
  await test('exception SQL: changed requester cannot bypass four-eyes during approval lock wait',async()=>{
    const p=await policy(authorId),a=await employee(),e=await fixtureException(p,a,authorId);
    const r=await race('policy-exception:decision',tx=>tx.policyException.update({where:{id:e.id},data:{requestedById:reviewerId}}),()=>decide(p,e,'APPROVE'));
    assert.equal(r.status,403);assert.equal((await db.policyException.findUniqueOrThrow({where:{id:e.id}})).status,'REQUESTED');
  });
  await test('exception decisions: requester cannot approve/reject; independent approve/revoke preserves assignment',async()=>{
    const p=await policy(authorId),a=await employee(),e=await fixtureException(p,a,reviewerId); // LEGAL requester has approve capability
    for(const decision of ['APPROVE','REJECT']) assert.equal((await decide(p,e,decision)).status,403);
    const e2=await fixtureException(p,a,authorId);await db.policyAssignment.create({data:{tenantId,policyId:p.id,employmentId:a.id,status:'PENDING'}});const before=await assignments(p.id);
    assert.equal((await decide(p,e2,'APPROVE')).status,200);assert.equal((await decide(p,e2,'REVOKE')).status,200);
    const saved=await db.policyException.findUniqueOrThrow({where:{id:e2.id}});assert.equal(saved.status,'REVOKED');assert.equal(saved.approvedById,reviewerId);assert.equal(saved.active,false);assert.deepEqual(await assignments(p.id),before);
  });
  await test('authorization: anonymous, employee and foreign-tenant decisions cannot mutate records',async()=>{
    const p=await policy(authorId),a=await employee(),e=await fixtureException(p,a,authorId);
    assert.equal((await decide(p,e,'APPROVE',null)).status,401);assert.equal((await decide(p,e,'APPROVE',own)).status,403);
    const foreign=await db.tenant.create({data:{name:'Synthetic isolation fixture',region:'EU'}});
    const foreignE=await db.policyException.create({data:{tenantId:foreign.id,policyId:p.id,employmentId:a.id,reason:'Synthetic inconsistent tenant',requestedById:authorId}});
    assert.equal((await decide(p,foreignE,'APPROVE')).status,404);assert.equal((await db.policyException.findUniqueOrThrow({where:{id:foreignE.id}})).status,'REQUESTED');
    assert.equal((await post(author,`/api/policies/${p.id}/assignments`,{employmentIds:[a.id]},{origin:'https://example.invalid'})).status,403);
  });
} finally {
  await db.$disconnect();
  report.summary={tests:report.tests.length,passed:report.tests.filter(x=>x.passed).length,failed:report.tests.filter(x=>!x.passed).length};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log('ASSIGNMENT_EXCEPTION_SUMMARY '+JSON.stringify(report.summary));
  if(report.summary.failed)process.exitCode=1;
}
