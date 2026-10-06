"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeCompensationNotification, compensationActionMessage, submitCompensationAction, type CompensationActionResult, type CompensationDecision } from "@/lib/compensation-client-action";

type Action="APPROVE"|"REJECT"|"APPLY";
export type CompensationActionRegistry=Map<string,CompensationActionResult>;
type Props={changeId:string;allowedActions:readonly Action[];attemptRegistry?:CompensationActionRegistry;disabled?:boolean};

export function CompensationActionCenterButtons(props:Props){return <Control key={props.changeId} {...props}/>;}

function Control({changeId,allowedActions,attemptRegistry,disabled=false}:Props){
 const router=useRouter(),{locale}=useLocale(),c=(en:string,tr:string)=>locale==="tr"?tr:en;
 const[result,setResult]=useState<CompensationActionResult|null>(attemptRegistry?.get(changeId)??null);
 const[busy,setBusy]=useState<Action|null>(null),[reloading,setReloading]=useState(false);
 const locked=useRef(false),reloadLock=useRef(false),mounted=useRef(true),controller=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function decide(action:Action){
  if(disabled||locked.current||attemptRegistry?.has(changeId)||!allowedActions.includes(action))return;
  locked.current=true;
  const text=action==="APPROVE"?c("Approve this compensation change?","Bu ücret değişikliği onaylansın mı?"):action==="REJECT"?c("Reject this compensation change?","Bu ücret değişikliği reddedilsin mi?"):c("Apply this approved compensation change and hand it to payroll?","Onaylı ücret değişikliği uygulanıp bordroya devredilsin mi?");
  if(!window.confirm(text)){locked.current=false;return;}
  attemptRegistry?.set(changeId,{outcome:"unknown"});setBusy(action);controller.current=new AbortController();
  let outcome:CompensationActionResult;
  try{outcome=await submitCompensationAction({kind:"decision",changeId,decision:action as CompensationDecision},{signal:controller.current.signal});}catch{outcome={outcome:"unknown"};}
  if(!mounted.current)return;
  attemptRegistry?.set(changeId,outcome);setBusy(null);setResult(outcome);
  if(outcome.outcome!=="saved")return;
  void acknowledgeCompensationNotification(changeId).then(ok=>{if(ok&&mounted.current)window.dispatchEvent(new Event("hrbp:notifications-changed"));}).catch(()=>{});
  try{window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));router.refresh();}catch{}
 }
 const message=result?compensationActionMessage(result,locale):"";
 return <div data-compensation-action-id={changeId} style={{display:"grid",gap:5,maxWidth:280}}>
  {!result?<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
   {allowedActions.includes("APPROVE")?<button type="button" className="secondary-button" data-compensation-action="APPROVE" disabled={disabled||busy!==null} onClick={()=>void decide("APPROVE")}><Check size={14}/>{busy==="APPROVE"?c("Saving…","Kaydediliyor…"):c("Approve","Onayla")}</button>:null}
   {allowedActions.includes("REJECT")?<button type="button" className="secondary-button" data-compensation-action="REJECT" disabled={disabled||busy!==null} onClick={()=>void decide("REJECT")}><X size={14}/>{busy==="REJECT"?c("Saving…","Kaydediliyor…"):c("Reject","Reddet")}</button>:null}
   {allowedActions.includes("APPLY")?<button type="button" className="secondary-button" data-compensation-action="APPLY" disabled={disabled||busy!==null} onClick={()=>void decide("APPLY")}><Play size={14}/>{busy==="APPLY"?c("Saving…","Kaydediliyor…"):c("Apply","Uygula")}</button>:null}
  </div>:<><small role={result.outcome==="saved"?"status":"alert"} data-compensation-action-result={result.outcome}>{message}</small><small>{c("Reloading does not replay the action.","Yenileme işlemi tekrar göndermez.")}</small><button type="button" className="secondary-button" data-compensation-action-reload disabled={reloading} onClick={()=>{if(reloadLock.current)return;reloadLock.current=true;setReloading(true);try{window.location.reload();}catch{reloadLock.current=false;setReloading(false);}}}>{c("Reload and review","Yenile ve kontrol et")}</button></>}
 </div>;
}
