"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, KeyRound, Laptop2, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingProcessRow } from "@/lib/offboarding-live-data";

type Notice = { kind: "ok" | "error"; message: string } | null;
type AssetDraft = { assetTag: string; assetType: string; serialNumber: string };
type AccessDraft = { systemName: string; accountId: string };
type AssetEditor = { assetId: string; status: string; note: string } | null;
type AccessEditor = { accessId: string; status: string; scheduledAt: string; reason: string } | null;

const assetTransitions: Record<string, string[]> = {
  PENDING: ["RETURNED", "DAMAGED", "LOST", "WRITTEN_OFF"],
  DAMAGED: ["RETURNED", "WRITTEN_OFF"],
  LOST: ["RETURNED", "WRITTEN_OFF"]
};
const accessTransitions: Record<string, string[]> = {
  PENDING: ["SCHEDULED", "REVOKED", "EXCEPTION"],
  SCHEDULED: ["REVOKED", "EXCEPTION"]
};
const assetTerminal = new Set(["RETURNED", "WRITTEN_OFF"]);
const accessTerminal = new Set(["REVOKED", "EXCEPTION"]);
const assetReasonStatuses = new Set(["DAMAGED", "LOST", "WRITTEN_OFF"]);

function englishLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function OffboardingClearanceConsole({ processes }: { processes: OffboardingProcessRow[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const statusLabel = (value: string) => tr ? ({
    PENDING: "Bekliyor", RETURNED: "İade edildi", DAMAGED: "Hasarlı", LOST: "Kayıp", WRITTEN_OFF: "Kayıttan düşüldü",
    SCHEDULED: "Planlandı", REVOKED: "Kapatıldı", EXCEPTION: "İstisna"
  } as Record<string, string>)[value] ?? englishLabel(value) : englishLabel(value);

  const [processId, setProcessId] = useState(processes[0]?.id ?? "");
  const [assetDraft, setAssetDraft] = useState<AssetDraft>({ assetTag: "", assetType: "", serialNumber: "" });
  const [accessDraft, setAccessDraft] = useState<AccessDraft>({ systemName: "", accountId: "" });
  const [assetEditor, setAssetEditor] = useState<AssetEditor>(null);
  const [accessEditor, setAccessEditor] = useState<AccessEditor>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const process = processes.find((row) => row.id === processId) ?? processes[0];

  useEffect(() => {
    if (processes.length && !processes.some((row) => row.id === processId)) setProcessId(processes[0].id);
  }, [processId, processes]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const assetId = search.get("asset");
    const accessId = search.get("access");
    const linkedProcessId = search.get("process");
    const matched = assetId
      ? processes.find((row) => row.assets.some((asset) => asset.id === assetId))
      : accessId
        ? processes.find((row) => row.accessControls.some((access) => access.id === accessId))
        : linkedProcessId
          ? processes.find((row) => row.id === linkedProcessId)
          : undefined;
    if (matched) setProcessId(matched.id);
    const anchor = assetId ? `offboarding-asset-${assetId}` : accessId ? `offboarding-access-${accessId}` : null;
    if (!anchor) return;
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timer);
  }, [processes]);

  async function call(url: string, init: RequestInit, success: string) {
    setBusy(url);
    setNotice(null);
    try {
      const response = await fetch(url, { credentials: "same-origin", ...init });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || c("Operation failed.", "İşlem başarısız."));
      setNotice({ kind: "ok", message: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Operation failed.", "İşlem başarısız.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function registerAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!process) return;
    const url = `/api/offboarding/processes/${encodeURIComponent(process.id)}/assets`;
    const ok = await call(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetTag: assetDraft.assetTag, assetType: assetDraft.assetType, serialNumber: assetDraft.serialNumber || undefined })
    }, c("Asset custody control registered.", "Varlık teslim kontrolü kaydedildi."));
    if (ok) setAssetDraft({ assetTag: "", assetType: "", serialNumber: "" });
  }

  async function registerAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!process) return;
    const url = `/api/offboarding/processes/${encodeURIComponent(process.id)}/access`;
    const ok = await call(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemName: accessDraft.systemName, accountId: accessDraft.accountId || undefined })
    }, c("Access revocation control registered.", "Erişim kapatma kontrolü kaydedildi."));
    if (ok) setAccessDraft({ systemName: "", accountId: "" });
  }

  async function transitionAsset(assetId: string, status: string, note?: string) {
    if (!process) return;
    const ok = await call(`/api/offboarding/processes/${encodeURIComponent(process.id)}/assets/${encodeURIComponent(assetId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, ...(note ? { conditionNote: note } : {}) })
    }, c(`Asset moved to ${statusLabel(status)}.`, `Varlık ${statusLabel(status)} durumuna alındı.`));
    if (ok) setAssetEditor(null);
  }

  function requestAssetTransition(assetId: string, status: string) {
    if (assetReasonStatuses.has(status)) {
      setAssetEditor({ assetId, status, note: "" });
      return;
    }
    void transitionAsset(assetId, status);
  }

  async function transitionAccess(accessId: string, status: string, scheduledAt?: string, reason?: string) {
    if (!process) return;
    const ok = await call(`/api/offboarding/processes/${encodeURIComponent(process.id)}/access/${encodeURIComponent(accessId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, ...(scheduledAt ? { scheduledAt } : {}), ...(reason ? { exceptionReason: reason } : {}) })
    }, c(`Access control moved to ${statusLabel(status)}.`, `Erişim kontrolü ${statusLabel(status)} durumuna alındı.`));
    if (ok) setAccessEditor(null);
  }

  function requestAccessTransition(accessId: string, status: string) {
    if (status === "SCHEDULED" || status === "EXCEPTION") {
      setAccessEditor({ accessId, status, scheduledAt: "", reason: "" });
      return;
    }
    void transitionAccess(accessId, status);
  }

  if (!processes.length || !process) return null;

  return <section className="card off-ops-console">
    <div className="off-ops-head">
      <div>
        <span className="section-kicker">{c("Clearance execution", "İlişik kesme uygulaması")}</span>
        <h3>{c("Asset custody & access revocation", "Varlık teslimi ve erişim kapatma")}</h3>
        <p>{c("Operate the controls that feed the final exit-readiness gate. Written-off assets and access exceptions require explicit evidence-bearing reasons.", "Nihai çıkış kontrolünü besleyen adımları yönetin. Kayıttan düşülen varlıklar ve erişim istisnaları açık, kanıt niteliğinde gerekçe gerektirir.")}</p>
      </div>
      <span><ShieldCheck size={15}/> {c("Readiness-linked", "Çıkış kontrolüne bağlı")}</span>
    </div>

    <label style={{ display: "grid", gap: 6, maxWidth: 680 }}>
      {c("Separation process", "Ayrılış süreci")}
      <select value={process.id} onChange={(event) => { setProcessId(event.target.value); setAssetEditor(null); setAccessEditor(null); }}>
        {processes.map((row) => <option value={row.id} key={row.id}>{row.employeeNumber} · {row.employee} · {row.lastWorkingDate}</option>)}
      </select>
    </label>

    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
      <div className="off-create-form">
        <div className="off-form-title"><Laptop2 size={18}/><div><strong>{c("Company assets", "Şirket varlıkları")}</strong><small>{c("Returned or formally written off before exit closure.", "Çıkış kapanışından önce iade edilir veya resmi olarak kayıttan düşülür.")}</small></div></div>
        <form onSubmit={registerAsset} style={{ display: "grid", gap: 8 }}>
          <div className="off-form-row">
            <label>{c("Asset tag", "Varlık etiketi")}<input maxLength={100} required value={assetDraft.assetTag} onChange={(event) => setAssetDraft({ ...assetDraft, assetTag: event.target.value })}/></label>
            <label>{c("Asset type", "Varlık türü")}<input maxLength={120} required value={assetDraft.assetType} onChange={(event) => setAssetDraft({ ...assetDraft, assetType: event.target.value })}/></label>
          </div>
          <label>{c("Serial number", "Seri numarası")}<input maxLength={160} value={assetDraft.serialNumber} onChange={(event) => setAssetDraft({ ...assetDraft, serialNumber: event.target.value })}/></label>
          <button className="secondary-button" type="submit" disabled={Boolean(busy) || !assetDraft.assetTag.trim() || !assetDraft.assetType.trim()}>{c("Register asset", "Varlığı kaydet")}</button>
        </form>
        <div className="off-task-list">
          {process.assets.length ? process.assets.map((asset) => <div id={`offboarding-asset-${asset.id}`} key={asset.id}>
            <span className={assetTerminal.has(asset.rawStatus) ? "done" : asset.rawStatus === "LOST" || asset.rawStatus === "DAMAGED" ? "blocked" : "pending"}/>
            <div><strong>{asset.assetTag} · {asset.assetType}</strong><small>{asset.serialNumber || c("No serial", "Seri no yok")} · {statusLabel(asset.rawStatus)}{asset.conditionNote ? ` · ${asset.conditionNote}` : ""}</small></div>
            {assetTerminal.has(asset.rawStatus) ? <span>{statusLabel(asset.rawStatus)}</span> : <div className="off-task-actions">{(assetTransitions[asset.rawStatus] ?? []).map((next) => <button type="button" key={next} disabled={Boolean(busy)} onClick={() => requestAssetTransition(asset.id, next)}>{statusLabel(next)}</button>)}</div>}
            {assetEditor?.assetId === asset.id ? <div style={{ gridColumn: "1 / -1", display: "grid", gap: 7, paddingTop: 8 }}><textarea maxLength={500} autoFocus value={assetEditor.note} onChange={(event) => setAssetEditor({ ...assetEditor, note: event.target.value })} placeholder={c("Document condition, loss or write-off justification.", "Hasar, kayıp veya kayıttan düşme gerekçesini belgeleyin.")}/><div className="off-task-actions"><button type="button" disabled={Boolean(busy) || !assetEditor.note.trim()} onClick={() => void transitionAsset(asset.id, assetEditor.status, assetEditor.note.trim())}>{c("Confirm", "Onayla")}</button><button type="button" disabled={Boolean(busy)} onClick={() => setAssetEditor(null)}>{c("Cancel", "Vazgeç")}</button></div></div> : null}
          </div>) : <div className="off-empty">{c("No company asset registered for this exit.", "Bu ayrılış için şirket varlığı kaydedilmemiş.")}</div>}
        </div>
      </div>

      <div className="off-create-form">
        <div className="off-form-title"><KeyRound size={18}/><div><strong>{c("Logical access", "Mantıksal erişim")}</strong><small>{c("Schedule, revoke or explicitly except each governed account.", "Her kontrollü hesabı planlayın, kapatın veya açık istisna verin.")}</small></div></div>
        <form onSubmit={registerAccess} style={{ display: "grid", gap: 8 }}>
          <div className="off-form-row">
            <label>{c("System", "Sistem")}<input maxLength={160} required value={accessDraft.systemName} onChange={(event) => setAccessDraft({ ...accessDraft, systemName: event.target.value })}/></label>
            <label>{c("Account / identity", "Hesap / kimlik")}<input maxLength={240} value={accessDraft.accountId} onChange={(event) => setAccessDraft({ ...accessDraft, accountId: event.target.value })}/></label>
          </div>
          <button className="secondary-button" type="submit" disabled={Boolean(busy) || !accessDraft.systemName.trim()}>{c("Register access control", "Erişim kontrolünü kaydet")}</button>
        </form>
        <div className="off-task-list">
          {process.accessControls.length ? process.accessControls.map((access) => <div id={`offboarding-access-${access.id}`} key={access.id}>
            <span className={accessTerminal.has(access.rawStatus) ? "done" : "pending"}/>
            <div><strong>{access.systemName}</strong><small>{access.accountId || c("Account not specified", "Hesap belirtilmedi")} · {statusLabel(access.rawStatus)}{access.scheduledAt ? ` · ${c("Scheduled", "Plan")}: ${new Date(access.scheduledAt).toLocaleString(tr ? "tr-TR" : "en-GB")}` : ""}{access.exceptionReason ? ` · ${access.exceptionReason}` : ""}</small></div>
            {accessTerminal.has(access.rawStatus) ? <span>{statusLabel(access.rawStatus)}</span> : <div className="off-task-actions">{(accessTransitions[access.rawStatus] ?? []).map((next) => <button type="button" key={next} disabled={Boolean(busy)} onClick={() => requestAccessTransition(access.id, next)}>{statusLabel(next)}</button>)}</div>}
            {accessEditor?.accessId === access.id ? <div style={{ gridColumn: "1 / -1", display: "grid", gap: 7, paddingTop: 8 }}>{accessEditor.status === "SCHEDULED" ? <label>{c("Scheduled revocation", "Planlanan kapatma")}<input type="datetime-local" required value={accessEditor.scheduledAt} onChange={(event) => setAccessEditor({ ...accessEditor, scheduledAt: event.target.value })}/></label> : <textarea maxLength={1000} autoFocus value={accessEditor.reason} onChange={(event) => setAccessEditor({ ...accessEditor, reason: event.target.value })} placeholder={c("Document the approved access exception and compensating control.", "Onaylanan erişim istisnasını ve telafi edici kontrolü belgeleyin.")}/>}<div className="off-task-actions"><button type="button" disabled={Boolean(busy) || (accessEditor.status === "SCHEDULED" ? !accessEditor.scheduledAt : !accessEditor.reason.trim())} onClick={() => void transitionAccess(access.id, accessEditor.status, accessEditor.scheduledAt || undefined, accessEditor.reason.trim() || undefined)}>{c("Confirm", "Onayla")}</button><button type="button" disabled={Boolean(busy)} onClick={() => setAccessEditor(null)}>{c("Cancel", "Vazgeç")}</button></div></div> : null}
          </div>) : <div className="off-empty">{c("No logical access control registered for this exit.", "Bu ayrılış için mantıksal erişim kontrolü kaydedilmemiş.")}</div>}
        </div>
      </div>
    </div>
  </section>;
}
