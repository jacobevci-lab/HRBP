"use client";

import { Check, LoaderCircle, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function CompensationDecisionButtons({ changeId, status }: { changeId: string; status: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  async function decide(decision: "APPROVE" | "REJECT" | "APPLY") {
    setLoading(decision);
    setError(null);
    try {
      const response = await fetch(`/api/compensation/changes/${encodeURIComponent(changeId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Compensation approval workflow" },
        body: JSON.stringify({ decision })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || c("Compensation decision could not be completed.","Ücretlendirme kararı tamamlanamadı."));
        return;
      }
      router.refresh();
    } catch {
      setError(c("The request could not reach HRBP.","İstek HRBP'ye ulaştırılamadı."));
    } finally {
      setLoading(null);
    }
  }

  return <div className="comp-decision-wrap">
    {status === "APPROVAL" ? <div className="comp-decision-buttons"><button type="button" className="mini-action approve" onClick={() => decide("APPROVE")} disabled={!!loading}>{loading === "APPROVE" ? <LoaderCircle size={13}/> : <Check size={13}/>} {c("Approve","Onayla")}</button><button type="button" className="mini-action reject" onClick={() => decide("REJECT")} disabled={!!loading}>{loading === "REJECT" ? <LoaderCircle size={13}/> : <X size={13}/>} {c("Reject","Reddet")}</button></div> : null}
    {status === "APPROVED" ? <button type="button" className="mini-action apply" onClick={() => decide("APPLY")} disabled={!!loading}>{loading === "APPLY" ? <LoaderCircle size={13}/> : <Play size={13}/>} {c("Apply","Uygula")}</button> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
