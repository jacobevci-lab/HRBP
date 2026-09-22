"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import styles from "@/components/access-scope-admin.module.css";
import { useLocale } from "@/components/locale-provider";

type ScopeType = "EMPLOYMENT" | "ORG_UNIT" | "LEGAL_ENTITY" | "COUNTRY" | "POSITION_TREE";
type ScopeEffect = "INCLUDE" | "EXCLUDE";
type UserOption = { id: string; displayName: string; email: string | null };
type EmploymentOption = {
  id: string;
  person: { employeeNumber: string | null; givenName: string; familyName: string };
  position: { id: string; positionCode: string; title: string; orgUnit: { id: string; name: string } } | null;
};
type OrgUnitOption = { id: string; parentId: string | null; code: string; name: string; type: string };
type PositionOption = { id: string; positionCode: string; title: string; orgUnit: { name: string } };
type CountryOption = { code: string };
type Grant = {
  id: string;
  userId: string;
  employmentId: string | null;
  scopeType: ScopeType;
  scopeKey: string | null;
  effect: ScopeEffect;
  validFrom: string;
  validTo: string | null;
  user: UserOption | null;
  employment: EmploymentOption | null;
};
type Payload = {
  data: Grant[];
  options: {
    users: UserOption[];
    employments: EmploymentOption[];
    orgUnits: OrgUnitOption[];
    positions: PositionOption[];
    countries: CountryOption[];
  };
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
  const [scopeType, setScopeType] = useState<ScopeType>("EMPLOYMENT");
  const [scopeKey, setScopeKey] = useState("");
  const [effect, setEffect] = useState<ScopeEffect>("INCLUDE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeLabel = useCallback((value: ScopeType) => ({
    EMPLOYMENT: c("Employee / employment", "Çalışan / istihdam"),
    ORG_UNIT: c("Organization unit", "Organizasyon birimi"),
    LEGAL_ENTITY: c("Legal entity", "Tüzel kişilik"),
    COUNTRY: c("Country", "Ülke"),
    POSITION_TREE: c("Position tree", "Pozisyon ağacı")
  })[value], [c]);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/access-grants", { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || c("Access scope data could not be loaded.", "Erişim kapsamı verisi yüklenemedi."));
    }
    const body = await response.json() as Payload;
    setPayload(body);
    setUserId((current) => current || body.options.users[0]?.id || "");
    setScopeKey((current) => current || body.options.employments[0]?.id || "");
  }, [c]);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : c("Access scope data could not be loaded.", "Erişim kapsamı verisi yüklenemedi.")));
  }, [load, c]);

  const targetOptions = useMemo(() => {
    if (!payload) return [] as Array<{ key: string; label: string }>;
    if (scopeType === "EMPLOYMENT") return payload.options.employments.map((item) => ({ key: item.id, label: employmentLabel(item) }));
    if (scopeType === "ORG_UNIT") return payload.options.orgUnits.filter((item) => item.type !== "LEGAL_ENTITY").map((item) => ({ key: item.id, label: `${item.code} · ${item.name} · ${item.type.replaceAll("_", " ")}` }));
    if (scopeType === "LEGAL_ENTITY") return payload.options.orgUnits.filter((item) => item.type === "LEGAL_ENTITY").map((item) => ({ key: item.id, label: `${item.code} · ${item.name}` }));
    if (scopeType === "COUNTRY") return payload.options.countries.map((item) => ({ key: item.code, label: item.code }));
    return payload.options.positions.map((item) => ({ key: item.id, label: `${item.positionCode} · ${item.title} · ${item.orgUnit.name}` }));
  }, [payload, scopeType]);

  useEffect(() => {
    if (!targetOptions.some((option) => option.key === scopeKey)) setScopeKey(targetOptions[0]?.key ?? "");
  }, [scopeKey, targetOptions]);

  const activeGrants = useMemo(() => {
    const now = Date.now();
    return payload?.data.filter((grant) => !grant.validTo || new Date(grant.validTo).getTime() >= now) ?? [];
  }, [payload]);

  function targetLabel(grant: Grant) {
    const key = grant.scopeKey ?? grant.employmentId ?? "";
    if (grant.scopeType === "EMPLOYMENT") {
      const employment = payload?.options.employments.find((item) => item.id === key) ?? grant.employment;
      return employment ? employmentLabel(employment) : key;
    }
    if (grant.scopeType === "ORG_UNIT" || grant.scopeType === "LEGAL_ENTITY") {
      const unit = payload?.options.orgUnits.find((item) => item.id === key);
      return unit ? `${unit.code} · ${unit.name}` : key;
    }
    if (grant.scopeType === "POSITION_TREE") {
      const position = payload?.options.positions.find((item) => item.id === key);
      return position ? `${position.positionCode} · ${position.title}` : key;
    }
    return key;
  }

  async function addGrant() {
    if (!userId || !scopeKey || !payload?.permissions.write) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/access-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, scopeType, scopeKey, effect })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Population rule could not be saved.", "Kapsam kuralı kaydedilemedi."));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Population rule could not be saved.", "Kapsam kuralı kaydedilemedi."));
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
      if (!response.ok) throw new Error(body.error || c("Population rule could not be revoked.", "Kapsam kuralı geri alınamadı."));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Population rule could not be revoked.", "Kapsam kuralı geri alınamadı."));
    } finally {
      setBusy(false);
    }
  }

  const canWrite = payload?.permissions.write ?? false;
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  return <section className="card platform-panel">
    <div className="platform-head"><div><span className="section-kicker">{c("Relationship + organizational access", "İlişki + organizasyon erişimi")}</span><h3>{c("HRBP population scope", "HRBP çalışan kapsamı")}</h3><p className={styles.panelCopy}>{c("Build HRBP populations from employees, organization units, legal entities, country jurisdictions or a position-rooted reporting tree. Include rules are merged, explicit excludes win, and the HRBP's own employment remains accessible.", "HRBP kapsamını çalışan, organizasyon birimi, tüzel kişilik, ülke yetki alanı veya pozisyon köklü raporlama ağacından oluşturun. Dahil et kuralları birleşir, açık hariç tut kuralları önceliklidir ve HRBP'nin kendi istihdam kaydı erişilebilir kalır.")}</p></div><UserRoundCog size={19}/></div>
    {error ? <div className={styles.error}>{error}</div> : null}
    {canWrite ? <div className={styles.form}>
      <label className={styles.field}><span>{c("HRBP user", "HRBP kullanıcısı")}</span><select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy || !payload?.options.users.length}>{payload?.options.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}{user.email ? ` · ${user.email}` : ""}</option>)}</select></label>
      <label className={styles.field}><span>{c("Scope type", "Kapsam tipi")}</span><select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} disabled={busy}>{(["EMPLOYMENT", "ORG_UNIT", "LEGAL_ENTITY", "COUNTRY", "POSITION_TREE"] as ScopeType[]).map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}</select></label>
      <label className={styles.field}><span>{c("Scope target", "Kapsam hedefi")}</span><select value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} disabled={busy || !targetOptions.length}>{targetOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      <label className={styles.field}><span>{c("Effect", "Etki")}</span><select value={effect} onChange={(event) => setEffect(event.target.value as ScopeEffect)} disabled={busy}><option value="INCLUDE">{c("Include", "Dahil et")}</option><option value="EXCLUDE">{c("Exclude", "Hariç tut")}</option></select></label>
      <button className={styles.grantButton} type="button" onClick={addGrant} disabled={busy || !userId || !scopeKey}><ShieldCheck size={16}/>{busy ? c("Saving…", "Kaydediliyor…") : c("Save rule", "Kuralı kaydet")}</button>
    </div> : <p className={styles.panelCopy}>{c("Read-only view. Population mutations require settings:write.", "Salt-okunur görünüm. Kapsam değişiklikleri settings:write yetkisi gerektirir.")}</p>}
    <div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>HRBP</th><th>{c("Effect", "Etki")}</th><th>{c("Scope type", "Kapsam tipi")}</th><th>{c("Target", "Hedef")}</th><th>{c("Valid from", "Başlangıç")}</th><th>{c("Valid to", "Bitiş")}</th><th>{c("Action", "İşlem")}</th></tr></thead><tbody>{activeGrants.length ? activeGrants.map((grant) => <tr key={grant.id}><td>{grant.user?.displayName ?? grant.userId}</td><td><strong className={grant.effect === "EXCLUDE" ? styles.exclude : styles.include}>{grant.effect === "EXCLUDE" ? c("Exclude", "Hariç") : c("Include", "Dahil")}</strong></td><td>{typeLabel(grant.scopeType)}</td><td>{targetLabel(grant)}</td><td>{new Date(grant.validFrom).toLocaleDateString(dateLocale)}</td><td>{grant.validTo ? new Date(grant.validTo).toLocaleDateString(dateLocale) : c("Open-ended", "Süresiz")}</td><td>{canWrite ? <button className={styles.revokeButton} type="button" onClick={() => revokeGrant(grant.id)} disabled={busy}><Trash2 size={15}/>{c("Revoke", "Geri al")}</button> : c("Read-only", "Salt-okunur")}</td></tr>) : <tr><td className={styles.empty} colSpan={7}>{c("No active HRBP population rules.", "Aktif HRBP çalışan kapsamı kuralı yok.")}</td></tr>}</tbody></table></div>
  </section>;
}
