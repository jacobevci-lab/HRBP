"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeTimeNotification, submitTimeAction, timeActionMessage, type TimeActionResult } from "@/lib/time-client-action";
type Decision = "APPROVED" | "REJECTED";
export type TimeDecisionRegistry = Map<string, TimeActionResult>;
type Props = { entryId:string; allowedDecisions?:readonly Decision[]; attemptRegistry?:TimeDecisionRegistry; disabled?:boolean };
export function TimeDecisionButtons(props:Props){ return <TimeDecisionControl key={props.entryId} {...props}/>; }
function TimeDecisionControl({entryId,allowedDecisions=["APPROVED","REJECTED"],attemptRegistry,disabled=false}:Props){
 const router=useRouter(); const {locale}=useLocale(); const c=(en:string,tr:string)=>locale==="tr"?tr:en;
 const [busy,setBusy]=useState<Decision|null>(null); const [result,setResult]=useState<TimeActionResult|null>(attemptRegistry?.get(entryId)??null);
 const [reloading,setReloading]=useState(false); const locked=useRef(false); const reloadLock=useRef(false); const mounted=useRef(true); const controller=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function decide(decision:Decision){
  if(disabled||locked.current||attemptRegistry?.has(entryId)||!allowedDecisions.includes(decision))return;
  locked.current=true;
  const confirmed=window.confirm(decision==="APPROVED"?c("Approve this time entry? The decision will be recorded.","Bu zaman kaydı onaylansın mı? Karar kayda alınacak."):c("Reject this time entry? The decision will be recorded.","Bu zaman kaydı reddedilsin mi? Karar kayda alınacak."));
  if(!confirmed){locked.current=false;return;}
  attemptRegistry?.set(entryId,{outcome:"unknown"}); setBusy(decision); controller.current=new AbortController();
  let outcome:TimeActionResult; try{outcome=await submitTimeAction({kind:"transition",entryId,status:decision},{signal:controller.current.signal});}catch{outcome={outcome:"unknown"};}
  if(!mounted.current)return; attemptRegistry?.set(entryId,outcome); setBusy(null); setResult(outcome); if(outcome.outcome!=="saved")return;
  void acknowledgeTimeNotification(entryId).then(ok=>{if(ok&&mounted.current)window.dispatchEvent(new Event("hrbp:notifications-changed"));}).catch(()=>{});
  try{window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));router.refresh();}catch{}
 }
 const message=result?timeActionMessage(result,locale):"";
 return <div data-time-decision-id={entryId} style={{display:"grid",gap:5,maxWidth:270}} aria-busy={busy!==null}>
  {!result?<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
   {allowedDecisions.includes("APPROVED")?<button type="button" className="secondary-button" data-time-decision="APPROVED" disabled={disabled||busy!==null} onClick={()=>void decide("APPROVED")}><Check size={14}/>{busy==="APPROVED"?c("Saving…","Kaydediliyor…"):c("Approve","Onayla")}</button>:null}
   {allowedDecisions.includes("REJECTED")?<button type="button" className="secondary-button" data-time-decision="REJECTED" disabled={disabled||busy!==null} onClick={()=>void decide("REJECTED")}><X size={14}/>{busy==="REJECTED"?c("Saving…","Kaydediliyor…"):c("Reject","Reddet")}</button>:null}
  </div>:<><small role={result.outcome==="saved"?"status":"alert"} data-time-decision-result={result.outcome}>{message}</small><small>{c("Reloading does not replay the decision.","Yenileme kararı tekrar göndermez.")}</small><button type="button" className="secondary-button" data-time-decision-reload disabled={reloading} onClick={()=>{if(reloadLock.current)return;reloadLock.current=true;setReloading(true);try{window.location.reload();}catch{reloadLock.current=false;setReloading(false);}}}>{c("Reload and review","Yenile ve kontrol et")}</button></>}
 </div>;
}
