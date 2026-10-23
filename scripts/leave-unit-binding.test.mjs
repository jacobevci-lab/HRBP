/** Actual input/handler/client modules with isolated dependency doubles.
 * Real signed-session + PostgreSQL + browser coverage is separate. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const enums={LeaveUnit:{DAYS:'DAYS',HOURS:'HOURS'},LeaveRequestStatus:{PENDING:'PENDING',APPROVED:'APPROVED',TAKEN:'TAKEN'},
 DataClassification:{CONFIDENTIAL:'CONFIDENTIAL'},Prisma:{TransactionIsolationLevel:{Serializable:'Serializable'},PrismaClientKnownRequestError:class extends Error{}}};
function load(path,mocks={}){
 const output=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};runInNewContext(output,{module:m,exports:m.exports,require(name){
  if(name in mocks)return mocks[name];if(name==='@prisma/client')return enums;
  if(['@/lib/input-validation','@/lib/leave-input','@/lib/leave-balance-amount'].includes(name))return load(name.replace('@/','')+'.ts',mocks);
  throw Error('Unexpected dependency '+name);
 },Request,Response,Date,Error,RangeError,URL,URLSearchParams,TextDecoder,AbortController,setTimeout,clearTimeout});return m.exports;
}
const parser=load('lib/leave-input.ts'),helper=load('lib/leave-client-action.ts');
const input={employmentId:'employment-a',leaveTypeId:'type-a',startsAt:'2029-06-12',endsAt:'2029-06-12',units:'1.25',reason:'Synthetic reason'};
const snapshot=unit=>({...input,expectedUnit:unit});
const invalid=[null,'','days',' HOURS','WEEKS',1,true,{},['DAYS']];
for(const value of invalid)test('parser refuses supplied invalid unit '+JSON.stringify(value),()=>assert.equal(parser.parseLeaveRequest(snapshot(value)).ok,false));
for(const unit of ['DAYS','HOURS'])test('parser retains the exact selected '+unit,()=>{
 const p=parser.parseLeaveRequest(snapshot(unit));assert.equal(p.ok,true);assert.equal(p.value.expectedUnit,unit);assert.equal(p.value.units,1.25);
});
test('legacy parser omission remains compatible, never silently inferred as DAYS',()=>{
 const p=parser.parseLeaveRequest(input);assert.equal(p.ok,true);assert.equal(p.value.expectedUnit,undefined);
});
function fixture({unit='DAYS',auto=false,auth=true,grant=true,origin=true,exists=true,auditFails=false}={}){
 const ctx={tenantId:'tenant-a',actorId:'actor-a',employmentId:'employment-a'},calls=[],records=[],audits=[],notifications=[];let used=0;
 const tx={employment:{findFirst:async()=>({id:'employment-a',managerEmploymentId:'manager-a',person:{givenName:'Synthetic',familyName:'Employee'}})},
  leaveType:{findFirst:async args=>{calls.push({typeRead:args});return exists?{id:'type-a',name:'Synthetic leave',unit,requiresApproval:!auto,annualAllowance:8}:null;}},
  leaveRequest:{findFirst:async()=>null,create:async({data})=>{const row={id:'leave-a',...data};records.push(row);return row;}},
  leaveBalance:{findUnique:async()=>({id:'balance-a',opening:'8',accrued:'0',adjustment:'0',used:String(used)}),update:async({data})=>{used+=data.used.increment;return {};}}};
 const db={$transaction:async(fn,options)=>{calls.push({transaction:options});const before=[records.length,audits.length,notifications.length,used];
  try{return await fn(tx);}catch(e){records.length=before[0];audits.length=before[1];notifications.length=before[2];used=before[3];throw e;}}};
 const handler=load('app/api/leave/requests/route.ts',{'@/lib/db':{db},'@/lib/authorization':{can:()=>grant,forbidden:()=>Response.json({error:'denied'},{status:403})},
  '@/lib/audit':{appendAudit:async(_tx,_ctx,a)=>{if(auditFails)throw Error('AUDIT_FAILURE');audits.push(a);}},
  '@/lib/employment-scope':{resolveEmploymentScope:async()=>({}),canActOnEmployment:()=>grant},
  '@/lib/leave-notifications':{enqueueLeaveApprovalNotification:async(_tx,n)=>notifications.push(n)},
  '@/lib/request-context':{getRequestContext:async()=>auth?ctx:null,mutationOriginAllowed:()=>origin,unauthorized:()=>Response.json({error:'login'},{status:401})}}).POST;
 return {calls,records,audits,notifications,get used(){return used;},async post(body){const res=await handler(new Request('http://localhost/api/leave/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {response:res,body:await res.json()};}};
}
for(const unit of ['DAYS','HOURS'])for(const auto of [false,true])test(`endpoint: ${unit} ${auto?'automatic':'pending'} verifies unit before evidence/balance`,async()=>{
 const f=fixture({unit,auto}),{response,body}=await f.post(snapshot(unit));assert.equal(response.status,201);assert.equal(body.data.validatedUnit,unit);
 assert.equal(body.data.status,auto?'APPROVED':'PENDING');assert.equal(body.data.units,1.25);
 assert.equal(f.records.length,1);assert.equal(f.audits.length,1);assert.ok(f.audits[0].purpose.includes(unit));
 assert.equal(f.notifications.length,auto?0:1);assert.equal(f.used,auto?1.25:0);
 assert.equal(f.calls[0].transaction.isolationLevel,'Serializable');assert.equal(f.calls.find(x=>x.typeRead).typeRead.select.unit,true);
 assert.equal(f.calls.find(x=>x.typeRead).typeRead.where.tenantId,'tenant-a');
});
for(const [displayed,actual] of [['DAYS','HOURS'],['HOURS','DAYS']])test(`endpoint: ${displayed} draft cannot be saved as ${actual}`,async()=>{
 const f=fixture({unit:actual,auto:true}),{response,body}=await f.post(snapshot(displayed));assert.equal(response.status,409);assert.equal(body.code,'LEAVE_UNIT_CHANGED');
 assert.equal(body.data,undefined);assert.equal(f.records.length,0);assert.equal(f.audits.length,0);assert.equal(f.notifications.length,0);assert.equal(f.used,0);
});
for(const options of [{auth:false},{grant:false},{origin:false}])test('endpoint existing authentication/origin/role denial precedes type read '+JSON.stringify(options),async()=>{
 const f=fixture(options),{response}=await f.post(snapshot('DAYS'));assert.equal(response.status,options.auth===false?401:403);assert.equal(f.calls.length,0);
});
test('endpoint unavailable type retains scoped 404 and no unit evidence',async()=>{
 const f=fixture({exists:false}),r=await f.post(snapshot('HOURS'));assert.equal(r.response.status,404);assert.equal(r.body.data,undefined);assert.equal(f.records.length,0);
});
test('endpoint legacy request keeps the original response and does not claim unit binding',async()=>{
 const f=fixture({unit:'HOURS'}),r=await f.post(input);assert.equal(r.response.status,201);assert.equal(r.body.data.validatedUnit,undefined);assert.equal(f.audits[0].purpose,undefined);
});
test('endpoint unit audit failure rolls back the fixture balance and record',async()=>{
 const f=fixture({unit:'HOURS',auto:true,auditFails:true});await assert.rejects(f.post(snapshot('HOURS')),/AUDIT_FAILURE/);assert.equal(f.records.length,0);assert.equal(f.used,0);
});
const receipt=(unit)=>({data:{id:'leave-a',employmentId:input.employmentId,leaveTypeId:input.leaveTypeId,startsAt:input.startsAt,endsAt:input.endsAt,units:input.units,status:'PENDING',validatedUnit:unit}});
async function submit(unit,body,status=201){let calls=0;let sent;const result=await helper.submitLeaveAction({kind:'create',input:snapshot(unit)},{fetchImpl:async(_url,options)=>{calls++;sent=JSON.parse(options.body);return Response.json(body,{status});}});return {result,calls,sent};}
for(const unit of ['DAYS','HOURS'])test('client exact '+unit+' receipt is required for a bound request',async()=>{
 const r=await submit(unit,receipt(unit));assert.equal(r.result.outcome,'saved');assert.equal(r.sent.expectedUnit,unit);assert.equal(r.calls,1);
});
for(const value of [undefined,null,'HOURS',{},['DAYS']])test('client substituted or missing unit stays unknown '+JSON.stringify(value),async()=>{
 const r=await submit('DAYS',receipt(value));assert.equal(r.result.outcome,'unknown');assert.equal(r.calls,1);
});
for(const unit of [null,'WEEKS',{}])test('client invalid supplied unit makes no network call '+JSON.stringify(unit),async()=>{
 const r=await submit(unit,receipt(unit));assert.equal(r.result.outcome,'rejected');assert.equal(r.calls,0);
});
test('unit conflict is localized without passing arbitrary upstream error text',async()=>{
 const r=await submit('DAYS',{error:'secret provider details',code:'LEAVE_UNIT_CHANGED'},409);assert.equal(r.result.outcome,'rejected');assert.equal(r.result.code,'LEAVE_UNIT_CHANGED');
 assert.match(helper.leaveActionMessage(r.result,'en'),/unit/);assert.match(helper.leaveActionMessage(r.result,'tr'),/birimi/);
 assert.ok(!JSON.stringify(r.result).includes('secret'));assert.ok(!helper.leaveActionMessage(r.result,'tr').includes('secret'));
});
