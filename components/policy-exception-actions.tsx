"use client";

import { Check, LoaderCircle, Send, ShieldAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";
import { policyActionMessage, usePolicyAction } from "@/components/policy-action-state";
import { acceptsExceptionDecision, acceptsExceptionRequest, futureUtcDayEnd } from "@/components/policy-form-contract";
import styles from "@/components/policy-forms.module.css";
import { usePolicyDialog } from "@/components/use-policy-dialog";

export function PolicyExceptionRequest({ policyId }: { policyId: string }) {
  const { locale } = useLocale(), { session, loading } = useSessionContext();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const user = session?.user;
  const key = JSON.stringify([policyId, user?.tenantId, user?.id, user?.employmentId]);
  const allowed = Boolean(!loading && session?.authenticated && user?.employmentId);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const action = usePolicyAction(key);
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [stored, setStored] = useState({ key, reason: "", control: "", expiresAt: "", invalid: false });
  const draft = stored.key === key ? stored : { key, reason: "", control: "", expiresAt: "", invalid: false };
  const open = openKey === key;
  useEffect(() => {
    if (open && allowed) { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }
    else if (dialog.current?.open) dialog.current.close();
  }, [open, allowed]);
  usePolicyDialog(dialog, open && allowed);
  function close() { setOpenKey(null); trigger.current?.focus(); }
  function edit(change: Partial<typeof draft>) {
    if (latest.current.key !== key || !latest.current.allowed || action.blocked) return;
    setStored({ ...draft, ...change, key, invalid: false });
  }
  async function submit() {
    if (latest.current.key !== key || !latest.current.allowed || !user?.employmentId || action.blocked) return;
    const reason = draft.reason.trim(), control = draft.control.trim(), expiresAt = futureUtcDayEnd(draft.expiresAt);
    if (!reason || reason.length > 2000 || control.length > 2000 || expiresAt === false) { setStored({ ...draft, invalid: true }); return; }
    await action.run({ action: "REQUEST", confirmation: c("Submit this exception request for independent review? This does not acknowledge or waive the policy.", "Bu istisna talebi bağımsız incelemeye gönderilsin mi? Bu işlem politikayı okundu veya muaf olarak işaretlemez."),
      url: `/api/policies/${encodeURIComponent(policyId)}/exceptions`, expectedStatus: 201,
      init: { method: "POST", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", "x-purpose": "Policy exception request" }, body: JSON.stringify({ employmentId: user.employmentId, reason, compensatingControl: control || undefined, expiresAt }) },
      accepts: data => acceptsExceptionRequest(data, policyId, user.tenantId, user.id, user.employmentId!, { reason, compensatingControl: control || null, expiresAt }),
      events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"] });
  }
  const message = policyActionMessage(action.phase, locale);
  if (!allowed) return null;
  return <div className={styles.root}>
    <button ref={trigger} type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => { if (latest.current.key === key && latest.current.allowed) setOpenKey(key); }}><ShieldAlert size={12}/>{c("Request exception", "İstisna talep et")}</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={() => setOpenKey(null)}>
      <div className={styles.header}><h3 id={titleId}>{c("Policy exception request", "Politika istisna talebi")}</h3><button type="button" className="secondary-button" onClick={close}><X size={12}/>{c("Close", "Kapat")}</button></div>
      <p className={styles.note}>{c("Request an exception for your assigned policy. Independent review is required; submitting does not acknowledge or waive the policy.", "Size atanan politika için istisna talep edin. Bağımsız inceleme gerekir; talep göndermek politikayı okundu veya muaf olarak işaretlemez.")}</p>
      <label className={styles.field}><span>{c("Business reason", "İş gerekçesi")}</span><textarea aria-label={c("Business reason", "İş gerekçesi")} required maxLength={2000} value={draft.reason} disabled={action.blocked} onChange={e => edit({ reason: e.target.value })}/></label>
      <label className={styles.field}><span>{c("Compensating control (optional)", "Telafi edici kontrol (isteğe bağlı)")}</span><textarea aria-label={c("Compensating control (optional)", "Telafi edici kontrol (isteğe bağlı)")} maxLength={2000} value={draft.control} disabled={action.blocked} onChange={e => edit({ control: e.target.value })}/></label>
      <label className={styles.field}><span>{c("Expiry date (optional)", "Bitiş tarihi (isteğe bağlı)")}</span><input aria-label={c("Expiry date (optional)", "Bitiş tarihi (isteğe bağlı)")} type="date" value={draft.expiresAt} disabled={action.blocked} onChange={e => edit({ expiresAt: e.target.value })}/></label>
      <p className={styles.note}>{c("Dates use 23:59:59 UTC. Leave the date empty for no expiry. Reason and control: up to 2,000 characters each.", "Tarihler 23:59:59 UTC olarak işlenir. Tarih boş bırakılırsa bitiş tarihi uygulanmaz. Gerekçe ve kontrol alanları ayrı ayrı en fazla 2.000 karakterdir.")}</p>
      {draft.invalid ? <p role="alert" className={styles.note}>{c("Enter a reason, keep each text within 2,000 characters and choose a valid future date or leave it empty.", "Gerekçe girin, her metni 2.000 karakterle sınırlayın ve geçerli bir ileri tarih seçin veya tarihi boş bırakın.")}</p> : null}
      <button type="button" className="secondary-button" disabled={action.blocked} onClick={() => void submit()}>{action.phase === "pending" ? <LoaderCircle size={12}/> : <Send size={12}/>} {c("Submit", "Gönder")}</button>
      {message ? <div className={styles.root}><p role={action.phase === "saved" ? "status" : "alert"} className={styles.note}>{message}</p><button type="button" className="secondary-button" onClick={() => { if (window.confirm(c("Reload current records? Unsaved form entries will be lost.", "Güncel kayıtlar yeniden yüklensin mi? Kaydedilmemiş form alanları kaybolacak."))) action.reload(); }}>{c("Reload current records", "Güncel kayıtları yeniden yükle")}</button></div> : null}
    </dialog>
  </div>;
}

export function PolicyExceptionDecisionButtons({ policyId, exceptionId, requestedById, actorId }: { policyId: string; exceptionId: string; requestedById: string; actorId: string }) {
  const { locale } = useLocale(), { session, loading } = useSessionContext();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const user = session?.user;
  const key = JSON.stringify([policyId, exceptionId, requestedById, actorId, user?.tenantId, user?.id]);
  const allowed = Boolean(!loading && session?.authenticated && user?.id === actorId && requestedById !== actorId);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const action = usePolicyAction(key);
  async function decide(decision: "APPROVE" | "REJECT") {
    if (latest.current.key !== key || !latest.current.allowed || !user || action.blocked) return;
    await action.run({ action: decision,
      confirmation: decision === "APPROVE" ? c("Approve this exception? The policy assignment and acknowledgement remain unchanged.", "Bu istisna onaylansın mı? Politika ataması ve okuma onayı değişmeyecek.") : c("Reject this exception request?", "Bu istisna talebi reddedilsin mi?"),
      url: `/api/policies/${encodeURIComponent(policyId)}/exceptions/${encodeURIComponent(exceptionId)}/decision`, expectedStatus: 200,
      init: { method: "POST", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", "x-purpose": "Policy exception independent decision" }, body: JSON.stringify({ decision }) },
      accepts: data => acceptsExceptionDecision(data, policyId, exceptionId, user.tenantId, actorId, decision),
      events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"] });
  }
  if (requestedById === actorId) return <span className="matrix-note">{c("Requester cannot approve or reject", "Talep sahibi onaylayamaz veya reddedemez")}</span>;
  if (!allowed) return null;
  const message = policyActionMessage(action.phase, locale);
  return <div className={styles.root}><div className={styles.actions}><button type="button" className="mini-action approve" disabled={action.blocked} onClick={() => void decide("APPROVE")}>{action.phase === "pending" && action.action === "APPROVE" ? <LoaderCircle size={12}/> : <Check size={12}/>} {c("Approve", "Onayla")}</button><button type="button" className="mini-action reject" disabled={action.blocked} onClick={() => void decide("REJECT")}>{action.phase === "pending" && action.action === "REJECT" ? <LoaderCircle size={12}/> : <X size={12}/>} {c("Reject", "Reddet")}</button></div>
    {message ? <div className={styles.root}><p role={action.phase === "saved" ? "status" : "alert"} className={styles.note}>{message}</p><button type="button" className="secondary-button" onClick={() => action.reload()}>{c("Reload current records", "Güncel kayıtları yeniden yükle")}</button></div> : null}
  </div>;
}
