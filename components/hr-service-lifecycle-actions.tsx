"use client";

import { useId, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useSessionContext } from "@/components/session-provider";
import { serviceActionMessage, useHRServiceAction } from "@/components/hr-service-action-state";
import { acceptsServiceComment, acceptsServiceTransition, serviceStaffRoles, serviceWriterRoles } from "@/components/hr-service-receipts";
import styles from "@/components/hr-service-actions.module.css";

const transitions: Record<string, string[]> = {
  OPEN: ["TRIAGE", "CANCELLED"],
  TRIAGE: ["IN_PROGRESS", "WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CANCELLED"],
  WAITING_EMPLOYEE: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  WAITING_THIRD_PARTY: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"], CLOSED: [], CANCELLED: []
};
const reasonRequired = new Set(["WAITING_EMPLOYEE", "WAITING_THIRD_PARTY", "RESOLVED", "CLOSED", "CANCELLED"]);
function label(locale: Locale, value: string) {
  if (locale !== "tr") return value.toLowerCase().split("_").map(p => p[0]?.toUpperCase() + p.slice(1)).join(" ");
  const labels: Record<string, string> = { OPEN: "Açık", TRIAGE: "Triyaj", IN_PROGRESS: "Devam ediyor", WAITING_EMPLOYEE: "Çalışan bekleniyor", WAITING_THIRD_PARTY: "Üçüncü taraf bekleniyor", RESOLVED: "Çözüldü", CLOSED: "Kapalı", CANCELLED: "İptal edildi" };
  return labels[value] ?? value;
}
async function acknowledgeRequestNotifications(requestId: string, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  try {
    const response = await fetch("/api/notifications", { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceType: "HRServiceRequest", resourceId: requestId, read: true }) });
    if (response.ok && isCurrent()) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch { /* Badge cleanup is best-effort and never gates the confirmed write. */ }
}

