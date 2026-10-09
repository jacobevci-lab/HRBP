"use client";

import { RefreshCw, ShieldCheck, UserRoundCog } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Role = "EMPLOYEE" | "MANAGER" | "HRBP" | "RECRUITER";
type Status = "DRAFT" | "ACTIVE" | "DISABLED";
type GroupOption = {
  id: string;
  displayName: string;
  externalId: string | null;
  _count: { members: number };
};
type Mapping = {
  id: string;
  groupId: string;
  role: Role;
  status: Status;
  createdById: string;
  activatedById: string | null;
  activatedAt: string | null;
  disabledById: string | null;
  disabledAt: string | null;
  attestation: string | null;
  createdAt: string;
  updatedAt: string;
  group: {
    displayName: string;
    externalId: string | null;
    _count: { members: number };
  };
};
type Payload = {
  data: Mapping[];
  options: { groups: GroupOption[]; roles: Role[] };
  permissions: { write: boolean };
};
type Preview = {
  group: { id: string; displayName: string };
  role: Role;
  memberCount: number;
  wouldChange: number;
  ambiguous: number;
  manualConflicts: number;
  samples: Array<{
    id: string;
    displayName: string;
    currentRole: string;
    projectedRole: string | null;
    conflict: "AMBIGUOUS" | "MANUAL" | null;
  }>;
};

