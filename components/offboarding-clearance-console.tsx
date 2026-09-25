"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Laptop2, Plus, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingProcessRow } from "@/lib/offboarding-live-data";

const assetTransitions: Record<string, string[]> = {
  PENDING: ["RETURNED", "DAMAGED", "LOST", "WRITTEN_OFF"],
  DAMAGED: ["RETURNED", "WRITTEN_OFF"],
  LOST: ["RETURNED", "WRITTEN_OFF"]
};
const accessTransitions: Record<string, string[]> = {
  PENDING: ["SCHEDULED", "REVOKED", "EXCEPTION"],
  SCHEDULED: ["REVOKED", "EXCEPTION"]
};

type Editor = { kind: "asset" | "access"; processId: string; id: string; status: string; note: string; scheduledAt: string } | null;
type AssetDraft = { tag: string; type: string; serial: string };
type AccessDraft = { system: string; account: string };

export function OffboardingClearanceConsole({ processes }: { processes: OffboardingProcessRow[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [assetDrafts, setAssetDrafts] = useState<Record<string, AssetDraft>>({});
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessDraft>>({});

  async function mutate(key: string, url: string, body: Record<string, unknown>, success: string) {
    setPending(key); setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || c("Operation failed.", "İşlem başarısız."));
      setNotice(success); setEditor(null); router.refresh(); return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : c("Operation failed.", "İşlem başarısız.")); return false;
    } finally { setPending(null); }
  }

  async function addAsset(processId: string) {
    const draft = assetDrafts[processId] ?? { tag: "", type: "", serial: "" };
    if (!draft.tag.trim() || !draft.type.trim()) return setNotice(c("Asset tag and type are required.", "Varlık etiketi ve türü zorunludur."));
    const ok = await mutate(`asset-add-${processId}`, `/api/offboarding/processes/${processId}/assets`, { assetTag: draft.tag, assetType: draft.type, serialNumber: draft.serial || undefined }, c("Asset return control registered.", "Varlık iade kontrolü kaydedildi."));
    if (ok) setAssetDrafts((current) => ({ ...current, [processId]: { tag: "", type: "", serial: "" } }));
  }

  async function addAccess(processId: string) {
    const draft = accessDrafts[processId] ?? { system: "", account: "" };
    if (!draft.system.trim()) return setNotice(c("System name is required.", "Sistem adı zorunludur."));
    const ok = await mutate(`access-add-${processId}`, `/api/offboarding/processes/${processId}/access`, { systemName: draft.system, accountId: draft.account || undefined }, c("Access revocation control registered.", "Erişim iptal kontrolü kaydedildi."));
    if (ok) setAccessDrafts((current) => ({ ...current, [processId]: { system: "", account: "" } }));
  }

  function requestAsset(processId: string, id: string, status: string) {
    if (["DAMAGED", "LOST", "WRITTEN_OFF"].includes(status)) return setEditor({ kind: "asset", processId, id, status, note: "", scheduledAt: "" });
    void mutate(`asset-${id}`, `/api/offboarding/processes/${processId}/assets/${id}/status`, { status }, c("Asset custody status updated.", "Varlık teslim durumu güncellendi."));
  }
  function requestAccess(processId: string, id: string, status: string) {
    if (status === "EXCEPTION" || status === "SCHEDULED") return setEditor({ kind: "access", processId, id, status, note: "", scheduledAt: "" });
    void mutate(`access-${id}`, `/api/offboarding/processes/${processId}/access/${id}/status`, { status }, c("Access revocation status updated.", "Erişim iptal durumu güncellendi."));
  }
  async function confirmEditor() {
    if (!editor) return;
    if (editor.kind === "asset") {
      if (!editor.note.trim()) return;
      await mutate(`asset-${editor.id}`, `/api/offboarding/processes/${editor.processId}/assets/${editor.id}/status`, { status: editor.status, conditionNote: editor.note.trim() }, c("Asset exception evidence recorded.", "Varlık istisna kanıtı kaydedildi."));
    } else {
      if (editor.status === "EXCEPTION" && !editor.note.trim()) return;
      if (editor.status === "SCHEDULED" && !editor.scheduledAt) return;
      await mutate(`access-${editor.id}`, `/api/offboarding/processes/${editor.processId}/access/${editor.id}/status`, { status: editor.status, ...(editor.note.trim() ? { exceptionReason: editor.note.trim() } : {}), ...(editor.scheduledAt ? { scheduledAt: new Date(editor.scheduledAt).toISOString() } : {}) }, c("Access control transition recorded.", "Erişim kontrolü geçişi kaydedildi."));
    }
  }

  return <section className="card" style={{ display: "grid", gap: 14 }}>
    <div className="off-head"><div><span className="section-kicker">{c("Custody & access clearance", "Varlık ve erişim ilişik kesme")}</span><h3>{c("Operational exit controls", "Operasyonel çıkış kontrolleri")}</h3><p>{c("Assets and system access are first-class exit gates. Exceptional closure requires explicit human evidence and remains auditable.", "Varlıklar ve sistem erişimleri birinci sınıf çıkış kontrolleridir. İstisnai kapanış açık insan gerekçesi ister ve denetlenebilir kalır.")}</p></div><ShieldCheck size={18}/></div>
    {notice ? <div className="off-ops-notice"><ShieldCheck size={14}/>{notice}</div> : null}
    {processes.map((process) => {
      const assetDraft = assetDrafts[process.id] ?? { tag: "", type: "", serial: "" };
      const accessDraft = accessDrafts[process.id] ?? { system: "", account: "" };
      return <article key={process.id} style={{ border: "1px solid var(--line-strong)", borderRadius: 12, padding: 12, display: "grid", gap: 12 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><strong>{process.employee}</strong><small className="cell-sub">{process.employeeNumber} · {process.lastWorkingDate}</small></div><span>{process.assetsOpen} {c("assets open", "varlık açık")} · {process.accessOpen} {c("access open", "erişim açık")}</span></header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 12 }}>
          <div style={{ display: "grid", gap: 8 }}><div className="off-form-title"><Laptop2 size={16}/><div><strong>{c("Company assets", "Şirket varlıkları")}</strong><small>{c("Returned or explicitly written off before termination.", "Sonlandırmadan önce iade veya açık kayıttan düşme gerekir.")}</small></div></div>
            {process.assets.map((asset) => <div key={asset.id} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 9, display: "grid", gap: 6 }}><div><strong>{asset.assetTag} · {asset.assetType}</strong><small className="cell-sub">{asset.serialNumber ?? c("No serial", "Seri no yok")} · {asset.status}</small></div><div className="off-task-actions">{(assetTransitions[asset.rawStatus] ?? []).map((status) => <button type="button" key={status} disabled={Boolean(pending)} onClick={() => requestAsset(process.id, asset.id, status)}>{status.replaceAll("_", " ")}</button>)}</div>{asset.conditionNote ? <small>{asset.conditionNote}</small> : null}</div>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 6 }}><input placeholder={c("Asset tag", "Varlık etiketi")} value={assetDraft.tag} onChange={(e) => setAssetDrafts((s) => ({ ...s, [process.id]: { ...assetDraft, tag: e.target.value } }))}/><input placeholder={c("Type", "Tür")} value={assetDraft.type} onChange={(e) => setAssetDrafts((s) => ({ ...s, [process.id]: { ...assetDraft, type: e.target.value } }))}/><input placeholder={c("Serial", "Seri no")} value={assetDraft.serial} onChange={(e) => setAssetDrafts((s) => ({ ...s, [process.id]: { ...assetDraft, serial: e.target.value } }))}/><button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={() => void addAsset(process.id)}><Plus size={13}/>{c("Add", "Ekle")}</button></div>
          </div>
          <div style={{ display: "grid", gap: 8 }}><div className="off-form-title"><KeyRound size={16}/><div><strong>{c("Logical access", "Mantıksal erişim")}</strong><small>{c("Revoked or explicitly excepted before termination.", "Sonlandırmadan önce iptal veya açık istisna gerekir.")}</small></div></div>
            {process.accessControls.map((access) => <div key={access.id} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 9, display: "grid", gap: 6 }}><div><strong>{access.systemName}</strong><small className="cell-sub">{access.accountId ?? c("Default account", "Varsayılan hesap")} · {access.status}</small></div><div className="off-task-actions">{(accessTransitions[access.rawStatus] ?? []).map((status) => <button type="button" key={status} disabled={Boolean(pending)} onClick={() => requestAccess(process.id, access.id, status)}>{status}</button>)}</div>{access.exceptionReason ? <small>{access.exceptionReason}</small> : null}</div>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6 }}><input placeholder={c("System", "Sistem")} value={accessDraft.system} onChange={(e) => setAccessDrafts((s) => ({ ...s, [process.id]: { ...accessDraft, system: e.target.value } }))}/><input placeholder={c("Account", "Hesap")} value={accessDraft.account} onChange={(e) => setAccessDrafts((s) => ({ ...s, [process.id]: { ...accessDraft, account: e.target.value } }))}/><button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={() => void addAccess(process.id)}><Plus size={13}/>{c("Add", "Ekle")}</button></div>
          </div>
        </div>
        {editor?.processId === process.id ? <div style={{ borderTop: "1px dashed var(--line-strong)", paddingTop: 10, display: "grid", gap: 7 }}><strong>{editor.kind === "asset" ? c("Record asset evidence", "Varlık kanıtını kaydet") : editor.status === "SCHEDULED" ? c("Schedule access revocation", "Erişim iptalini planla") : c("Record access exception", "Erişim istisnasını kaydet")}</strong>{editor.status === "SCHEDULED" ? <input type="datetime-local" value={editor.scheduledAt} onChange={(e) => setEditor({ ...editor, scheduledAt: e.target.value })}/> : <textarea maxLength={editor.kind === "asset" ? 500 : 1000} value={editor.note} onChange={(e) => setEditor({ ...editor, note: e.target.value })} placeholder={c("Required governance reason", "Zorunlu yönetişim gerekçesi")}/>}<div className="off-task-actions"><button type="button" disabled={Boolean(pending) || (editor.status === "SCHEDULED" ? !editor.scheduledAt : !editor.note.trim())} onClick={() => void confirmEditor()}>{c("Confirm", "Onayla")}</button><button type="button" disabled={Boolean(pending)} onClick={() => setEditor(null)}>{c("Cancel", "Vazgeç")}</button></div></div> : null}
      </article>;
    })}
  </section>;
}
