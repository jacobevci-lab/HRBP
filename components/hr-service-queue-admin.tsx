"use client";

import { LoaderCircle, Plus, Power, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import styles from "@/components/hr-service-queue-admin.module.css";

type Member = { id: string; userId: string; role: string; displayName: string; platformRole: string | null };
type Queue = { id: string; key: string; name: string; defaultSlaMinutes: number | null; active: boolean; memberships: Member[] };
type Candidate = { id: string; displayName: string; role: string };
type Receipt = Record<string, unknown>;
const object = (value: unknown): value is Receipt => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function validCatalog(value: unknown): value is { data: Queue[]; candidates: Candidate[]; permissions: { manage: true } } {
  return object(value) && object(value.permissions) && value.permissions.manage === true &&
    Array.isArray(value.data) && value.data.every(q => object(q) && text(q.id) && text(q.key) && text(q.name) && typeof q.active === "boolean" &&
      (q.defaultSlaMinutes === null || Number.isSafeInteger(q.defaultSlaMinutes)) && Array.isArray(q.memberships) && q.memberships.every(m =>
        object(m) && text(m.id) && text(m.userId) && text(m.displayName) && ["OWNER", "AGENT"].includes(String(m.role)))) &&
    Array.isArray(value.candidates) && value.candidates.every(u => object(u) && text(u.id) && text(u.displayName) && text(u.role));
}

export function HRServiceQueueAdmin() {
  const router = useRouter(), { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [queues, setQueues] = useState<Queue[]>([]), [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [uncertain, setUncertain] = useState(false);
  const [selected, setSelected] = useState("");
  const [key, setKey] = useState(""), [name, setName] = useState(""), [sla, setSla] = useState("1440");
  const [owner, setOwner] = useState(""), [member, setMember] = useState(""), [memberRole, setMemberRole] = useState("AGENT");
  const generation = useRef(0);
  const gate = useRef(false), mounted = useRef(true), readController = useRef<AbortController | null>(null);
  const active = useMemo(() => queues.find(q => q.id === selected) ?? queues[0] ?? null, [queues, selected]);
  const locked = busy !== null || !loaded || uncertain;
  const unknownMessage = c("The operation result could not be confirmed. Reload the page and inspect records before making another change.", "İşlem sonucu doğrulanamadı. Başka değişiklik yapmadan önce sayfayı yenileyip kayıtları kontrol edin.");

  async function loadData() {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const response = await fetch("/api/hr-service/queues", { cache: "no-store", signal: controller.signal });
    const value: unknown = await response.json();
    if (!response.ok || !validCatalog(value)) throw new Error("CATALOG_UNAVAILABLE");
    if (!mounted.current || controller.signal.aborted || readController.current !== controller) return;
    setQueues(value.data); setCandidates(value.candidates); setLoaded(true);
    setSelected(previous => value.data.some(q => q.id === previous) ? previous : value.data[0]?.id ?? "");
    setOwner(previous => value.candidates.some(u => u.id === previous) ? previous : value.candidates[0]?.id ?? "");
    setMember(previous => value.candidates.some(u => u.id === previous) ? previous : value.candidates[0]?.id ?? "");
  }
  async function load() {
    if (gate.current || uncertain) return;
    const version = generation.current;
    gate.current = true; setBusy("load"); setError(null); setLoaded(false);
    try { await loadData(); }
    catch { if (mounted.current && generation.current === version) { setQueues([]); setCandidates([]); setError(c("Queues could not be loaded. Use Refresh to retry.", "Kuyruklar yüklenemedi. Yenile ile tekrar deneyin.")); } }
    finally { if (generation.current === version) { gate.current = false; if (mounted.current) setBusy(null); } }
  }
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; gate.current = false; readController.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutate(url: string, init: RequestInit, kind: string, matches: (data: Receipt) => boolean, saved?: (data: Receipt) => void) {
    if (gate.current || locked) return;
    gate.current = true; setBusy(kind); setError(null);
    let confirmed = false;
    try {
      const response = await fetch(url, init);
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok && [400, 401, 403, 404, 409].includes(response.status) && object(value) && typeof value.error === "string") {
        const lastOwner = value.error.startsWith("The last queue owner cannot");
        setError(lastOwner ? c("Assign another owner before removing or demoting the last owner.", "Son sahibi kaldırmadan veya rolünü düşürmeden önce başka bir sahip atayın.") :
          response.status === 409 ? c("The request conflicts with the current record. Check the queue key, owners and open requests.", "İstek mevcut kayıtla çakışıyor. Kuyruk anahtarını, sahipleri ve açık talepleri kontrol edin.") :
          c("The request was rejected. Check your permissions and entered values.", "İstek reddedildi. Yetkilerinizi ve girilen değerleri kontrol edin."));
        return;
      }
      if (!response.ok || !object(value) || !object(value.data) || !text(value.data.id) || !matches(value.data)) throw new Error("UNCONFIRMED");
      confirmed = true;
      if (!mounted.current) return;
      saved?.(value.data);
      setLoaded(false); await loadData(); router.refresh();
    } catch {
      if (mounted.current) {
        if (!confirmed) { setUncertain(true); setError(unknownMessage); }
        else { setLoaded(false); setError(c("The change was saved, but the updated list could not be loaded. Refresh the list; do not repeat the change.", "Değişiklik kaydedildi ancak güncel liste yüklenemedi. İşlemi tekrarlamadan listeyi yenileyin.")); }
      }
    } finally { gate.current = false; if (mounted.current) setBusy(null); }
  }
  const headers = { "content-type": "application/json", "x-purpose": "HR service queue governance" };
  function createQueue() {
    if (gate.current || locked) return;
    const code = key.trim().toUpperCase().replace(/\s+/g, "_"), minutes = Number(sla);
    if (!/^[A-Z0-9_-]{2,40}$/.test(code) || !name.trim() || !owner || !Number.isInteger(minutes) || minutes < 15 || minutes > 10080) {
      setError(c("Enter a valid key, name, owner and SLA between 15 and 10080 minutes.", "Geçerli anahtar, ad, sahip ve 15–10080 dakika aralığında SLA girin.")); return;
    }
    void mutate("/api/hr-service/queues", { method: "POST", headers, body: JSON.stringify({ key: code, name: name.trim(), defaultSlaMinutes: minutes, ownerUserId: owner }) }, "create",
      data => data.key === code, data => { setSelected(String(data.id)); setKey(""); setName(""); });
  }
  function remove(item: Member) {
    if (!active || gate.current || locked || !window.confirm(c(`Remove ${item.displayName} from ${active.name}?`, `${item.displayName}, ${active.name} kuyruğundan kaldırılsın mı?`))) return;
    void mutate(`/api/hr-service/queues/${encodeURIComponent(active.id)}/members/${encodeURIComponent(item.id)}`, { method: "DELETE", headers }, "remove", data => data.id === item.id);
  }
  function toggle() {
    if (!active || gate.current || locked || !window.confirm(c(`Change the availability of ${active.name}?`, `${active.name} kuyruğunun kullanım durumu değiştirilsin mi?`))) return;
    const id = active.id, enabled = !active.active;
    void mutate(`/api/hr-service/queues/${encodeURIComponent(id)}`, { method: "PATCH", headers, body: JSON.stringify({ active: enabled }) }, "toggle", data => data.id === id && data.active === enabled);
  }

  return <div className={styles.root} data-queue-admin-state={uncertain ? "unconfirmed" : loaded ? "ready" : "loading"}>
    <div className={styles.heading}><strong>{c("Queue administration", "Kuyruk yönetimi")}</strong>
      <button type="button" className="icon-button" aria-label={c("Refresh queues", "Kuyrukları yenile")} disabled={busy !== null || uncertain} onClick={() => void load()}>{busy === "load" ? <LoaderCircle size={13}/> : <RefreshCw size={13}/>}</button></div>
    <div className={styles.columns}>
      <div className={styles.list}>{queues.map(queue => <button key={queue.id} type="button" className="secondary-button" aria-pressed={active?.id === queue.id} disabled={locked} onClick={() => setSelected(queue.id)}><span>{queue.name}</span><small>{queue.memberships.length}</small></button>)}</div>
      {active ? <section className={`card ${styles.detail}`} aria-label={c("Selected queue", "Seçili kuyruk")}>
        <div className={styles.heading}><span><strong>{active.name}</strong><small className="cell-sub">{active.key} · {active.defaultSlaMinutes ?? "—"}m</small></span>
          <button type="button" className="icon-button" disabled={locked} aria-label={active.active ? c("Disable queue", "Kuyruğu kapat") : c("Enable queue", "Kuyruğu aç")} onClick={toggle}><Power size={13}/></button></div>
        {active.memberships.map(item => <div key={item.id} className={styles.member} data-queue-member-id={item.id}>
          <span><UsersRound size={12}/> {item.displayName} · {item.role === "OWNER" ? c("Owner", "Sahip") : c("Agent", "Temsilci")}</span>
          <button type="button" className="icon-button" disabled={locked} aria-label={c(`Remove ${item.displayName}`, `${item.displayName} adlı üyeyi kaldır`)} onClick={() => remove(item)}><Trash2 size={12}/></button>
        </div>)}
      </section> : null}
    </div>
    <details><summary>{c("Create queue", "Kuyruk oluştur")}</summary><div className={styles.form}>
      <label>{c("Queue key", "Kuyruk anahtarı")}<input aria-label={c("Queue key", "Kuyruk anahtarı")} maxLength={40} disabled={locked} value={key} onChange={e => setKey(e.target.value)}/></label>
      <label>{c("Queue name", "Kuyruk adı")}<input aria-label={c("Queue name", "Kuyruk adı")} disabled={locked} value={name} onChange={e => setName(e.target.value)}/></label>
      <label>{c("SLA minutes", "SLA dakika")}<input aria-label={c("SLA minutes", "SLA dakika")} type="number" min={15} max={10080} disabled={locked} value={sla} onChange={e => setSla(e.target.value)}/></label>
      <label>{c("Queue owner", "Kuyruk sahibi")}<select aria-label={c("Queue owner", "Kuyruk sahibi")} disabled={locked} value={owner} onChange={e => setOwner(e.target.value)}>{candidates.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
      <button type="button" className="secondary-button" disabled={locked} onClick={createQueue}><Plus size={12}/> {c("Create", "Oluştur")}</button>
    </div></details>
    {active ? <details><summary>{c("Add or update member", "Üye ekle veya güncelle")}</summary><div className={styles.form}>
      <label>{c("Queue member", "Kuyruk üyesi")}<select aria-label={c("Queue member", "Kuyruk üyesi")} disabled={locked || !active.active} value={member} onChange={e => setMember(e.target.value)}>{candidates.map(u => <option key={u.id} value={u.id}>{u.displayName} · {u.role}</option>)}</select></label>
      <label>{c("Queue role", "Kuyruk rolü")}<select aria-label={c("Queue role", "Kuyruk rolü")} disabled={locked || !active.active} value={memberRole} onChange={e => setMemberRole(e.target.value)}><option value="AGENT">{c("Agent", "Temsilci")}</option><option value="OWNER">{c("Owner", "Sahip")}</option></select></label>
      <button type="button" className="secondary-button" disabled={locked || !active.active || !member} onClick={() => void mutate(`/api/hr-service/queues/${encodeURIComponent(active.id)}/members`, { method: "POST", headers, body: JSON.stringify({ userId: member, role: memberRole }) }, "member", data => data.queueId === active.id && data.userId === member && data.role === memberRole)}><Plus size={12}/> {c("Save", "Kaydet")}</button>
    </div></details> : null}
    {error ? <p role="alert" className="comp-decision-error">{error}</p> : null}
    {uncertain ? <button type="button" className="secondary-button" onClick={() => window.location.reload()}>{c("Reload page", "Sayfayı yenile")}</button> : null}
  </div>;
}
