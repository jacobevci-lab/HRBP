"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useSessionContext } from "@/components/session-provider";
import { serviceActionMessage, useHRServiceAction, isObject } from "@/components/hr-service-action-state";
import { acceptsServiceComment, serviceStaffRoles, serviceWriterRoles } from "@/components/hr-service-receipts";
import { parseConversationPage, type ConversationPage } from "@/components/hr-service-conversation-contract";
import styles from "@/components/hr-service-conversation-compose.module.css";

type Visibility = "REQUESTOR" | "PRIVATE_NOTE";
type Draft = { key: string; revision: string | null; body: string; visibility: Visibility };
type Proof = { key: string; id: string; revision: string; visibility: Visibility };

/** Kept mounted at a stable position while pages load/dialog closes. Only a
 * verified latest page can authorize a draft; browser state is not server ACL.
 * The outcome guard has no message body and survives a closed/failed read. */
export function HRServiceConversationCompose({ requestId, page, active, locale, invalidate }: {
  requestId: string; page: ConversationPage | null; active: boolean; locale: Locale; invalidate: () => void;
}) {
  const { session, loading } = useSessionContext(), user = session?.user;
  const key = JSON.stringify([requestId, user?.id, user?.tenantId, user?.role]);
  const principalAllowed = Boolean(!loading && session?.authenticated && user && serviceWriterRoles.has(user.role));
  const verified = user && page ? parseConversationPage(page, requestId, user, page.before) : null;
  const writable = Boolean(active && principalAllowed && verified && verified.before === null &&
    !["CLOSED", "CANCELLED"].includes(verified.request.status));
  const staff = Boolean(user && serviceStaffRoles.has(user.role));
  const empty: Draft = { key, revision: null, body: "", visibility: "REQUESTOR" };
  const [stored, setStored] = useState<Draft>(empty), [proof, setProof] = useState<Proof | null>(null);
  const draft = stored.key === key ? stored : empty;
  const latest = useRef({ key, page, writable, draft, active }); latest.current = { key, page, writable, draft, active };
  const action = useHRServiceAction(key, principalAllowed);
  const id = useId(), c = (en: string, tr: string) => locale === "tr" ? tr : en;
  // Do not retain private draft text through an actor/role/tenant change or
  // loss of the verified session. Outcomes remain guarded by the shared hook.
  useEffect(() => { setStored({ key, revision: null, body: "", visibility: "REQUESTOR" }); setProof(null); }, [key, principalAllowed]);
  useEffect(() => { if (action.phase === "denied" && active && page) invalidate(); }, [action.phase, active, page, invalidate]);
  const stale = Boolean(draft.revision && verified && draft.revision !== verified.request.updatedAt);
  const current = () => latest.current.key === key && latest.current.page === page && latest.current.writable && latest.current.draft === draft;
  const editable = writable && !action.blocked && !stale;
  function edit(body: string) {
    if (!current() || !editable || !verified) return;
    setStored({ ...draft, revision: verified.request.updatedAt, body });
  }
  function visibility(value: string) {
    if (!current() || !editable || !staff || !verified || !["REQUESTOR", "PRIVATE_NOTE"].includes(value)) return;
    if (value === "REQUESTOR" && draft.visibility === "PRIVATE_NOTE" && draft.body.trim()) {
      try {
        if (!window.confirm(c("Make this private-note draft visible to the requester when sent?", "Bu özel not taslağı gönderildiğinde talep sahibine görünür olsun mu?")) || !current()) return;
      } catch { return; }
    }
    setStored({ ...draft, revision: verified.request.updatedAt, visibility: value as Visibility });
  }
  async function send() {
    const text = draft.body.trim(), selected = draft.visibility;
    if (!user || !verified || !current() || !editable || !text || text.length > 4000 || (selected === "PRIVATE_NOTE" && !staff)) return;
    const revision = verified.request.updatedAt;
    const confirmation = selected === "PRIVATE_NOTE"
      ? c("Save this private HR note? The requester cannot see it.", "Bu özel İK notu kaydedilsin mi? Talep sahibi notu göremez.")
      : (!staff && verified.request.status === "RESOLVED"
        ? c("Send this reply and reopen the resolved request?", "Yanıt gönderilsin ve çözülmüş talep yeniden açılsın mı?")
        : c("Send this reply? It will be visible to the requester and the service team.", "Yanıt gönderilsin mi? Talep sahibine ve hizmet ekibine görünür olacaktır."));
    const result = await action.run({ action: "CONVERSATION_" + selected, confirmation, isApplicable: current,
      url: `/api/hr-service/requests/${encodeURIComponent(requestId)}/comments`,
      body: { body: text, visibility: selected, expectedUpdatedAt: revision }, expectedStatus: 201,
      accepts: value => acceptsServiceComment(value, user, requestId, text, selected, revision) });
    // Closing or replacing a history page is not permission to discard a
    // confirmed outcome. Never overwrite another principal's draft/proof.
    if (isObject(result) && isObject(result.writeReceipt) && typeof result.id === "string" &&
        typeof result.writeReceipt.updatedAt === "string" && latest.current.key === key) {
      setProof({ key, id: result.id, revision: result.writeReceipt.updatedAt, visibility: selected });
      setStored({ key, revision: result.writeReceipt.updatedAt, body: "", visibility: "REQUESTOR" });
    }
  }
  const canPrepare = Boolean(writable && verified && action.phase === "saved" && proof?.key === key &&
    verified.request.updatedAt === proof.revision && verified.comments.some(row => row.id === proof.id && row.own && row.visibility === proof.visibility));
  function prepare() {
    if (!current() || !canPrepare || !verified || !action.newDraft()) return;
    setStored({ key, revision: verified.request.updatedAt, body: "", visibility: "REQUESTOR" }); setProof(null);
  }
  if (!active || !principalAllowed || !verified) return null;
  if (verified.before !== null) return <p className={styles.hint}>{c("Older messages are read-only. Refresh the latest messages before composing a reply.", "Eski mesaj sayfaları salt okunurdur. Yanıt yazmadan önce son mesajları yenileyin.")}</p>;
  if (["CLOSED", "CANCELLED"].includes(verified.request.status)) return <p className={styles.hint}>{c("This request is read-only.", "Bu talep salt okunurdur.")}</p>;
  const message = serviceActionMessage(action.phase, locale);
  return <section className={styles.root} data-conversation-compose={requestId} aria-labelledby={id + "-heading"}>
    <h4 id={id + "-heading"}>{c("Write in this conversation", "Bu konuşmaya yaz")}</h4>
    {stale && action.phase === "idle" ? <div role="alert" className={styles.feedback}>
      <p>{c("The request changed while you were writing. Review the latest conversation before using this preserved draft.", "Siz yazarken talep değişti. Korunan taslağınızı kullanmadan önce son konuşmayı kontrol edin.")}</p>
      <button type="button" onClick={() => { if (current() && !action.blocked && verified) setStored({ ...draft, revision: verified.request.updatedAt }); }}>{c("Use reviewed conversation", "Kontrol ettiğim konuşmayı kullan")}</button>
    </div> : null}
    {staff ? <label htmlFor={id + "-visibility"}>{c("Message visibility", "Mesaj görünürlüğü")}
      <select id={id + "-visibility"} aria-label={c("Message visibility", "Mesaj görünürlüğü")} value={draft.visibility} disabled={!editable} onChange={e => visibility(e.target.value)}>
        <option value="REQUESTOR">{c("Public reply", "Açık yanıt")}</option>
        <option value="PRIVATE_NOTE">{c("Private note (staff only)", "Özel not (hizmet ekibi)")}</option>
      </select></label> : null}
    <p className={draft.visibility === "PRIVATE_NOTE" ? styles.privateHint : styles.hint}>
      {draft.visibility === "PRIVATE_NOTE" ? c("Private note: only authorized service staff can read it.", "Özel not: yalnız yetkili hizmet ekibi okuyabilir.")
        : c("Your reply is visible to the requester and the service team.", "Yanıtınız talep sahibine ve hizmet ekibine görünür.")}
    </p>
    <label htmlFor={id + "-message"}>{c("Conversation message", "Konuşma mesajı")}
      <textarea id={id + "-message"} aria-label={c("Conversation message", "Konuşma mesajı")} value={draft.body} onChange={e => edit(e.target.value)} rows={4} maxLength={4000} disabled={!editable} />
    </label>
    <small className={styles.hint}>{draft.body.length}/4000</small>
    <div className={styles.buttons}>
      <button type="button" onClick={send} disabled={!editable || !draft.body.trim() || draft.body.trim().length > 4000}>
        {draft.visibility === "PRIVATE_NOTE" ? c("Save private note", "Özel notu kaydet") : c("Send reply", "Yanıtı gönder")}
      </button>
      {action.phase === "saved" ? <button type="button" onClick={prepare} disabled={!canPrepare}>{c("Prepare another message", "Yeni mesaj hazırla")}</button> : null}
    </div>
    {message ? <p className={styles.feedback} role={action.phase === "saved" ? "status" : "alert"}>{message}</p> : null}
    {action.phase === "saved" ? <p className={styles.hint}>{c("Refresh the latest messages to verify this save before preparing another message.", "Yeni mesaj hazırlamadan önce kaydı doğrulamak için son mesajları yenileyin.")}</p> : null}
  </section>;
}
