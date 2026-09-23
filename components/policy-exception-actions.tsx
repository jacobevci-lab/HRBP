"use client";

import { Check, LoaderCircle, Send, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function PolicyExceptionRequest({ policyId }: { policyId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [control, setControl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) return setError(c("Reason is required.", "Gerekçe zorunludur."));
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/exceptions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Policy exception request" },
        body: JSON.stringify({ reason: reason.trim(), compensatingControl: control.trim() || undefined, expiresAt: expiresAt || null })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) return setError(value.error || c("Exception request failed.", "İstisna talebi başarısız oldu."));
      setReason(""); setControl(""); setExpiresAt(""); setOpen(false);
      setMessage(c("Exception request submitted for independent review.", "İstisna talebi bağımsız incelemeye gönderildi."));
      router.refresh();
    } catch { setError(c("Policy service could not be reached.", "Politika servisine ulaşılamadı.")); }
    finally { setBusy(false); }
  }

  return <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}><ShieldAlert size={12}/> {c("Request exception", "İstisna talep et")}</button>
    {open ? <div className="card" style={{ padding: 9, display: "grid", gap: 6, minWidth: 230 }}><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={c("Business reason", "İş gerekçesi")}/><textarea value={control} onChange={(event) => setControl(event.target.value)} placeholder={c("Compensating control (optional)", "Telafi edici kontrol (opsiyonel)")}/><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)}/><button type="button" className="secondary-button" disabled={busy} onClick={() => void submit()}>{busy ? <LoaderCircle size={12}/> : <Send size={12}/>} {c("Submit", "Gönder")}</button></div> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}{message ? <small>{message}</small> : null}
  </div>;
}

export function PolicyExceptionDecisionButtons({ policyId, exceptionId, requestedById, actorId }: { policyId: string; exceptionId: string; requestedById: string; actorId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (requestedById === actorId) return <span className="matrix-note">{c("Requester cannot approve", "Talep sahibi onaylayamaz")}</span>;

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(decision); setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/exceptions/${encodeURIComponent(exceptionId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Policy exception independent decision" },
        body: JSON.stringify({ decision })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) return setError(value.error || c("Exception decision failed.", "İstisna kararı başarısız oldu."));
      router.refresh();
    } catch { setError(c("Policy service could not be reached.", "Politika servisine ulaşılamadı.")); }
    finally { setBusy(null); }
  }

  return <div style={{ display: "grid", gap: 4 }}><div style={{ display: "flex", gap: 5 }}><button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void decide("APPROVE")}>{busy === "APPROVE" ? <LoaderCircle size={12}/> : <Check size={12}/>} {c("Approve", "Onayla")}</button><button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void decide("REJECT")}>{busy === "REJECT" ? <LoaderCircle size={12}/> : <X size={12}/>} {c("Reject", "Reddet")}</button></div>{error ? <small className="comp-decision-error">{error}</small> : null}</div>;
}
