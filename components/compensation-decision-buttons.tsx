"use client";

import { ArrowRight, Check, LoaderCircle, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function CompensationDecisionButtons({
  changeId,
  status,
  canSubmit,
  canApprove,
  canApply,
  isRequester
}: {
  changeId: string;
  status: string;
  canSubmit: boolean;
  canApprove: boolean;
  canApply: boolean;
  isRequester: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  async function submit() {
    setLoading("SUBMIT");
    setError(null);
    try {
      const response = await fetch(`/api/compensation/changes/${encodeURIComponent(changeId)}/submit`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-purpose": "Compensation proposal submission" }
      });
      const value = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(value.error || c("Compensation draft could not be submitted.", "Ücret değişikliği taslağı onaya gönderilemedi."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Compensation draft could not be submitted.", "Ücret değişikliği taslağı onaya gönderilemedi."));
    } finally {
      setLoading(null);
    }
  }

  async function decide(decision: "APPROVE" | "REJECT" | "APPLY") {
    setLoading(decision);
    setError(null);
    try {
      const response = await fetch(`/api/compensation/changes/${encodeURIComponent(changeId)}/decision`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-purpose": "Compensation approval workflow" },
        body: JSON.stringify({ decision })
      });
      const value = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(value.error || c("Compensation decision could not be completed.", "Ücretlendirme kararı tamamlanamadı."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("The request could not reach HRBP.", "İstek HRBP'ye ulaştırılamadı."));
    } finally {
      setLoading(null);
    }
  }

  const showSubmit = status === "DRAFT" && canSubmit && isRequester;
  const showApproval = status === "APPROVAL" && canApprove && !isRequester;
  const showApply = status === "APPROVED" && canApply && !isRequester;
  const waiting = (status === "APPROVAL" && isRequester) || (status === "APPROVED" && isRequester);

  if (!showSubmit && !showApproval && !showApply && !waiting) return <span style={{ color: "var(--muted)" }}>—</span>;

  return <div className="comp-decision-wrap">
    {showSubmit ? <button type="button" className="mini-action apply" onClick={() => void submit()} disabled={!!loading}>{loading === "SUBMIT" ? <LoaderCircle size={13}/> : <ArrowRight size={13}/>} {c("Submit", "Onaya gönder")}</button> : null}
    {showApproval ? <div className="comp-decision-buttons"><button type="button" className="mini-action approve" onClick={() => void decide("APPROVE")} disabled={!!loading}>{loading === "APPROVE" ? <LoaderCircle size={13}/> : <Check size={13}/>} {c("Approve", "Onayla")}</button><button type="button" className="mini-action reject" onClick={() => void decide("REJECT")} disabled={!!loading}>{loading === "REJECT" ? <LoaderCircle size={13}/> : <X size={13}/>} {c("Reject", "Reddet")}</button></div> : null}
    {showApply ? <button type="button" className="mini-action apply" onClick={() => void decide("APPLY")} disabled={!!loading}>{loading === "APPLY" ? <LoaderCircle size={13}/> : <Play size={13}/>} {c("Apply & hand off", "Uygula ve bordroya devret")}</button> : null}
    {waiting ? <small className="cell-sub">{status === "APPROVAL" ? c("Waiting for an independent approver", "Bağımsız onaylayıcı bekleniyor") : c("Approved; another authorized actor must apply it", "Onaylandı; başka yetkili bir aktör uygulamalı")}</small> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
