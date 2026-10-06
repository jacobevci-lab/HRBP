"use client";
import { ArrowRight, Check, LoaderCircle, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeCompensationNotification, compensationActionMessage, submitCompensationAction, type CompensationDecision } from "@/lib/compensation-client-action";
export function CompensationDecisionButtons({changeId,status,canSubmit,canApprove,canApply,isRequester}:{changeId:string;status:string;canSubmit:boolean;canApprove:boolean;canApply:boolean;isRequester:boolean}){
 const router=useRouter(),{locale}=useLocale(),c=(en:string,tr:string)=>locale==="tr"?tr:en;const lock=useRef(false);const[loading,setLoading]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 async function run(key:string,action:{kind:"submit";changeId:string}|{kind:"decision";changeId:string;decision:CompensationDecision},confirmText:string,ack=false){
  if(lock.current||uncertain)return;if(!window.confirm(confirmText))return;lock.current=true;setLoading(key);setError(null);
  try{const result=await submitCompensationAction(action);if(result.outcome==="saved"){if(ack)await acknowledgeCompensationNotification(changeId);window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));window.dispatchEvent(new Event("hrbp:notifications-changed"));router.refresh();return;}setError(compensationActionMessage(result,locale));if(result.outcome==="unknown")setUncertain(true);}
  finally{lock.current=false;setLoading(null);}
 }
 const showSubmit=status==="DRAFT"&&canSubmit&&isRequester,showApproval=status==="APPROVAL"&&canApprove&&!isRequester,showApply=status==="APPROVED"&&canApply&&!isRequester,waiting=(status==="APPROVAL"&&isRequester)||(status==="APPROVED"&&isRequester);
 if(!showSubmit&&!showApproval&&!showApply&&!waiting)return <span style={{color:"var(--muted)"}}>—</span>;
 return <div className="comp-decision-wrap">
  {showSubmit?<button type="button" className="mini-action apply" onClick={()=>void run("SUBMIT",{kind:"submit",changeId},c("Submit this compensation proposal for independent approval?","Bu ücret değişikliği bağımsız onaya gönderilsin mi?"))} disabled={!!loading||uncertain}>{loading==="SUBMIT"?<LoaderCircle size={13}/>:<ArrowRight size={13}/>} {c("Submit","Onaya gönder")}</button>:null}
  {showApproval?<div className="comp-decision-buttons"><button type="button" className="mini-action approve" onClick={()=>void run("APPROVE",{kind:"decision",changeId,decision:"APPROVE"},c("Approve this compensation change?","Bu ücret değişikliği onaylansın mı?"),true)} disabled={!!loading||uncertain}>{loading==="APPROVE"?<LoaderCircle size={13}/>:<Check size={13}/>} {c("Approve","Onayla")}</button><button type="button" className="mini-action reject" onClick={()=>void run("REJECT",{kind:"decision",changeId,decision:"REJECT"},c("Reject this compensation change?","Bu ücret değişikliği reddedilsin mi?"),true)} disabled={!!loading||uncertain}>{loading==="REJECT"?<LoaderCircle size={13}/>:<X size={13}/>} {c("Reject","Reddet")}</button></div>:null}
  {showApply?<button type="button" className="mini-action apply" onClick={()=>void run("APPLY",{kind:"decision",changeId,decision:"APPLY"},c("Apply the approved compensation change and hand it off to payroll?","Onaylı ücret değişikliği uygulanıp bordroya devredilsin mi?"),true)} disabled={!!loading||uncertain}>{loading==="APPLY"?<LoaderCircle size={13}/>:<Play size={13}/>} {c("Apply & hand off","Uygula ve bordroya devret")}</button>:null}
  {waiting?<small className="cell-sub">{status==="APPROVAL"?c("Waiting for an independent approver","Bağımsız onaylayıcı bekleniyor"):c("Approved; another authorized actor must apply it","Onaylandı; başka yetkili bir aktör uygulamalı")}</small>:null}
  {error?<small className="comp-decision-error">{error}</small>:null}
  {uncertain?<button type="button" className="secondary-button" onClick={()=>window.location.reload()}>{c("Reload and review","Yenile ve kontrol et")}</button>:null}
 </div>;
}
