"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import styles from "@/components/access-scope-admin.module.css";
import { useLocale } from "@/components/locale-provider";

type UserOption = { id: string; displayName: string; email: string | null };
type EmploymentOption = {
  id: string;
  person: { employeeNumber: string | null; givenName: string; familyName: string };
  position: { title: string; orgUnit: { name: string } } | null;
};
type Grant = {
  id: string;
  userId: string;
  employmentId: string;
  validFrom: string;
  validTo: string | null;
  user: UserOption | null;
  employment: EmploymentOption | null;
};
type Payload = {
  data: Grant[];
  options: { users: UserOption[]; employments: EmploymentOption[] };
  permissions: { write: boolean };
};

function employmentLabel(employment: EmploymentOption) {
  const person = `${employment.person.givenName} ${employment.person.familyName}`;
  const number = employment.person.employeeNumber ? ` · ${employment.person.employeeNumber}` : "";
  const role = employment.position ? ` · ${employment.position.title} / ${employment.position.orgUnit.name}` : "";
  return `${person}${number}${role}`;
}

export function AccessScopeAdmin() {
  const { locale } = useLocale();
  const c = useCallback((en: string, tr: string) => locale === "tr" ? tr : en, [locale]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [userId, setUserId] = useState("");
  const [employmentId, setEmploymentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/access-grants", { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || c("Access scope data could not be loaded.","Erişim kapsamı verisi yüklenemedi."));
    }
    const body = await response.json() as Payload;
    setPayload(body);
    setUserId((current) => current || body.options.users[0]?.id || "");
    setEmploymentId((current) => current || body.options.employments[0]?.id || "");
  }, [c]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : c("Access scope data could not be loaded.","Erişim kapsamı verisi yüklenemedi.")));
  }, [load, c]);

  const activeGrants = useMemo(() => {
    const now = Date.now();
    return payload?.data.filter((grant) => !grant.validTo || new Date(grant.validTo).getTime() >= now) ?? [];
  }, [payload]);

  async function addGrant() {
    if (!userId || !employmentId || !payload?.permissions.write) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/access-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, employmentId })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Population grant could not be saved.","Kapsam yetkisi kaydedilemedi."));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Population grant could not be saved.","Kapsam yetkisi kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(id: string) {
    if (!payload?.permissions.write) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/settings/access-grants/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Population grant could not be revoked.","Kapsam yetkisi geri alınamadı."));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Population grant could not be revoked.","Kapsam yetkisi geri alınamadı."));
    } finally {
      setBusy(false);
    }
  }

  const canWrite = payload?.permissions.write ?? false;
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  return <section className="card platform-panel">
    <div className="platform-head"><div><span className="section-kicker">{c("Relationship-aware access","İlişki farkındalıklı erişim")}</span><h3>{c("HRBP population scope","HRBP çalışan kapsamı")}</h3><p className={styles.panelCopy}>{c("Grant named HRBP users access to specific employment relationships. Self, direct-report, case-wall and tenant-wide scopes continue to be derived separately.","Belirli HRBP kullanıcılarına seçili istihdam ilişkileri için erişim verin. Kendi kaydı, doğrudan bağlı çalışan, vaka duvarı ve tenant-geneli kapsamları ayrı olarak türetilmeye devam eder.")}</p></div><UserRoundCog size={19}/></div>
    {error ? <div className={styles.error}>{error}</div> : null}
    {canWrite ? <div className={styles.form}>
      <label className={styles.field}><span>{c("HRBP user","HRBP kullanıcısı")}</span><select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy || !payload?.options.users.length}>{payload?.options.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}{user.email ? ` · ${user.email}` : ""}</option>)}</select></label>
      <label className={styles.field}><span>{c("Employment population member","Çalışan kapsamı üyesi")}</span><select value={employmentId} onChange={(event) => setEmploymentId(event.target.value)} disabled={busy || !payload?.options.employments.length}>{payload?.options.employments.map((employment) => <option key={employment.id} value={employment.id}>{employmentLabel(employment)}</option>)}</select></label>
      <button className={styles.grantButton} type="button" onClick={addGrant} disabled={busy || !userId || !employmentId}><ShieldCheck size={16}/>{busy ? c("Saving…","Kaydediliyor…") : c("Grant scope","Kapsam yetkisi ver")}</button>
    </div> : <p className={styles.panelCopy}>{c("Read-only view. Population mutations require settings:write.","Salt-okunur görünüm. Kapsam değişiklikleri settings:write yetkisi gerektirir.")}</p>}
    <div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>HRBP</th><th>{c("Population member","Kapsam üyesi")}</th><th>{c("Valid from","Başlangıç")}</th><th>{c("Valid to","Bitiş")}</th><th>{c("Action","İşlem")}</th></tr></thead><tbody>{activeGrants.length ? activeGrants.map((grant) => <tr key={grant.id}><td>{grant.user?.displayName ?? grant.userId}</td><td>{grant.employment ? employmentLabel(grant.employment) : grant.employmentId}</td><td>{new Date(grant.validFrom).toLocaleDateString(dateLocale)}</td><td>{grant.validTo ? new Date(grant.validTo).toLocaleDateString(dateLocale) : c("Open-ended","Süresiz")}</td><td>{canWrite ? <button className={styles.revokeButton} type="button" onClick={() => revokeGrant(grant.id)} disabled={busy}><Trash2 size={15}/>{c("Revoke","Geri al")}</button> : c("Read-only","Salt-okunur")}</td></tr>) : <tr><td className={styles.empty} colSpan={5}>{c("No active HRBP population grants.","Aktif HRBP çalışan kapsamı yetkisi yok.")}</td></tr>}</tbody></table></div>
  </section>;
}
