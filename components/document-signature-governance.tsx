"use client";

import { BadgeCheck, FileSignature, LoaderCircle, Plus, Send, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type SignatureParticipant = {
  id: string;
  employmentId: string | null;
  email: string | null;
  signingOrder: number;
  status: string;
  viewedAt: string | null;
  signedAt: string | null;
};

type SignatureEvent = {
  id: string;
  eventType: string;
  actorId: string | null;
  occurredAt: string;
};

type SignatureEnvelope = {
  id: string;
  title: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
  documentVersion: null | {
    id: string;
    version: number;
    scanStatus: string;
    uploadedAt: string | null;
  };
  participants: SignatureParticipant[];
  events: SignatureEvent[];
};

type SignerDraft = {
  key: string;
  type: "EMPLOYMENT" | "EMAIL";
  value: string;
};

type Props = {
  documentId: string;
  canSign: boolean;
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function signerKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DocumentSignatureGovernance({ documentId, canSign }: Props) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const search = useSearchParams();
  const focusedEnvelopeId = search.get("envelope")?.trim().slice(0, 128) || "";
  const focusApplies = Boolean(focusedEnvelopeId && search.get("document") === documentId);
  const [open, setOpen] = useState(focusApplies);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<SignatureEnvelope[]>([]);
  const [title, setTitle] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [signers, setSigners] = useState<SignerDraft[]>([{ key: signerKey(), type: "EMPLOYMENT", value: "" }]);
  const focusRef = useRef<HTMLElement | null>(null);

  const focusedVisible = useMemo(() => !focusApplies || envelopes.some((item) => item.id === focusedEnvelopeId), [envelopes, focusApplies, focusedEnvelopeId]);

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/signatures`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { error?: string; data?: SignatureEnvelope[] };
      if (!response.ok) throw new Error(body.error || c("Signature evidence could not be loaded.", "İmza kanıtı yüklenemedi."));
      setEnvelopes(body.data ?? []);
      setLoaded(true);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Signature evidence could not be loaded.", "İmza kanıtı yüklenemedi."));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (focusApplies && !loaded && busy !== "load") void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusApplies]);

  useEffect(() => {
    if (focusApplies && focusedVisible && loaded) requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focusApplies, focusedVisible, loaded]);

  function updateSigner(key: string, patch: Partial<SignerDraft>) {
    setSigners((current) => current.map((signer) => signer.key === key ? { ...signer, ...patch } : signer));
  }

  function removeSigner(key: string) {
    setSigners((current) => current.length === 1 ? current : current.filter((signer) => signer.key !== key));
  }

  async function sendEnvelope() {
    if (!canSign) return;
    const normalized = signers.map((signer, index) => ({
      ...(signer.type === "EMPLOYMENT" ? { employmentId: signer.value.trim() } : { email: signer.value.trim() }),
      signingOrder: index + 1
    }));
    if (!title.trim() || normalized.some((signer) => !("employmentId" in signer ? signer.employmentId : signer.email))) {
      setError(c("Envelope title and every signer identity are required.", "Envelope başlığı ve her imzalayanın kimliği zorunludur."));
      return;
    }
    setBusy("send");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/signatures`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Governed document signature request" },
        body: JSON.stringify({ title: title.trim(), expiresAt: expiresAt || undefined, participants: normalized })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Signature envelope could not be sent.", "İmza envelope'u gönderilemedi."));
      setTitle("");
      setExpiresAt("");
      setSigners([{ key: signerKey(), type: "EMPLOYMENT", value: "" }]);
      setMessage(c("Signature envelope sent and pinned to the current CLEAN document version.", "İmza envelope'u gönderildi ve mevcut CLEAN doküman sürümüne sabitlendi."));
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Signature envelope could not be sent.", "İmza envelope'u gönderilemedi."));
    } finally {
      setBusy(null);
    }
  }

  return <div style={{ display: "grid", gap: 7 }}>
    <button type="button" className="secondary-button" onClick={() => open ? setOpen(false) : void (loaded ? setOpen(true) : load())} disabled={busy === "load"}>
      {busy === "load" ? <LoaderCircle size={13}/> : <FileSignature size={13}/>} {c("Signatures", "İmzalar")}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 10, minWidth: 320, maxWidth: 520 }}>
      <div><strong style={{ fontSize: 12 }}>{c("Signature governance", "İmza yönetişimi")}</strong><small className="cell-sub">{c("Every envelope is bound to one immutable CLEAN document version.", "Her envelope değiştirilemez tek bir CLEAN doküman sürümüne bağlıdır.")}</small></div>
      {focusApplies && loaded && !focusedVisible ? <small className="comp-decision-error">{c("The requested envelope is not available inside this governed document scope. No broader lookup was attempted.", "İstenen envelope bu yönetişimli doküman kapsamında kullanılamıyor. Daha geniş sorgu denenmedi.")}</small> : null}
      {canSign ? <details open={envelopes.length === 0}>
        <summary style={{ cursor: "pointer", fontSize: 12 }}><Send size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>{c("Send signature envelope", "İmza envelope'u gönder")}</summary>
        <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
          <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={c("Envelope title", "Envelope başlığı")}/>
          <label style={{ display: "grid", gap: 4, fontSize: 11 }}><span>{c("Expiry (optional)", "Son tarih (opsiyonel)")}</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)}/></label>
          <div style={{ display: "grid", gap: 6 }}>
            {signers.map((signer, index) => <div key={signer.key} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 6 }}>
              <select value={signer.type} onChange={(event) => updateSigner(signer.key, { type: event.target.value as SignerDraft["type"], value: "" })}><option value="EMPLOYMENT">EMPLOYMENT</option><option value="EMAIL">EMAIL</option></select>
              <input value={signer.value} onChange={(event) => updateSigner(signer.key, { value: event.target.value })} placeholder={signer.type === "EMPLOYMENT" ? c("Employment ID", "İstihdam ID") : c("Email address", "E-posta adresi")}/>
              <button type="button" className="icon-button" title={c("Remove signer", "İmzalayanı kaldır")} disabled={signers.length === 1} onClick={() => removeSigner(signer.key)}>×</button>
              <small style={{ gridColumn: "1 / -1" }}>{c(`Signing order ${index + 1}`, `İmza sırası ${index + 1}`)}</small>
            </div>)}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" className="secondary-button" onClick={() => setSigners((current) => current.length >= 50 ? current : [...current, { key: signerKey(), type: "EMPLOYMENT", value: "" }])} disabled={signers.length >= 50}><Plus size={12}/> {c("Add signer", "İmzalayan ekle")}</button><button type="button" className="secondary-button" onClick={() => void sendEnvelope()} disabled={busy === "send"}>{busy === "send" ? <LoaderCircle size={12}/> : <Send size={12}/>} {c("Send", "Gönder")}</button></div>
        </div>
      </details> : null}
      <div style={{ display: "grid", gap: 7 }}>
        {envelopes.length ? envelopes.map((envelope) => {
          const focused = focusApplies && envelope.id === focusedEnvelopeId;
          return <article key={envelope.id} id={`signature-envelope-${envelope.id}`} ref={focused ? (node) => { focusRef.current = node; } : undefined} className={focused ? "focused" : undefined} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 9, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{envelope.title}</strong><em className={`growth-pill ${envelope.status.toLowerCase().replaceAll("_", "-")}`}>{envelope.status}</em></div>
            <small>{c("Version", "Sürüm")}: {envelope.documentVersion ? `v${envelope.documentVersion.version} · ${envelope.documentVersion.scanStatus}` : c("historical envelope", "tarihsel envelope")} · {c("Expires", "Son tarih")}: {dateTime(envelope.expiresAt)}</small>
            <div style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600 }}><UsersRound size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>{c("Signers", "İmzalayanlar")}</span>{envelope.participants.map((participant) => <small key={participant.id}>#{participant.signingOrder} · {participant.employmentId ? `EMPLOYMENT:${participant.employmentId}` : participant.email} · {participant.status}{participant.signedAt ? ` · ${dateTime(participant.signedAt)}` : participant.viewedAt ? ` · ${c("viewed", "görüldü")} ${dateTime(participant.viewedAt)}` : ""}</small>)}</div>
            <details><summary style={{ cursor: "pointer", fontSize: 11 }}><BadgeCheck size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>{c("Evidence timeline", "Kanıt zaman çizelgesi")} ({envelope.events.length})</summary><div style={{ display: "grid", gap: 3, marginTop: 5 }}>{envelope.events.map((event) => <small key={event.id}>{event.eventType} · {dateTime(event.occurredAt)}{event.actorId ? ` · ${event.actorId}` : ""}</small>)}</div></details>
          </article>;
        }) : <small>{c("No signature envelopes for this document.", "Bu doküman için imza envelope'u yok.")}</small>}
      </div>
      {error ? <small className="comp-decision-error">{error}</small> : null}{message ? <small>{message}</small> : null}
    </div> : null}
  </div>;
}
