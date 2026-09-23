"use client";

import { LoaderCircle, Plus, Power, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";

type Member = { id: string; userId: string; role: string; displayName: string; platformRole: string | null };
type Queue = { id: string; key: string; name: string; defaultSlaMinutes: number | null; active: boolean; memberships: Member[] };
type Candidate = { id: string; displayName: string; role: string };

export function HRServiceQueueAdmin() {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [queues, setQueues] = useState<Queue[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [key, setKey] = useState(""); const [name, setName] = useState(""); const [sla, setSla] = useState("1440");
  const [owner, setOwner] = useState(""); const [member, setMember] = useState(""); const [memberRole, setMemberRole] = useState("AGENT");
  const active = useMemo(() => queues.find((queue) => queue.id === selected) ?? queues[0] ?? null, [queues, selected]);

  async function load() {
    setBusy("load"); setError(null);
    try {
      const response = await fetch("/api/hr-service/queues", { cache: "no-store" });
      const value = await response.json() as { error?: string; data?: Queue[]; candidates?: Candidate[] };
      if (!response.ok) throw new Error(value.error || c("Queues could not be loaded.", "Kuyruklar yüklenemedi."));
      setQueues(value.data ?? []); setCandidates(value.candidates ?? []);
      if (!selected && value.data?.[0]) setSelected(value.data[0].id);
      if (!owner && value.candidates?.[0]) setOwner(value.candidates[0].id);
      if (!member && value.candidates?.[0]) setMember(value.candidates[0].id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Queues could not be loaded.", "Kuyruklar yüklenemedi.")); }
    finally { setBusy(null); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutate(url: string, init: RequestInit, loading: string) {
    setBusy(loading); setError(null);
    try {
      const response = await fetch(url, init);
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || c("Queue operation failed.", "Kuyruk işlemi başarısız."));
      await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Queue operation failed.", "Kuyruk işlemi başarısız.")); }
    finally { setBusy(null); }
  }

  return <div style={{ display: "grid", gap: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>{c("Queue administration", "Kuyruk yönetimi")}</strong><button type="button" className="icon-button" title={c("Refresh", "Yenile")} onClick={() => void load()}>{busy === "load" ? <LoaderCircle size={13}/> : <RefreshCw size={13}/>}</button></div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,.8fr) minmax(260px,1.2fr)", gap: 10 }}>
      <div style={{ display: "grid", gap: 6 }}>{queues.map((queue) => <button key={queue.id} type="button" className="secondary-button" style={{ justifyContent: "space-between", opacity: queue.active ? 1 : .55 }} onClick={() => setSelected(queue.id)}><span>{queue.name}</span><small>{queue.memberships.length}</small></button>)}</div>
      {active ? <div className="card" style={{ padding: 10, display: "grid", gap: 7 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span><strong>{active.name}</strong><small className="cell-sub">{active.key} · {active.defaultSlaMinutes ?? "—"}m</small></span><button type="button" className="icon-button" title={active.active ? c("Disable", "Kapat") : c("Enable", "Aç")} onClick={() => void mutate(`/api/hr-service/queues/${encodeURIComponent(active.id)}`, { method: "PATCH", headers: { "content-type": "application/json", "x-purpose": "HR service queue lifecycle" }, body: JSON.stringify({ active: !active.active }) }, `toggle:${active.id}`)}><Power size={13}/></button></div>{active.memberships.map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 12 }}><span><UsersRound size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>{item.displayName} · {item.role}</span><button type="button" className="icon-button" title={c("Remove", "Kaldır")} disabled={busy === `remove:${item.id}`} onClick={() => void mutate(`/api/hr-service/queues/${encodeURIComponent(active.id)}/members/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { "x-purpose": "HR service queue membership removal" } }, `remove:${item.id}`)}><Trash2 size={12}/></button></div>)}</div> : null}
    </div>
    <details><summary style={{ cursor: "pointer", fontSize: 12 }}>{c("Create queue", "Kuyruk oluştur")}</summary><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 1fr auto", gap: 6, marginTop: 7 }}><input value={key} onChange={(event) => setKey(event.target.value)} placeholder={c("Key", "Anahtar")}/><input value={name} onChange={(event) => setName(event.target.value)} placeholder={c("Name", "Ad")}/><input type="number" min={15} max={10080} value={sla} onChange={(event) => setSla(event.target.value)}/><select value={owner} onChange={(event) => setOwner(event.target.value)}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select><button type="button" className="secondary-button" onClick={() => void mutate("/api/hr-service/queues", { method: "POST", headers: { "content-type": "application/json", "x-purpose": "HR service queue governance" }, body: JSON.stringify({ key, name, defaultSlaMinutes: Number(sla), ownerUserId: owner }) }, "create")}><Plus size={12}/> {c("Create", "Oluştur")}</button></div></details>
    {active ? <details><summary style={{ cursor: "pointer", fontSize: 12 }}>{c("Add or update member", "Üye ekle veya güncelle")}</summary><div style={{ display: "flex", gap: 6, marginTop: 7 }}><select value={member} onChange={(event) => setMember(event.target.value)}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.role}</option>)}</select><select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option value="AGENT">AGENT</option><option value="OWNER">OWNER</option></select><button type="button" className="secondary-button" onClick={() => void mutate(`/api/hr-service/queues/${encodeURIComponent(active.id)}/members`, { method: "POST", headers: { "content-type": "application/json", "x-purpose": "HR service queue membership" }, body: JSON.stringify({ userId: member, role: memberRole }) }, "member")}><Plus size={12}/> {c("Save", "Kaydet")}</button></div></details> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
