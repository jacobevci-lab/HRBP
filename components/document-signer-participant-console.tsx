"use client";

import { CheckCircle2, FileSignature, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import type { DocumentSignerParticipantData } from "@/lib/document-signer-participant-data";

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DocumentSignerParticipantConsole({ data }: { data: DocumentSignerParticipantData }) {
  const { locale } = useLocale();
  const router = useRouter();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<"SIGNED" | "DECLINED" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function decide(decision: "SIGNED" | "DECLINED") {
    if (!data.actionable || busy) return;
    setBusy(decision);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(data.documentId)}/signatures/${encodeURIComponent(data.envelopeId)}/participants/${encodeURIComponent(data.participantId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-purpose": "Human document signature participant decision" },
          body: JSON.stringify({ decision })
        }
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Signature decision could not be recorded.", "İmza kararı kaydedilemedi."));
      setNotice({
        tone: "ok",
        text: decision === "SIGNED"
          ? c("Your signature decision was recorded with audit evidence.", "İmza kararınız denetim kanıtıyla kaydedildi.")
          : c("Your decline decision was recorded and the envelope was voided.", "Reddetme kararınız kaydedildi ve imza envelope'u geçersiz kılındı.")
      });
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Signature decision failed.", "İmza kararı başarısız oldu.") });
    } finally {
      setBusy(null);
    }
  }

  const stateText = data.actionable
    ? c("Your signing order is active. Review the immutable document version before recording your decision.", "İmza sıranız aktif. Kararınızı kaydetmeden önce değiştirilemez doküman sürümünü inceleyin.")
    : data.blockedByEarlierSigner
      ? c("Waiting for earlier signing-order participants.", "Önceki imza sırasındaki katılımcılar bekleniyor.")
      : c("This participant action is no longer available.", "Bu katılımcı aksiyonu artık kullanılamıyor.");

  return <section className="card" style={{ maxWidth: 760, margin: "0 auto", padding: 20, display: "grid", gap: 16 }}>
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div className="enterprise-stat-icon"><FileSignature size={20}/></div>
      <div><div className="eyebrow">HRBP One / {c("Document signing", "Doküman imzalama")}</div><h2 style={{ margin: "4px 0" }}>{data.envelopeTitle}</h2><p style={{ margin: 0 }}>{data.documentName}</p></div>
    </div>
    <div className="enterprise-stats" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
      <div className="enterprise-stat"><div><span>{c("Version", "Sürüm")}</span><strong>v{data.documentVersion}</strong><small>{c("Immutable CLEAN version", "Değiştirilemez CLEAN sürüm")}</small></div></div>
      <div className="enterprise-stat"><div><span>{c("Signing order", "İmza sırası")}</span><strong>#{data.signingOrder}</strong><small>{data.participantStatus}</small></div></div>
      <div className="enterprise-stat"><div><span>{c("Envelope", "Envelope")}</span><strong>{data.envelopeStatus}</strong><small>{c("Human-owned workflow", "İnsan sahipliğinde süreç")}</small></div></div>
      <div className="enterprise-stat"><div><span>{c("Expires", "Son tarih")}</span><strong style={{ fontSize: 13 }}>{dateTime(data.expiresAt)}</strong><small>{c("No automatic signing", "Otomatik imza yok")}</small></div></div>
    </div>
    <div className="module-degraded-banner" style={{ display: "flex", gap: 8, padding: 12 }}><ShieldCheck size={18}/><div><strong>{c("Identity-bound participant action", "Kimliğe bağlı katılımcı aksiyonu")}</strong><p style={{ margin: "3px 0 0" }}>{stateText}</p></div></div>
    {data.actionable ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void decide("SIGNED")}>{busy === "SIGNED" ? <LoaderCircle size={15}/> : <CheckCircle2 size={15}/>} {c("Sign document", "Dokümanı imzala")}</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void decide("DECLINED")}>{busy === "DECLINED" ? <LoaderCircle size={15}/> : <XCircle size={15}/>} {c("Decline", "Reddet")}</button>
    </div> : null}
    {notice ? <small className={notice.tone === "error" ? "comp-decision-error" : undefined}>{notice.text}</small> : null}
  </section>;
}
