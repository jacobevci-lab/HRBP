/** Receipt verification for restricted compensation mutations. Server policy remains authoritative. */
export type CompensationDecision = "APPROVE" | "REJECT" | "APPLY";
export type CompensationAction = { kind: "submit"; changeId: string } | { kind: "decision"; changeId: string; decision: CompensationDecision };
export type CompensationActionResult =
  | { outcome: "saved"; id: string; status: "APPROVAL" | "APPROVED" | "REJECTED" | "APPLIED" }
  | { outcome: "rejected"; status: number }
  | { outcome: "unknown" };
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=191&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v));
async function receipt(response:Response){
 if(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"||!response.body){await response.body?.cancel().catch(()=>{});throw new Error("Invalid receipt");}
 const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let source="",bytes=0;
 try{for(;;){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw new Error("Receipt too large");source+=decoder.decode(value,{stream:true});}return JSON.parse(source+decoder.decode());}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function expected(action:CompensationAction){return action.kind==="submit"?"APPROVAL":action.decision==="APPROVE"?"APPROVED":action.decision==="REJECT"?"REJECTED":"APPLIED";}
function matches(action:CompensationAction,data:Record<string,unknown>){
 if(data.id!==action.changeId||data.status!==expected(action))return false;
 return action.kind!=="decision"||action.decision!=="APPLY"||(id(data.historyId)&&date(data.effectiveAt));
}
export async function submitCompensationAction(action:CompensationAction,options:{fetchImpl?:typeof fetch;signal?:AbortSignal;timeoutMs?:number}={}):Promise<CompensationActionResult>{
 const timeoutMs=options.timeoutMs??20000;
 if(!id(action.changeId)||[".",".."].includes(action.changeId)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)return{outcome:"rejected",status:400};
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener("abort",abort,{once:true});if(options.signal?.aborted)controller.abort();const timer=setTimeout(abort,timeoutMs);
 try{
  if(controller.signal.aborted)return{outcome:"unknown"};
  const decision=action.kind==="decision";
  const url=decision?"/api/compensation/changes/"+encodeURIComponent(action.changeId)+"/decision":"/api/compensation/changes/"+encodeURIComponent(action.changeId)+"/submit";
  const response=await(options.fetchImpl??fetch)(url,{method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",signal:controller.signal,headers:{Accept:"application/json","x-purpose":decision?"Compensation approval workflow":"Compensation proposal submission",...(decision?{"content-type":"application/json"}:{})},...(decision?{body:JSON.stringify({decision:action.decision})}:{})});
  if(response.redirected)return{outcome:"unknown"};const body=await receipt(response);if(controller.signal.aborted||!object(body))return{outcome:"unknown"};
  if([400,401,403,404,409,422,429].includes(response.status)&&typeof body.error==="string"&&body.error.trim()&&body.error.length<=2000&&body.data===undefined)return{outcome:"rejected",status:response.status};
  if(response.status===200&&body.error===undefined&&object(body.data)&&matches(action,body.data))return{outcome:"saved",id:body.data.id as string,status:body.data.status as "APPROVAL"|"APPROVED"|"REJECTED"|"APPLIED"};
  return{outcome:"unknown"};
 }catch{return{outcome:"unknown"};}finally{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
}
export function compensationActionMessage(result:CompensationActionResult,locale:"en"|"tr"){
 const tr=locale==="tr";if(result.outcome==="saved")return tr?"Ücret işlemi sunucu yanıtıyla doğrulandı.":"The compensation action was confirmed by the server response.";
 if(result.outcome==="unknown")return tr?"İşlemin sonucu doğrulanamadı; kaydedilmiş olabilir. Otomatik tekrar yapılmadı. Yenileyip güncel kaydı kontrol edin.":"The outcome could not be confirmed; it may have been saved. No automatic retry was made. Reload and check the current record.";
 if(result.status===401)return tr?"Oturum doğrulanamadı. Yeniden giriş yapın.":"Your session could not be verified. Sign in again.";
 if(result.status===403)return tr?"Bu ücret işlemi için yetkiniz yok.":"You are not authorized for this compensation action.";
 if(result.status===404)return tr?"Ücret değişikliği artık kullanılamıyor.":"The compensation change is no longer available.";
 if(result.status===409)return tr?"Ücret değişikliği durumu veya salary baseline güncellendi. Yenileyip kontrol edin.":"The compensation state or salary baseline changed. Reload and review it.";
 if(result.status===429)return tr?"Çok fazla istek gönderildi; otomatik tekrar yapılmadı.":"Too many requests; no automatic retry was made.";
 return tr?"Ücret işlemi kabul edilmedi.":"The compensation action was not accepted.";
}
export async function acknowledgeCompensationNotification(changeId:string,options:{fetchImpl?:typeof fetch;timeoutMs?:number}={}){
 const timeoutMs=options.timeoutMs??5000;if(!id(changeId)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)return false;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await(options.fetchImpl??fetch)("/api/notifications",{method:"PATCH",credentials:"same-origin",redirect:"error",cache:"no-store",signal:controller.signal,headers:{Accept:"application/json","content-type":"application/json"},body:JSON.stringify({resourceType:"CompensationChange",resourceId:changeId,read:true})});if(response.redirected)return false;const body=await receipt(response);return !controller.signal.aborted&&response.status===200&&object(body)&&body.error===undefined&&object(body.data)&&Number.isSafeInteger(body.data.updated)&&Number.isSafeInteger(body.data.unreadCount);}catch{return false;}finally{clearTimeout(timer);}
}