export function ScimRoleMappingAdmin() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = useCallback((en: string, trValue: string) => tr ? trValue : en, [tr]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [groupId, setGroupId] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/scim-role-mappings", { cache: "no-store" });
    const body = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error || c("Role mappings could not be loaded.", "Rol eşlemeleri yüklenemedi."));
    setPayload(body);
    setGroupId((current) => current || body.options.groups[0]?.id || "");
    setRole((current) => body.options.roles.includes(current) ? current : body.options.roles[0] ?? "EMPLOYEE");
  }, [c]);

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : c("Role mappings could not be loaded.", "Rol eşlemeleri yüklenemedi.")));
  }, [load, c]);

  const mappedGroupIds = useMemo(() => new Set(payload?.data.map((item) => item.groupId) ?? []), [payload]);
  const availableGroups = useMemo(
    () => payload?.options.groups.filter((group) => !mappedGroupIds.has(group.id)) ?? [],
    [payload, mappedGroupIds]
  );

  useEffect(() => {
    if (groupId && availableGroups.some((group) => group.id === groupId)) return;
    setGroupId(availableGroups[0]?.id ?? "");
    setPreview(null);
  }, [availableGroups, groupId]);

  async function runPreview(targetGroupId = groupId, targetRole = role) {
    if (!targetGroupId) return;
    setBusy("preview"); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/settings/scim-role-mappings/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: targetGroupId, role: targetRole })
      });
      const body = await response.json() as { data?: Preview; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || c("Impact preview failed.", "Etki önizlemesi başarısız."));
      setPreview(body.data);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : c("Impact preview failed.", "Etki önizlemesi başarısız."));
    } finally { setBusy(null); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupId) return;
    setBusy("create"); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/settings/scim-role-mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, role })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Draft mapping could not be created.", "Taslak eşleme oluşturulamadı."));
      setPreview(null);
      setSuccess(c("Draft mapping created. Review impact before activation.", "Taslak eşleme oluşturuldu. Aktivasyondan önce etkiyi kontrol edin."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Draft mapping could not be created.", "Taslak eşleme oluşturulamadı."));
    } finally { setBusy(null); }
  }

  async function transition(mapping: Mapping, action: "activate" | "disable" | "reopen") {
    const note = (noteById[mapping.id] ?? "").trim();
    if (action === "activate" && note.length < 12) {
      setError(c("Activation attestation must be at least 12 characters.", "Aktivasyon teyidi en az 12 karakter olmalı."));
      return;
    }
    if (action !== "activate" && note.length < 8) {
      setError(c("Reason must be at least 8 characters.", "Gerekçe en az 8 karakter olmalı."));
      return;
    }
    setBusy(mapping.id); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/settings/scim-role-mappings/${encodeURIComponent(mapping.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          expectedUpdatedAt: mapping.updatedAt,
          ...(action === "activate" ? { attestation: note } : { reason: note })
        })
      });
      const body = await response.json() as { error?: string; data?: { reconciled?: { changed?: number } } };
      if (!response.ok) throw new Error(body.error || c("Mapping transition failed.", "Eşleme geçişi başarısız."));
      setNoteById((current) => ({ ...current, [mapping.id]: "" }));
      setSuccess(c(
        `Mapping updated. ${body.data?.reconciled?.changed ?? 0} account role(s) reconciled.`,
        `Eşleme güncellendi. ${body.data?.reconciled?.changed ?? 0} hesap rolü uzlaştırıldı.`
      ));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Mapping transition failed.", "Eşleme geçişi başarısız."));
    } finally { setBusy(null); }
  }

  const canWrite = payload?.permissions.write ?? false;

  return <section className="card settings-live-panel">
    <div className="settings-live-panel-head">
      <div>
        <span className="section-kicker">{c("Directory authorization", "Dizin yetkilendirmesi")}</span>
        <h3>{c("SCIM group → workforce role", "SCIM grup → iş gücü rolü")}</h3>
        <p>{c(
          "Map SCIM groups only to bounded workforce roles. Privileged admin, payroll, compensation, privacy, legal and security roles remain human-governed.",
          "SCIM gruplarını yalnızca sınırlı iş gücü rollerine eşleyin. Ayrıcalıklı admin, bordro, ücret, gizlilik, hukuk ve güvenlik rolleri insan kontrollü kalır."
        )}</p>
      </div>
      <button className="secondary-button compact" type="button" onClick={() => void load()} disabled={Boolean(busy)}>
        <RefreshCw size={14}/>{c("Refresh", "Yenile")}
      </button>
    </div>

    {error ? <div className="workflow-action-message error">{error}</div> : null}
    {success ? <div className="workflow-action-message success">{success}</div> : null}

    {canWrite ? <form onSubmit={create} className="local-account-create">
      <label><span>{c("SCIM group", "SCIM grubu")}</span>
        <select value={groupId} onChange={(event) => { setGroupId(event.target.value); setPreview(null); }} disabled={!availableGroups.length || Boolean(busy)}>
          {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName} · {group._count.members} {c("members", "üye")}</option>)}
        </select>
      </label>
      <label><span>{c("Workforce role", "İş gücü rolü")}</span>
        <select value={role} onChange={(event) => { setRole(event.target.value as Role); setPreview(null); }} disabled={Boolean(busy)}>
          {payload?.options.roles.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <button className="secondary-button compact" type="button" onClick={() => void runPreview()} disabled={!groupId || Boolean(busy)}>
        <ShieldCheck size={14}/>{busy === "preview" ? c("Checking…", "Kontrol…") : c("Preview impact", "Etkiyi önizle")}
      </button>
      <button className="primary-button compact" type="submit" disabled={!groupId || Boolean(busy)}>
        <UserRoundCog size={14}/>{busy === "create" ? c("Creating…", "Oluşturuluyor…") : c("Create draft", "Taslak oluştur")}
      </button>
    </form> : null}

    {preview ? <div className="settings-notification-counts">
      <div><small>{c("MEMBERS", "ÜYE")}</small><strong>{preview.memberCount}</strong></div>
      <div><small>{c("ROLE CHANGES", "ROL DEĞİŞİMİ")}</small><strong>{preview.wouldChange}</strong></div>
      <div><small>{c("AMBIGUOUS", "ÇAKIŞAN")}</small><strong>{preview.ambiguous}</strong></div>
      <div><small>{c("MANUAL CONFLICT", "MANUEL ÇAKIŞMA")}</small><strong>{preview.manualConflicts}</strong></div>
    </div> : null}

    <div className="settings-live-table-wrap">
      <table className="settings-live-table">
        <thead><tr><th>{c("Group", "Grup")}</th><th>{c("Role", "Rol")}</th><th>{c("Members", "Üye")}</th><th>{c("Status", "Durum")}</th><th>{c("Lifecycle evidence", "Yaşam döngüsü kanıtı")}</th><th>{c("Action", "İşlem")}</th></tr></thead>
        <tbody>
          {payload?.data.map((mapping) => <tr key={mapping.id}>
            <td><strong>{mapping.group.displayName}</strong><small>{mapping.group.externalId ?? mapping.groupId}</small></td>
            <td>{mapping.role.replaceAll("_", " ")}</td>
            <td>{mapping.group._count.members}</td>
            <td><span className={`settings-live-state ${mapping.status === "ACTIVE" ? "ok" : "attention"}`}>{mapping.status}</span></td>
            <td><small>{mapping.status === "ACTIVE" ? c("Activation attestation recorded", "Aktivasyon teyidi kayıtlı") : mapping.status === "DISABLED" ? c("Disabled with audit evidence", "Denetim kanıtıyla devre dışı") : c("Draft; no runtime effect", "Taslak; runtime etkisi yok")}</small></td>
            <td>
              {canWrite ? <div className="local-account-actions">
                <input
                  value={noteById[mapping.id] ?? ""}
                  onChange={(event) => setNoteById((current) => ({ ...current, [mapping.id]: event.target.value }))}
                  placeholder={mapping.status === "DRAFT" ? c("Activation attestation", "Aktivasyon teyidi") : c("Reason", "Gerekçe")}
                  maxLength={500}
                  disabled={busy === mapping.id}
                />
                {mapping.status === "DRAFT" ? <>
                  <button type="button" className="secondary-button compact" onClick={() => void runPreview(mapping.groupId, mapping.role)} disabled={Boolean(busy)}>{c("Impact", "Etki")}</button>
                  <button type="button" className="primary-button compact" onClick={() => void transition(mapping, "activate")} disabled={Boolean(busy)}>{c("Activate", "Aktifleştir")}</button>
                </> : mapping.status === "ACTIVE"
                  ? <button type="button" className="secondary-button compact" onClick={() => void transition(mapping, "disable")} disabled={Boolean(busy)}>{c("Disable", "Devre dışı")}</button>
                  : <button type="button" className="secondary-button compact" onClick={() => void transition(mapping, "reopen")} disabled={Boolean(busy)}>{c("Reopen draft", "Taslağı aç")}</button>}
              </div> : c("Read-only", "Salt okunur")}
            </td>
          </tr>)}
          {payload && !payload.data.length ? <tr><td colSpan={6} className="settings-live-empty">{c("No governed SCIM role mappings.", "Yönetişimli SCIM rol eşlemesi yok.")}</td></tr> : null}
        </tbody>
      </table>
    </div>
  </section>;
}
