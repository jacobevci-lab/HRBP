"use client";

import { Check, LoaderCircle, RotateCcw, Send, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function PolicyReviewActions({
  policyId,
  status,
  ownerId,
  actorId,
  canWrite,
  canApprove
}: {
  policyId: string;
  status: string;
  ownerId: string;
  actorId: string;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const isOwner = ownerId === actorId;

  async function review(action: "SUBMIT" | "APPROVE" | "REQUEST_CHANGES") {
    setLoading(action);
    setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Policy governance review" },
        body: JSON.stringify({ action })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) return setError(value.error || c("Policy review action failed.", "Politika inceleme aksiyonu başarısız."));
      router.refresh();
    } catch {
      setError(c("The policy service could not be reached.", "Politika servisine ulaşılamadı."));
    } finally {
      setLoading(null);
    }
  }

  async function publish() {
    setLoading("PUBLISH");
    setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/publish`, {
        method: "POST",
        headers: { "x-purpose": "Policy publication" }
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) return setError(value.error || c("Policy publication failed.", "Politika yayını başarısız."));
      router.refresh();
    } catch {
      setError(c("The policy service could not be reached.", "Politika servisine ulaşılamadı."));
    } finally {
      setLoading(null);
    }
  }

  return <div className="comp-decision-wrap">
    <div className="comp-decision-buttons">
      {status === "DRAFT" && canWrite ? <button type="button" className="mini-action apply" disabled={!!loading} onClick={() => review("SUBMIT")}>{loading === "SUBMIT" ? <LoaderCircle size={13}/> : <Send size={13}/>} {c("Submit","İncelemeye gönder")}</button> : null}
      {status === "REVIEW" && canApprove && !isOwner ? <button type="button" className="mini-action approve" disabled={!!loading} onClick={() => review("APPROVE")}>{loading === "APPROVE" ? <LoaderCircle size={13}/> : <Check size={13}/>} {c("Approve","Onayla")}</button> : null}
      {(status === "REVIEW" || status === "APPROVED") && canApprove ? <button type="button" className="mini-action reject" disabled={!!loading} onClick={() => review("REQUEST_CHANGES")}>{loading === "REQUEST_CHANGES" ? <LoaderCircle size={13}/> : <RotateCcw size={13}/>} {c("Changes","Düzeltme iste")}</button> : null}
      {status === "APPROVED" && canWrite ? <button type="button" className="mini-action apply" disabled={!!loading} onClick={publish}>{loading === "PUBLISH" ? <LoaderCircle size={13}/> : <Upload size={13}/>} {c("Publish","Yayınla")}</button> : null}
    </div>
    {status === "REVIEW" && canApprove && isOwner ? <small className="comp-decision-error">{c("Four-eyes: the policy owner cannot approve this version.","Dört göz: politika sahibi bu sürümü onaylayamaz.")}</small> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
