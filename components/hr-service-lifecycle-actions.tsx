"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const transitions: Record<string, string[]> = {
  OPEN: ["TRIAGE", "CANCELLED"],
  TRIAGE: ["IN_PROGRESS", "WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELLED"],
  WAITING_EMPLOYEE: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  WAITING_THIRD_PARTY: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
  CANCELLED: []
};

const reasonRequired = new Set(["WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CLOSED", "CANCELLED"]);

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function label(locale: Locale, value: string) {
  const normalized = value.toUpperCase();
  if (locale !== "tr") return normalized.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  const map: Record<string, string> = {
    OPEN: "Açık", TRIAGE: "Triyaj", IN_PROGRESS: "Devam ediyor", WAITING_EMPLOYEE: "Çalışan bekleniyor",
    WAITING_THIRD_PARTY: "Üçüncü taraf bekleniyor", RESOLVED: "Çözüldü", CLOSED: "Kapalı", CANCELLED: "İptal edildi"
  };
  return map[normalized] ?? normalized;
}

async function acknowledgeRequestNotifications(requestId: string) {
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceType: "HRServiceRequest", resourceId: requestId, read: true })
    });
    if (response.ok) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch {
    // Notification acknowledgement is best-effort. A successful governed HR
    // Service mutation must never be rolled back because badge cleanup failed.
  }
}

export function HRServiceLifecycleActions({ requestId, status, locale, staff }: { requestId: string; status: string; locale: Locale; staff: boolean }) {
  const router = useRouter();
  const options = transitions[status] ?? [];
  const [target, setTarget] = useState(options[0] ?? "");
  const [reason, setReason] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function transition() {
    if (!target) return;
    const needsReason = reasonRequired.has(target) || (status === "RESOLVED" && target === "IN_PROGRESS");
    if (needsReason && reason.trim().length < 10) {
      setMessage(c(locale, "A reason of at least 10 characters is required.", "En az 10 karakterlik gerekçe gereklidir."));
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/hr-service/requests/${encodeURIComponent(requestId)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target, ...(reason.trim() ? { reason: reason.trim() } : {}) })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Request update failed.");
      setReason("");
      setMessage(c(locale, "Lifecycle transition recorded.", "Yaşam döngüsü geçişi kaydedildi."));
      await acknowledgeRequestNotifications(requestId);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c(locale, "Request update failed.", "Talep güncellenemedi."));
    } finally { setBusy(false); }
  }

  async function addComment(visibility: "REQUESTOR" | "PRIVATE_NOTE") {
    if (!reply.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/hr-service/requests/${encodeURIComponent(requestId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: reply.trim(), visibility })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Reply could not be added.");
      setReply("");
      setMessage(visibility === "PRIVATE_NOTE" ? c(locale, "Private HR note recorded.", "Özel İK notu kaydedildi.") : c(locale, "Reply recorded.", "Yanıt kaydedildi."));
      await acknowledgeRequestNotifications(requestId);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c(locale, "Reply could not be added.", "Yanıt eklenemedi."));
    } finally { setBusy(false); }
  }

  return <details style={{ minWidth: 260 }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>{c(locale, "Actions", "Aksiyonlar")}</summary>
    <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
      {staff && options.length ? <>
        <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>
          {options.map((option) => <option key={option} value={option}>{label(locale, option)}</option>)}
        </select>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={2000} rows={2} placeholder={c(locale, "Reason for governed transition", "Yönetişimli geçiş gerekçesi")}/>
        <button type="button" onClick={transition} disabled={busy || !target}>{busy ? c(locale, "Saving…", "Kaydediliyor…") : c(locale, "Apply transition", "Geçişi uygula")}</button>
      </> : null}
      <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} rows={2} placeholder={staff ? c(locale, "Reply or internal handling note", "Yanıt veya iç işlem notu") : c(locale, "Add a reply", "Yanıt ekle")}/>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button type="button" onClick={() => addComment("REQUESTOR")} disabled={busy || !reply.trim()}>{c(locale, "Add reply", "Yanıt ekle")}</button>
        {staff ? <button type="button" onClick={() => addComment("PRIVATE_NOTE")} disabled={busy || !reply.trim()}>{c(locale, "Private HR note", "Özel İK notu")}</button> : null}
      </div>
      {message ? <small aria-live="polite">{message}</small> : null}
    </div>
  </details>;
}
