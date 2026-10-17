"use client";

import { LoaderCircle, Search, Send, UsersRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";
import { isRecord, policyActionMessage, usePolicyAction } from "@/components/policy-action-state";
import { acceptsAssignmentReceipt, assignmentStatusText, defaultPolicyDueDate, futureUtcDayEnd, parseAssignmentOptions, type AssignmentOptions } from "@/components/policy-form-contract";
import styles from "@/components/policy-forms.module.css";
import { usePolicyDialog } from "@/components/use-policy-dialog";

type Draft = { key: string; selected: Set<string>; query: string; dueAt: string; invalid: boolean };
export function PolicyAssignmentManager({ policyId, canWrite }: { policyId: string; canWrite: boolean }) {
  const { locale } = useLocale();
  const { session, loading: sessionLoading } = useSessionContext();
  const user = session?.user;
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const key = JSON.stringify([policyId, user?.tenantId, user?.id, canWrite]);
  const allowed = Boolean(canWrite && !sessionLoading && session?.authenticated && user);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const action = usePolicyAction(key);
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; data: AssignmentOptions | null; error: boolean }>({ key, data: null, error: false });
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [stored, setStored] = useState<Draft>({ key, selected: new Set(), query: "", dueAt: defaultPolicyDueDate(), invalid: false });
  const read = useRef<{ key: string; controller: AbortController } | null>(null);
  const draft = stored.key === key ? stored : { key, selected: new Set<string>(), query: "", dueAt: defaultPolicyDueDate(), invalid: false };
  const options = snapshot.key === key ? snapshot.data : null;
  const readError = snapshot.key === key && snapshot.error;
  const loading = loadingKey === key, open = openKey === key;
  const q = draft.query.trim().toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US");
  const visible = (options?.employments ?? []).filter(e => !q || [e.name, e.employeeNumber ?? "", e.position, e.organization].some(v => v.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US").includes(q)));

  useEffect(() => {
    if (open && allowed) { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }
    else if (dialog.current?.open) dialog.current.close();
  }, [open, allowed]);
  usePolicyDialog(dialog, open && allowed);
  useEffect(() => () => { read.current?.controller.abort(); read.current = null; }, [key]);

  function close() {
    read.current?.controller.abort(); read.current = null; setLoadingKey(null);
    setOpenKey(null); trigger.current?.focus();
  }
  function edit(change: Partial<Draft>) {
    if (latest.current.key !== key || !latest.current.allowed || action.blocked) return;
    setStored({ ...draft, ...change, key, invalid: false });
  }
  async function load() {
    if (latest.current.key !== key || !latest.current.allowed || !user || read.current) return;
    const attempt = { key, controller: new AbortController() }; read.current = attempt;
    const timer = setTimeout(() => attempt.controller.abort(), 15000);
    setLoadingKey(key); setSnapshot({ key, data: null, error: false });
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/assignment-options`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: attempt.controller.signal });
      if (response.status !== 200 || response.redirected) throw new Error("READ");
      const value: unknown = await response.json();
      const data = isRecord(value) ? parseAssignmentOptions(value.data, policyId, user.tenantId) : null;
      if (!data) throw new Error("READ");
      if (read.current !== attempt || latest.current.key !== key || !latest.current.allowed) return;
      setSnapshot({ key, data, error: false });
      // Preserve the draft, removing only candidates no longer eligible after an explicit read.
      setStored(old => old.key !== key ? old : { ...old, selected: new Set([...old.selected].filter(id => data.employments.some(e => e.id === id && !e.assigned))) });
    } catch {
      if (read.current === attempt && latest.current.key === key) setSnapshot({ key, data: null, error: true });
    } finally {
      clearTimeout(timer);
      if (read.current === attempt) { read.current = null; setLoadingKey(null); }
    }
  }
  function show() { if (!latest.current.allowed || latest.current.key !== key) return; setOpenKey(key); void load(); }
  async function assign() {
    if (latest.current.key !== key || !latest.current.allowed || !user || action.blocked || read.current || !options) return;
    const employmentIds = [...draft.selected];
    const dueAt = futureUtcDayEnd(draft.dueAt);
    if (!employmentIds.length || employmentIds.length > 500 || dueAt === false || employmentIds.some(id => !options.employments.some(e => e.id === id && !e.assigned))) {
      setStored({ ...draft, invalid: true }); return;
    }
    await action.run({ action: "ASSIGN", confirmation: c(`Assign this policy to ${employmentIds.length} selected employee(s)? Existing assignments will not be changed.`, `Bu politika seçilen ${employmentIds.length} çalışana atansın mı? Mevcut atamalar değiştirilmeyecek.`),
      url: `/api/policies/${encodeURIComponent(policyId)}/assignments`, expectedStatus: 201,
      init: { method: "POST", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", "x-purpose": "Policy assignment governance" }, body: JSON.stringify({ employmentIds, dueAt }) },
      accepts: data => acceptsAssignmentReceipt(data, policyId, user.tenantId, employmentIds.length, { employmentIds, dueAt }),
      events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"] });
  }
  const message = policyActionMessage(action.phase, locale);
  if (!allowed) return null;
  return <div className={styles.root}>
    <button ref={trigger} type="button" className="secondary-button" onClick={show} aria-haspopup="dialog"><UsersRound size={13}/>{c("Assign policy", "Politika ata")}</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={() => setOpenKey(null)}>
      <div className={styles.header}><h3 id={titleId}>{c("Policy assignments", "Politika atamaları")}</h3><button type="button" className="secondary-button" onClick={close}><X size={13}/>{c("Close", "Kapat")}</button></div>
      <p className={styles.note}>{c("Choose employees for this policy. Existing acknowledgements, waivers and deadlines are kept.", "Bu politika için çalışanları seçin. Mevcut okuma onayları, muafiyetler ve son tarihler korunur.")}</p>
      <div className={styles.actions}><span className={styles.note}>{options ? (options.relationshipScoped ? c("Relationship-scoped employees", "Yetkili ilişki kapsamındaki çalışanlar") : c("Tenant-authorized employees", "Kurum kapsamında yetkili çalışanlar")) : c("Employee options", "Çalışan seçenekleri")}</span><button type="button" className="secondary-button" disabled={loading || action.phase === "pending"} onClick={() => void load()}><Search size={12}/>{c("Refresh employees", "Çalışanları yenile")}</button></div>
      <div className={styles.fields}>
        <label className={styles.field}><span>{c("Search employees", "Çalışan ara")}</span><input aria-label={c("Search employees", "Çalışan ara")} value={draft.query} disabled={action.blocked} onChange={e => edit({ query: e.target.value })}/></label>
        <label className={styles.field}><span>{c("Due date (optional)", "Son tarih (isteğe bağlı)")}</span><input aria-label={c("Due date (optional)", "Son tarih (isteğe bağlı)")} type="date" value={draft.dueAt} disabled={action.blocked} onChange={e => edit({ dueAt: e.target.value })}/></label>
      </div>
      <p className={styles.note}>{c("Dates use 23:59:59 UTC. Leave the date empty for no deadline. Up to the first 500 authorized employees are shown; search filters this list only.", "Tarihler 23:59:59 UTC olarak işlenir. Tarih boş bırakılırsa son tarih uygulanmaz. Yetkili çalışanların ilk 500 kaydına kadar gösterilir; arama yalnız bu listeyi filtreler.")}</p>
      <div className={styles.actions}><button type="button" className="secondary-button" disabled={loading || !options || action.blocked} onClick={() => edit({ selected: new Set([...draft.selected, ...visible.filter(e => !e.assigned).map(e => e.id)]) })}>{c("Select visible", "Görünenleri seç")}</button><span className={styles.note}>{c(`Selected: ${draft.selected.size}`, `Seçilen: ${draft.selected.size}`)}</span></div>
      {loading ? <p role="status" className={styles.note}>{c("Loading employees…", "Çalışanlar yükleniyor…")}</p> : readError ? <p role="alert" className={styles.note}>{c("Employee options could not be verified. Use Refresh employees to retry the read. This refresh did not send a new assignment.", "Çalışan seçenekleri doğrulanamadı. Okumayı tekrar denemek için Çalışanları yenile düğmesini kullanın. Bu yenileme yeni bir atama isteği göndermedi.")}</p> : options ? <div className={styles.list} tabIndex={0} role="region" aria-label={c("Employee selection", "Çalışan seçimi")}><table className={styles.table}><thead><tr><th>{c("Select", "Seç")}</th><th>{c("Employee", "Çalışan")}</th><th>{c("Position", "Pozisyon")}</th><th>{c("Organization", "Organizasyon")}</th><th>{c("Status", "Durum")}</th></tr></thead><tbody>{visible.length ? visible.map(employment => <tr key={employment.id}>
        <td><input type="checkbox" aria-label={c(`Select ${employment.name}`, `${employment.name} seç`)} checked={employment.assigned || draft.selected.has(employment.id)} disabled={employment.assigned || action.blocked} onChange={() => { const selected = new Set(draft.selected); if (selected.has(employment.id)) selected.delete(employment.id); else selected.add(employment.id); edit({ selected }); }}/></td>
        <td><strong>{employment.name}</strong><small className="cell-sub">{employment.employeeNumber || c("No employee number", "Çalışan numarası yok")}</small></td><td>{employment.position === "No position" ? c("No position", "Pozisyon yok") : employment.position}</td><td>{employment.organization === "No organization" ? c("No organization", "Organizasyon yok") : employment.organization}</td><td>{employment.assigned ? assignmentStatusText(employment.assignmentStatus, locale) : c("Available", "Atanabilir")}</td>
      </tr>) : <tr><td colSpan={5}>{c("No employees match this scope/filter.", "Bu kapsam veya filtreyle eşleşen çalışan yok.")}</td></tr>}</tbody></table></div> : null}
      {draft.invalid ? <p role="alert" className={styles.note}>{c("Select eligible employees and a valid future date, or leave the date empty.", "Atanabilir çalışanları ve geçerli bir ileri tarihi seçin veya tarihi boş bırakın.")}</p> : null}
      <button type="button" className="secondary-button" disabled={loading || !options || !draft.selected.size || action.blocked} onClick={() => void assign()}>{action.phase === "pending" ? <LoaderCircle size={13}/> : <Send size={13}/>} {c("Assign selected", "Seçilenlere ata")}</button>
      {message ? <div className={styles.root}><p role={action.phase === "saved" ? "status" : "alert"} className={styles.note}>{message}</p><button type="button" className="secondary-button" onClick={() => { if (window.confirm(c("Reload current records? Unsaved form entries will be lost.", "Güncel kayıtlar yeniden yüklensin mi? Kaydedilmemiş form alanları kaybolacak."))) action.reload(); }}>{c("Reload current records", "Güncel kayıtları yeniden yükle")}</button></div> : null}
    </dialog>
  </div>;
}
