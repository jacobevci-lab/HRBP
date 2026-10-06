/** Receipt verification for restricted payroll lifecycle mutations. */
export type PayrollStatus="DRAFT"|"VALIDATING"|"CALCULATED"|"EXCEPTION"|"APPROVAL"|"APPROVED"|"PAID"|"CANCELLED";
export type PayrollActionResult={outcome:"saved";id:string;status:PayrollStatus}|{outcome:"rejected";status:number;blockers?:Record<string,number>}|{outcome:"unknown"};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const statuses=new Set<PayrollStatus>(["DRAFT","VALIDATING","CALCULATED","EXCEPTION","APPROVAL","APPROVED","PAID","CANCELLED"]);
const blockerKeys=new Set(["noResults","currencyMismatch","ledgerMismatches","unlockedTimeEntries","pendingLeaveRequests","pendingCompensationChanges"]);
async function receipt(response:Response){
 if(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"||!response.body){await response.body?.cancel().catch(()=>{});throw new Error("Invalid receipt");}
 const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let source="",bytes=0;
 try{for(;;){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw new Error("Receipt too large");source+=decoder.decode(value,{stream:true});}return JSON.parse(source+decoder.decode());}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function parseBlockers(value:unknown){if(value===undefined)return undefined;if(!object(value))return null;const out:Record<string,number>={};for(const[k,v]of Object.entries(value)){if(!blockerKeys.has(k)||!Number.isSafeInteger(v)||Number(v)<0)return null;out[k]=Number(v);}return out;}
function matches(runId:string,status:PayrollStatus,data:Record<string,unknown>){
 if(data.id!==runId||data.status!==status||!id(data.payrollPeriodId)||!Number.isSafeInteger(data.runNumber)||Number(data.runNumber)<1||!date(data.startedAt))return false;
 if(status==="CALCULATED"&&!date(data.calculatedAt))return false;
 if(status==="APPROVED"&&(!date(data.approvedAt)||!id(data.approvedById)))return false;
 if(status==="PAID"&&!date(data.paidAt))return false;
 return true;
}
export async function submitPayrollTransition(runId:string,status:PayrollStatus,options:{fetchImpl?:typeof fetch;signal?:AbortSignal;timeoutMs?:number}={}):Promise<PayrollActionResult>{
 const timeoutMs=options.timeoutMs??20000;if(!id(runId)||[".",".."].includes(runId)||!statuses.has(status)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)return{outcome:"rejected",status:400};
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener("abort",abort,{once:true});if(options.signal?.aborted)controller.abort();const timer=setTimeout(abort,timeoutMs);
 try{
  if(controller.signal.aborted)return{outcome:"unknown"};
  const url="/api/payroll/runs/"+encodeURIComponent(runId)+"/transition";
  const response=await(options.fetchImpl??fetch)(url,{method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",signal:controller.signal,headers:{Accept:"application/json","content-type":"application/json","x-purpose":"Governed payroll lifecycle transition"},body:JSON.stringify({status})});
  if(response.redirected)return{outcome:"unknown"};const body=await receipt(response);if(controller.signal.aborted||!object(body))return{outcome:"unknown"};
  if([400,401,403,404,409,422,429].includes(response.status)&&typeof body.error==="string"&&body.error.trim()&&body.error.length<=2000&&body.data===undefined){const parsed=parseBlockers(body.blockers);if(parsed===null)return{outcome:"unknown"};return{outcome:"rejected",status:response.status,...(parsed?{blockers:parsed}:{})};}
  if(response.status===200&&body.error===undefined&&object(body.data)&&matches(runId,status,body.data))return{outcome:"saved",id:runId,status};
  return{outcome:"unknown"};
 }catch{return{outcome:"unknown"};}finally{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
}
const blockerLabels:Record<string,{en:string;tr:string}>={noResults:{en:"missing payroll results",tr:"eksik bordro sonucu"},currencyMismatch:{en:"currency mismatches",tr:"para birimi uyuşmazlığı"},ledgerMismatches:{en:"ledger mismatches",tr:"ledger uyuşmazlığı"},unlockedTimeEntries:{en:"unlocked time entries",tr:"kilitlenmemiş zaman kaydı"},pendingLeaveRequests:{en:"pending leave requests",tr:"bekleyen izin talebi"},pendingCompensationChanges:{en:"unapplied compensation changes",tr:"uygulanmamış ücret değişikliği"}};
export function payrollActionMessage(result:PayrollActionResult,locale:"en"|"tr"){
 const tr=locale==="tr";if(result.outcome==="saved")return tr?"Bordro geçişi sunucu yanıtıyla doğrulandı.":"The payroll transition was confirmed by the server response.";
 if(result.outcome==="unknown")return tr?"İşlemin sonucu doğrulanamadı; kaydedilmiş olabilir. Otomatik tekrar yapılmadı. Yenileyip bordro durumunu kontrol edin.":"The outcome could not be confirmed; it may have been saved. No automatic retry was made. Reload and check the payroll run.";
 const lang=tr?"tr":"en";const detail=result.blockers?Object.entries(result.blockers).filter(([,v])=>v>0).map(([k,v])=>String(v)+" "+(blockerLabels[k]?.[lang]??k)).join(" · "):"";
 const base=result.status===401?(tr?"Oturum doğrulanamadı.":"Your session could not be verified."):result.status===403?(tr?"Bu bordro işlemi için yetkiniz yok.":"You are not authorized for this payroll action."):result.status===404?(tr?"Bordro çalıştırması artık kullanılamıyor.":"The payroll run is no longer available."):result.status===409?(tr?"Bordro girdileri veya state güncel değil.":"Payroll inputs or state are not current."):result.status===429?(tr?"Çok fazla istek gönderildi.":"Too many requests."):(tr?"Bordro geçişi kabul edilmedi.":"The payroll transition was not accepted.");
 return [base,detail].filter(Boolean).join(" ");
}
export async function acknowledgePayrollNotification(runId:string,options:{fetchImpl?:typeof fetch;timeoutMs?:number}={}){
 const timeoutMs=options.timeoutMs??5000;if(!id(runId)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)return false;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await(options.fetchImpl??fetch)("/api/notifications",{method:"PATCH",credentials:"same-origin",redirect:"error",cache:"no-store",signal:controller.signal,headers:{Accept:"application/json","content-type":"application/json"},body:JSON.stringify({resourceType:"PayrollRun",resourceId:runId,read:true})});if(response.redirected)return false;const body=await receipt(response);return !controller.signal.aborted&&response.status===200&&object(body)&&body.error===undefined&&object(body.data)&&Number.isSafeInteger(body.data.updated)&&Number.isSafeInteger(body.data.unreadCount);}catch{return false;}finally{clearTimeout(timer);}
}
