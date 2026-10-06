"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgePayrollNotification, payrollActionMessage, submitPayrollTransition, type PayrollStatus } from "@/lib/payroll-client-action";
type PayrollAccess={prepare:boolean;approve:boolean;pay:boolean};
const primaryNext:Partial<Record<PayrollStatus,PayrollStatus>>={DRAFT:"VALIDATING",VALIDATING:"CALCULATED",CALCULATED:"APPROVAL",EXCEPTION:"VALIDATING",APPROVAL:"APPROVED",APPROVED:"PAID"};
function allowed(status:PayrollStatus,access:PayrollAccess){if(status==="APPROVAL")return access.approve;if(status==="APPROVED")return access.pay;if(["DRAFT","EXCEPTION","VALIDATING","CALCULATED"].includes(status))return access.prepare;return false;}
function label(status:PayrollStatus,locale:"en"|"tr"){const tr=locale==="tr";if(status==="DRAFT"||status==="EXCEPTION")return tr?"Kilitle ve doğrula":"Lock & validate";if(status==="VALIDATING")return tr?"Hesaplamayı doğrula":"Confirm calculation";if(status==="CALCULATED")return tr?"Onaya yönlendir":"Route approval";if(status==="APPROVAL")return tr?"Bordroyu onayla":"Approve payroll";if(status==="APPROVED")return tr?"Ödendi işaretle":"Mark paid";return tr?"Devam et":"Continue";}
export function PayrollTransitionButton({runId,status,access}:{runId:string;status:PayrollStatus;access:PayrollAccess}){
 const router=useRouter(),{locale}=useLocale(),lock=useRef(false);const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);const next=primaryNext[status];if(!next||!allowed(status,access))return null;
 async function transition(){if(lock.current||uncertain)return;const prompt=locale==="tr"?"Bordro "+label(status,locale)+" adımına geçirilsin mi?":"Continue payroll with "+label(status,locale)+"?";if(!window.confirm(prompt))return;lock.current=true;setBusy(true);setError(null);
  try{const result=await submitPayrollTransition(runId,next!);if(result.outcome==="saved"){if(next==="APPROVED"||next==="PAID")await acknowledgePayrollNotification(runId);window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));window.dispatchEvent(new Event("hrbp:notifications-changed"));router.refresh();return;}setError(payrollActionMessage(result,locale));if(result.outcome==="unknown")setUncertain(true);}
  finally{lock.current=false;setBusy(false);}
 }
 return <div style={{display:"grid",gap:5}}><button className="secondary-button" disabled={busy||uncertain} onClick={()=>void transition()}>{busy?(locale==="tr"?"Kaydediliyor…":"Saving…"):label(status,locale)} <ArrowRight size={14}/></button>{error?<small style={{color:"#b42318",maxWidth:260,display:"flex",gap:5,alignItems:"flex-start"}}><ShieldAlert size={13} style={{flex:"0 0 auto",marginTop:2}}/>{error}</small>:null}{uncertain?<button type="button" className="secondary-button" onClick={()=>window.location.reload()}>{locale==="tr"?"Yenile ve kontrol et":"Reload and review"}</button>:null}</div>;
}
