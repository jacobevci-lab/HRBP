"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ReceiptText } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgePayrollNotification, payrollActionMessage, submitPayrollTransition, type PayrollActionResult } from "@/lib/payroll-client-action";
import type { ActionCenterPayrollTarget } from "@/lib/action-center-payroll-control";

export type PayrollActionRegistry=Map<string,PayrollActionResult>;
type Props={runId:string;target:ActionCenterPayrollTarget;attemptRegistry?:PayrollActionRegistry;disabled?:boolean};

export function PayrollActionCenterButton(props:Props){return <Control key={props.runId} {...props}/>;}

function Control({runId,target,attemptRegistry,disabled=false}:Props){
 const router=useRouter(),{locale}=useLocale(),c=(en:string,tr:string)=>locale==="tr"?tr:en;
 const[result,setResult]=useState<PayrollActionResult|null>(attemptRegistry?.get(runId)??null);
 const[busy,setBusy]=useState(false),[reloading,setReloading]=useState(false);
 const locked=useRef(false),reloadLock=useRef(false),mounted=useRef(true),controller=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function run(){
  if(disabled||locked.current||attemptRegistry?.has(runId))return;locked.current=true;
  const prompt=target==="APPROVED"?c("Approve this payroll run?","Bu bordro çalıştırması onaylansın mı?"):c("Mark this approved payroll run as paid?","Bu onaylı bordro çalıştırması ödendi olarak işaretlensin mi?");
  if(!window.confirm(prompt)){locked.current=false;return;}
  attemptRegistry?.set(runId,{outcome:"unknown"});setBusy(true);controller.current=new AbortController();
  let outcome:PayrollActionResult;
  try{outcome=await submitPayrollTransition(runId,target,{signal:controller.current.signal});}catch{outcome={outcome:"unknown"};}
  if(!mounted.current)return;
  attemptRegistry?.set(runId,outcome);setBusy(false);setResult(outcome);
  if(outcome.outcome!=="saved")return;
  void acknowledgePayrollNotification(runId).then(ok=>{if(ok&&mounted.current)window.dispatchEvent(new Event("hrbp:notifications-changed"));}).catch(()=>{});
  try{window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));router.refresh();}catch{}
 }
 const message=result?payrollActionMessage(result,locale):"";
 return <div data-payroll-action-id={runId} style={{display:"grid",gap:5,maxWidth:280}}>
  {!result?<button type="button" className="secondary-button" data-payroll-action={target} disabled={disabled||busy} onClick={()=>void run()}>{target==="APPROVED"?<Check size={14}/>:<ReceiptText size={14}/>} {busy?c("Saving…","Kaydediliyor…"):target==="APPROVED"?c("Approve payroll","Bordroyu onayla"):c("Mark paid","Ödendi işaretle")}</button>:<><small role={result.outcome==="saved"?"status":"alert"} data-payroll-action-result={result.outcome}>{message}</small><small>{c("Reloading does not replay the action.","Yenileme işlemi tekrar göndermez.")}</small><button type="button" className="secondary-button" data-payroll-action-reload disabled={reloading} onClick={()=>{if(reloadLock.current)return;reloadLock.current=true;setReloading(true);try{window.location.reload();}catch{reloadLock.current=false;setReloading(false);}}}>{c("Reload and review","Yenile ve kontrol et")}</button></>}
 </div>;
}