export function HRServiceLifecycleActions({ requestId, status, locale, staff }: { requestId: string; status: string; locale: Locale; staff: boolean }) {
  const { session, loading } = useSessionContext(); const user = session?.user;
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const terminal = status === "CLOSED" || status === "CANCELLED";
  const allowed = Boolean(!loading && session?.authenticated && user && serviceWriterRoles.has(user.role) && !terminal && transitions[status]);
  const canTransition = Boolean(staff && user && serviceStaffRoles.has(user.role));
  const key = JSON.stringify([requestId, user?.tenantId, user?.id, user?.role, staff]);
  const latest = useRef({ key, status, allowed }); latest.current = { key, status, allowed };
  const action = useHRServiceAction(key, allowed);
  const options = transitions[status] ?? [];
  const [stored, setStored] = useState({ key, status, target: options[0] ?? "", reason: "", reply: "", invalid: false });
  const draft = stored.key === key ? stored : { key, status, target: options[0] ?? "", reason: "", reply: "", invalid: false };
  // A new server status must never leave the previous selection bound to a
  // target no longer present in the refreshed select's options.
  const target = draft.status === status && options.includes(draft.target) ? draft.target : options[0] ?? "";
  const validHandler = () => latest.current.key === key && latest.current.status === status && latest.current.allowed && !action.blocked;
  const change = (field: string, value: string) => { if (validHandler()) setStored({ ...draft, status, target, [field]: value, invalid: false }); };
  const id = useId();
  const afterSave = (isCurrent: () => boolean) => { void acknowledgeRequestNotifications(requestId, isCurrent); };

  async function transition() {
    if (!validHandler() || !canTransition || !user || !options.includes(target)) return;
    const reason = draft.reason.trim();
    const needsReason = reasonRequired.has(target) || (status === "RESOLVED" && target === "IN_PROGRESS");
    if ((needsReason && reason.length < 10) || reason.length > 2000) { setStored({ ...draft, invalid: true }); return; }
    const result = await action.run({ action: "TRANSITION", confirmation: c(`Change this request to ${label(locale, target)}?`, `Talep durumu ${label(locale, target)} olarak değiştirilsin mi?`),
      url: `/api/hr-service/requests/${encodeURIComponent(requestId)}/status`, body: { status: target, ...(reason ? { reason } : {}) }, expectedStatus: 200,
      accepts: data => acceptsServiceTransition(data, user, requestId, target), afterSave });
    if (result && latest.current.key === key && latest.current.allowed) setStored({ ...draft, reason: "", invalid: false });
  }
  async function addComment(visibility: "REQUESTOR" | "PRIVATE_NOTE") {
    if (!validHandler() || !user || (visibility === "PRIVATE_NOTE" && !canTransition)) return;
    const body = draft.reply.trim();
    if (!body || body.length > 4000) { setStored({ ...draft, invalid: true }); return; }
    const confirmation = visibility === "PRIVATE_NOTE" ? c("Save this private HR note? It is not visible to the requester.", "Bu özel İK notu kaydedilsin mi? Talep sahibi bu notu göremez.")
      : (!staff && status === "RESOLVED" ? c("Send this reply and reopen the resolved request?", "Yanıt gönderilsin ve çözülmüş talep yeniden açılsın mı?")
        : c("Send this reply to the requester-visible conversation?", "Bu yanıt talep sahibine görünür konuşmaya gönderilsin mi?"));
    const result = await action.run({ action: visibility, confirmation, url: `/api/hr-service/requests/${encodeURIComponent(requestId)}/comments`,
      body: { body, visibility }, expectedStatus: 201, accepts: data => acceptsServiceComment(data, user, requestId, body, visibility), afterSave });
    if (result && latest.current.key === key && latest.current.allowed) setStored({ ...draft, reply: "", invalid: false });
  }
  if (!allowed) return terminal ? <small>{c("Read only", "Salt okunur")}</small> : null;
  const message = serviceActionMessage(action.phase, locale);
  return <details className={`${styles.root} ${styles.lifecycle}`} data-hr-service-actions={requestId}>
    <summary>{c("Actions", "Aksiyonlar")}</summary>
    <div className={styles.form} aria-busy={action.phase === "pending"}>
      {canTransition && options.length ? <>
        <label className={styles.field} htmlFor={`${id}-target`}>{c("Next status", "Yeni durum")}<select id={`${id}-target`} aria-label={c("Next status", "Yeni durum")} value={target} onChange={e => change("target", e.target.value)} disabled={action.blocked}>
          {options.map(option => <option key={option} value={option}>{label(locale, option)}</option>)}
        </select></label>
        <label className={styles.field} htmlFor={`${id}-reason`}>{c("Transition reason", "Geçiş gerekçesi")}<textarea id={`${id}-reason`} aria-label={c("Transition reason", "Geçiş gerekçesi")} value={draft.reason} onChange={e => change("reason", e.target.value)} minLength={10} maxLength={2000} rows={2} disabled={action.blocked}/></label>
        <button type="button" onClick={transition} disabled={action.blocked || !target}>{c("Apply transition", "Geçişi uygula")}</button>
      </> : null}
      <label className={styles.field} htmlFor={`${id}-reply`}>{c("Reply or note", "Yanıt veya not")}<textarea id={`${id}-reply`} aria-label={c("Reply or note", "Yanıt veya not")} value={draft.reply} onChange={e => change("reply", e.target.value)} maxLength={4000} rows={3} disabled={action.blocked}/></label>
      <p className={styles.hint}>{canTransition ? c("Replies are visible to the requester. Private HR notes are restricted to service staff.", "Yanıtlar talep sahibine görünür. Özel İK notları yalnız hizmet ekibine açıktır.") : c("Your reply is visible to the service team. Replying to a resolved request reopens it.", "Yanıtınız hizmet ekibine görünür. Çözülmüş talebe yanıt vermek talebi yeniden açar.")}</p>
      <div className={styles.buttons}>
        <button type="button" onClick={() => addComment("REQUESTOR")} disabled={action.blocked || !draft.reply.trim()}>{c("Add reply", "Yanıt ekle")}</button>
        {canTransition ? <button type="button" onClick={() => addComment("PRIVATE_NOTE")} disabled={action.blocked || !draft.reply.trim()}>{c("Private HR note", "Özel İK notu")}</button> : null}
        {action.phase === "saved" ? <button type="button" onClick={() => { if (action.newDraft()) setStored({ ...draft, status, target, invalid: false }); }}>{c("Prepare next action", "Sonraki işlemi hazırla")}</button> : null}
        {message ? <button type="button" onClick={action.reload}>{c("Reload current request", "Güncel talebi yeniden yükle")}</button> : null}
      </div>
      {draft.invalid ? <small role="alert" className={styles.feedback}>{c("Check the text lengths. Governed transitions require a reason of 10–2000 characters; replies require 1–4000.", "Metin uzunluklarını kontrol edin. Gerekçeli geçişler 10–2000, yanıtlar 1–4000 karakter gerektirir.")}</small> : null}
      {message ? <small role={action.phase === "saved" ? "status" : "alert"} className={styles.feedback}>{message}</small> : null}
    </div>
  </details>;
}
