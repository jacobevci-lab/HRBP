"use client";

import { useId, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useSessionContext } from "@/components/session-provider";
import { serviceActionMessage, useHRServiceAction } from "@/components/hr-service-action-state";
import { acceptsServiceIntake, serviceWriterRoles, validIntake } from "@/components/hr-service-receipts";
import styles from "@/components/hr-service-actions.module.css";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
const blank = () => ({ category: "", subcategory: "", title: "", description: "", priority: "MEDIUM", invalid: false, createdId: "" });
export function HRServiceRequestForm({ locale }: { locale: Locale }) {
  const { session, loading } = useSessionContext(); const user = session?.user;
  const key = JSON.stringify(["intake", user?.tenantId, user?.id, user?.employmentId, user?.role]);
  const allowed = Boolean(!loading && session?.authenticated && user && serviceWriterRoles.has(user.role) &&
    (!["EMPLOYEE", "MANAGER"].includes(user.role) || user.employmentId));
  const action = useHRServiceAction(key, allowed);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const [stored, setStored] = useState({ key, ...blank() });
  const draft = stored.key === key ? stored : { key, ...blank() };
  const base = useId(); const label = (en: string, tr: string) => c(locale, en, tr);
  const change = (field: string, value: string) => { if (latest.current.key === key && !action.blocked) setStored({ ...draft, [field]: value, invalid: false }); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!allowed || !user || action.blocked || latest.current.key !== key) return;
    const sent = { category: draft.category.trim(), subcategory: draft.subcategory.trim(), title: draft.title.trim(), description: draft.description.trim(), priority: draft.priority };
    if (!validIntake(sent)) { setStored({ ...draft, invalid: true }); return; }
    const saved = await action.run({ action: "CREATE", confirmation: label("Create this HR service request?", "Bu İK hizmet talebi oluşturulsun mu?"),
      url: "/api/hr-service/requests", body: sent, expectedStatus: 201, accepts: data => acceptsServiceIntake(data, user, sent) });
    if (saved && latest.current.key === key && latest.current.allowed) setStored({ key, ...blank(), createdId: (saved as { id: string }).id });
  }
  const message = serviceActionMessage(action.phase, locale);
  if (!allowed) return null;
  return <details className={styles.root} data-hr-service-intake>
    <summary>{label("Create HR service request", "İK hizmet talebi oluştur")}</summary>
    <form onSubmit={submit} className={styles.form} aria-busy={action.phase === "pending"}>
      <div className={styles.row}>
        <label className={styles.field} htmlFor={`${base}-category`}>{label("Category", "Kategori")}<input id={`${base}-category`} aria-label={label("Category", "Kategori")} value={draft.category} onChange={e => change("category", e.target.value)} maxLength={80} required disabled={action.blocked}/></label>
        <label className={styles.field} htmlFor={`${base}-subcategory`}>{label("Subcategory (optional)", "Alt kategori (isteğe bağlı)")}<input id={`${base}-subcategory`} aria-label={label("Subcategory (optional)", "Alt kategori (isteğe bağlı)")} value={draft.subcategory} onChange={e => change("subcategory", e.target.value)} maxLength={80} disabled={action.blocked}/></label>
        <label className={styles.field} htmlFor={`${base}-priority`}>{label("Priority", "Öncelik")}<select id={`${base}-priority`} aria-label={label("Priority", "Öncelik")} value={draft.priority} onChange={e => change("priority", e.target.value)} disabled={action.blocked}>
          <option value="LOW">{label("Low", "Düşük")}</option><option value="MEDIUM">{label("Medium", "Orta")}</option><option value="HIGH">{label("High", "Yüksek")}</option><option value="CRITICAL">{label("Critical", "Kritik")}</option>
        </select></label>
      </div>
      <label className={styles.field} htmlFor={`${base}-title`}>{label("Request title", "Talep başlığı")}<input id={`${base}-title`} aria-label={label("Request title", "Talep başlığı")} value={draft.title} onChange={e => change("title", e.target.value)} maxLength={200} required disabled={action.blocked}/></label>
      <label className={styles.field} htmlFor={`${base}-description`}>{label("Description", "Açıklama")}<textarea id={`${base}-description`} aria-label={label("Description", "Açıklama")} value={draft.description} onChange={e => change("description", e.target.value)} maxLength={4000} required rows={4} disabled={action.blocked}/></label>
      {draft.invalid ? <small role="alert" className={styles.feedback}>{label("Check the category, title, description and priority. Required fields cannot be blank.", "Kategori, başlık, açıklama ve önceliği kontrol edin. Zorunlu alanlar boş olamaz.")}</small> : null}
      <div className={styles.buttons}><button type="submit" disabled={action.blocked}>{action.phase === "pending" ? label("Creating…", "Oluşturuluyor…") : label("Create request", "Talep oluştur")}</button>
        {action.phase === "saved" ? <button type="button" onClick={() => { if (action.newDraft()) setStored({ key, ...blank() }); }}>{label("Create another request", "Başka talep oluştur")}</button> : null}
        {message ? <button type="button" onClick={action.reload}>{label("Reload current records", "Güncel kayıtları yeniden yükle")}</button> : null}
      </div>
      {message ? <small role={action.phase === "saved" ? "status" : "alert"} className={styles.feedback}>{message}</small> : null}
      {draft.createdId ? <a href={`/module/hr-service?request=${encodeURIComponent(draft.createdId)}`}>{label("Open created request", "Oluşturulan talebi aç")}</a> : null}
    </form>
  </details>;
}
