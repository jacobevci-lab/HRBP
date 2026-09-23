"use client";

import { Download, FileUp, LoaderCircle, LockKeyhole, ShieldCheck, Trash2, UserRoundPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Grant = { id: string; principalType: string; principalId: string; permission: string; purpose: string | null; expiresAt: string | null; expired?: boolean };
type VersionCreateResponse = { error?: string; data?: { id: string }; upload?: { endpoint?: string } };

type Props = {
  documentId: string;
  downloadReady: boolean;
  legalHold: boolean;
  retentionUntil: string | null;
  activeGrants: number;
  canWrite: boolean;
  canGrant: boolean;
  canGovern: boolean;
  canSetLegalHold: boolean;
};

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function DocumentVaultActions(props: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [principalType, setPrincipalType] = useState("USER");
  const [principalId, setPrincipalId] = useState("");
  const [permission, setPermission] = useState("DOWNLOAD");
  const [purpose, setPurpose] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [retentionUntil, setRetentionUntil] = useState(props.retentionUntil?.slice(0, 10) ?? "");

  async function json(response: Response) {
    try { return await response.json() as { error?: string; data?: unknown }; }
    catch { return {} as { error?: string; data?: unknown }; }
  }

  async function uploadVersion(file: File) {
    setBusy("upload"); setError(null); setMessage(null);
    try {
      const bytes = await file.arrayBuffer();
      const digest = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
      const metadataResponse = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Governed document version upload" },
        body: JSON.stringify({ contentHash: digest, contentType: file.type || "application/octet-stream", sizeBytes: file.size })
      });
      const metadata = await metadataResponse.json() as VersionCreateResponse;
      if (!metadataResponse.ok || !metadata.data?.id) throw new Error(metadata.error || c("Document version could not be reserved.", "Doküman sürümü ayrılamadı."));
      const uploadEndpoint = metadata.upload?.endpoint || `/api/documents/${encodeURIComponent(props.documentId)}/versions/${encodeURIComponent(metadata.data.id)}/upload`;
      const uploadResponse = await fetch(uploadEndpoint, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "x-content-sha256": digest, "x-purpose": "Private vault upload" },
        body: bytes
      });
      const uploadValue = await json(uploadResponse);
      if (!uploadResponse.ok) throw new Error(uploadValue.error || c("Private vault upload failed.", "Özel kasa yüklemesi başarısız oldu."));
      setMessage(c("Version uploaded. Malware scan is pending; download remains blocked until CLEAN.", "Sürüm yüklendi. Zararlı yazılım taraması bekleniyor; CLEAN olana kadar indirme kapalıdır."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Document upload failed.", "Doküman yüklemesi başarısız oldu."));
    } finally { setBusy(null); }
  }

  async function loadGrants() {
    if (!props.canGrant) return;
    setBusy("access-load"); setError(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}/access-grants`, { cache: "no-store" });
      const value = await json(response);
      if (!response.ok) throw new Error(value.error || c("Access grants could not be loaded.", "Erişim yetkileri yüklenemedi."));
      setGrants((value.data as Grant[]) ?? []); setShowAccess(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Access grants could not be loaded.", "Erişim yetkileri yüklenemedi.")); }
    finally { setBusy(null); }
  }

  async function createGrant() {
    if (!principalId.trim()) return setError(c("Principal ID is required.", "Principal ID zorunludur."));
    setBusy("grant"); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}/access-grants`, {
        method: "POST", headers: { "content-type": "application/json", "x-purpose": "Document access delegation" },
        body: JSON.stringify({ principalType, principalId: principalId.trim(), permission, purpose: purpose.trim() || undefined, expiresAt: expiresAt || null })
      });
      const value = await json(response);
      if (!response.ok) throw new Error(value.error || c("Access could not be granted.", "Erişim yetkisi verilemedi."));
      setPrincipalId(""); setPurpose(""); setExpiresAt(""); setMessage(c("Access grant saved.", "Erişim yetkisi kaydedildi."));
      await loadGrants(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Access could not be granted.", "Erişim yetkisi verilemedi.")); }
    finally { setBusy(null); }
  }

  async function revokeGrant(grantId: string) {
    setBusy(`revoke:${grantId}`); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}/access-grants/${encodeURIComponent(grantId)}`, { method: "DELETE", headers: { "x-purpose": "Document access revocation" } });
      const value = await json(response);
      if (!response.ok) throw new Error(value.error || c("Access could not be revoked.", "Erişim yetkisi kaldırılamadı."));
      setGrants((current) => current.filter((item) => item.id !== grantId)); setMessage(c("Access revoked.", "Erişim kaldırıldı.")); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Access could not be revoked.", "Erişim yetkisi kaldırılamadı.")); }
    finally { setBusy(null); }
  }

  async function governance(payload: { legalHold?: boolean; retentionUntil?: string | null }) {
    setBusy("governance"); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}/governance`, { method: "PATCH", headers: { "content-type": "application/json", "x-purpose": "Document retention governance" }, body: JSON.stringify(payload) });
      const value = await json(response);
      if (!response.ok) throw new Error(value.error || c("Document governance could not be updated.", "Doküman yönetişimi güncellenemedi."));
      setMessage(c("Document governance updated.", "Doküman yönetişimi güncellendi.")); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Document governance could not be updated.", "Doküman yönetişimi güncellenemedi.")); }
    finally { setBusy(null); }
  }

  async function deleteDocument() {
    if (!window.confirm(c("Logically delete this document? Retention and legal hold rules still apply.", "Bu doküman mantıksal olarak silinsin mi? Saklama ve legal hold kuralları uygulanmaya devam eder."))) return;
    setBusy("delete"); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(props.documentId)}`, { method: "DELETE", headers: { "x-purpose": "Retention-governed document deletion" } });
      const value = await json(response);
      if (!response.ok) throw new Error(value.error || c("Document could not be deleted.", "Doküman silinemedi."));
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c("Document could not be deleted.", "Doküman silinemedi.")); }
    finally { setBusy(null); }
  }

  return <div style={{ display: "grid", gap: 7, minWidth: 180 }}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {props.downloadReady ? <a className="secondary-button" href={`/api/documents/${encodeURIComponent(props.documentId)}/download`}><Download size={13}/> {c("Download", "İndir")}</a> : <span className="matrix-note">{c("Scan required", "Tarama gerekli")}</span>}
      {props.canWrite ? <label className="secondary-button" style={{ cursor: busy ? "wait" : "pointer" }}><FileUp size={13}/> {busy === "upload" ? c("Uploading…", "Yükleniyor…") : c("New version", "Yeni sürüm")}<input type="file" hidden disabled={!!busy} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadVersion(file); }}/></label> : null}
      {props.canGrant ? <button type="button" className="secondary-button" onClick={() => showAccess ? setShowAccess(false) : void loadGrants()} disabled={busy === "access-load"}>{busy === "access-load" ? <LoaderCircle size={13}/> : <UserRoundPlus size={13}/>} {c("Access", "Erişim")} ({props.activeGrants})</button> : null}
      {props.canSetLegalHold ? <button type="button" className="secondary-button" onClick={() => void governance({ legalHold: !props.legalHold })} disabled={busy === "governance"}><LockKeyhole size={13}/> {props.legalHold ? c("Release hold", "Hold kaldır") : "Legal hold"}</button> : null}
    </div>
    {props.canGovern ? <details><summary style={{ cursor: "pointer", fontSize: 12 }}><ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>{c("Retention controls", "Saklama kontrolleri")}</summary><div style={{ display: "grid", gap: 6, marginTop: 7 }}><input type="date" value={retentionUntil} onChange={(event) => setRetentionUntil(event.target.value)}/><div style={{ display: "flex", gap: 6 }}><button type="button" className="secondary-button" disabled={busy === "governance"} onClick={() => void governance({ retentionUntil: retentionUntil || null })}>{c("Save retention", "Saklamayı kaydet")}</button><button type="button" className="secondary-button" disabled={busy === "delete" || props.legalHold} onClick={() => void deleteDocument()}>{busy === "delete" ? <LoaderCircle size={13}/> : <Trash2 size={13}/>} {c("Delete", "Sil")}</button></div></div></details> : null}
    {showAccess && props.canGrant ? <div className="card" style={{ padding: 10, display: "grid", gap: 6 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><select value={principalType} onChange={(event) => setPrincipalType(event.target.value)}><option value="USER">USER</option><option value="EMPLOYMENT">EMPLOYMENT</option></select><select value={permission} onChange={(event) => setPermission(event.target.value)}><option value="READ">READ</option><option value="DOWNLOAD">DOWNLOAD</option><option value="SIGN">SIGN</option></select></div><input value={principalId} onChange={(event) => setPrincipalId(event.target.value)} placeholder={c("User / employment ID", "Kullanıcı / istihdam ID")}/><input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder={c("Purpose", "Amaç")}/><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)}/><button type="button" className="secondary-button" onClick={() => void createGrant()} disabled={busy === "grant"}>{busy === "grant" ? <LoaderCircle size={13}/> : <UserRoundPlus size={13}/>} {c("Grant", "Yetki ver")}</button>{grants.length ? <div style={{ display: "grid", gap: 5 }}>{grants.map((grant) => <div key={grant.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 11 }}><span>{grant.permission} · {grant.principalType}:{grant.principalId}{grant.expired ? ` · ${c("expired", "süresi doldu")}` : ""}</span><button type="button" className="icon-button" title={c("Revoke", "Kaldır")} onClick={() => void revokeGrant(grant.id)} disabled={busy === `revoke:${grant.id}`}><X size={12}/></button></div>)}</div> : null}</div> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}{message ? <small>{message}</small> : null}
  </div>;
}
