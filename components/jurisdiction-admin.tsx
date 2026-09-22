"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, MapPinned } from "lucide-react";
import styles from "@/components/access-scope-admin.module.css";
import { useLocale } from "@/components/locale-provider";

type Employment = {
  id: string;
  person: { employeeNumber: string | null; givenName: string; familyName: string };
  position: { title: string; orgUnit: { name: string } } | null;
};
type Row = {
  id: string;
  employmentId: string;
  countryCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  employment: Employment | null;
};
type Payload = { data: Row[]; options: { employments: Employment[] }; permissions: { write: boolean } };

function employmentLabel(employment: Employment) {
  const number = employment.person.employeeNumber ? ` · ${employment.person.employeeNumber}` : "";
  const position = employment.position ? ` · ${employment.position.title} / ${employment.position.orgUnit.name}` : "";
  return `${employment.person.givenName} ${employment.person.familyName}${number}${position}`;
}

function today() { return new Date().toISOString().slice(0, 10); }

export function JurisdictionAdmin() {
  const { locale } = useLocale();
  const c = useCallback((en: string, tr: string) => locale === "tr" ? tr : en, [locale]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [employmentId, setEmploymentId] = useState("");
  const [countryCode, setCountryCode] = useState("TR");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/jurisdictions", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error || c("Jurisdiction data could not be loaded.", "Yetki alanı verisi yüklenemedi."));
    setPayload(body);
    setEmploymentId((current) => current || body.options.employments[0]?.id || "");
  }, [c]);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : c("Jurisdiction data could not be loaded.", "Yetki alanı verisi yüklenemedi."))); }, [load, c]);

  const historyRows = useMemo(() => payload?.data.slice(0, 500) ?? [], [payload]);

  async function save() {
    if (!payload?.permissions.write || !employmentId || !/^[A-Za-z]{2}$/.test(countryCode) || !effectiveFrom) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/settings/jurisdictions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employmentId, countryCode: countryCode.toUpperCase(), effectiveFrom, effectiveTo: effectiveTo || null, source: "Platform settings" })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Jurisdiction could not be saved.", "Yetki alanı kaydedilemedi."));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Jurisdiction could not be saved.", "Yetki alanı kaydedilemedi."));
    } finally { setBusy(false); }
  }

  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  const now = Date.now();
  return <section className="card platform-panel">
    <div className="platform-head"><div><span className="section-kicker">{c("Effective-dated jurisdiction", "Tarih-etkin yetki alanı")}</span><h3>{c("Employment country history", "İstihdam ülke geçmişi")}</h3><p className={styles.panelCopy}>{c("Maintain an explicit country jurisdiction history used by country-based HRBP access. New effective records close the prior open period without rewriting history.", "Ülke bazlı HRBP erişiminde kullanılan açık ülke yetki alanı geçmişini yönetin. Yeni tarih-etkin kayıt önceki açık dönemi geçmişi bozmadan kapatır.")}</p></div><Globe2 size={19}/></div>
    {error ? <div className={styles.error}>{error}</div> : null}
    {payload?.permissions.write ? <div className={styles.form}>
      <label className={styles.field}><span>{c("Employment", "İstihdam")}</span><select value={employmentId} onChange={(event) => setEmploymentId(event.target.value)} disabled={busy}>{payload.options.employments.map((employment) => <option key={employment.id} value={employment.id}>{employmentLabel(employment)}</option>)}</select></label>
      <label className={styles.field}><span>{c("Country code", "Ülke kodu")}</span><input maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} disabled={busy}/></label>
      <label className={styles.field}><span>{c("Effective from", "Başlangıç")}</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={busy}/></label>
      <label className={styles.field}><span>{c("Effective to", "Bitiş")}</span><input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} disabled={busy}/></label>
      <button className={styles.grantButton} type="button" onClick={save} disabled={busy || !employmentId || countryCode.length !== 2 || !effectiveFrom}><MapPinned size={16}/>{busy ? c("Saving…", "Kaydediliyor…") : c("Save jurisdiction", "Yetki alanını kaydet")}</button>
    </div> : <p className={styles.panelCopy}>{c("Read-only view. Jurisdiction changes require settings:write.", "Salt-okunur görünüm. Yetki alanı değişiklikleri settings:write gerektirir.")}</p>}
    <div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>{c("Employee", "Çalışan")}</th><th>{c("Country", "Ülke")}</th><th>{c("Effective from", "Başlangıç")}</th><th>{c("Effective to", "Bitiş")}</th><th>{c("State", "Durum")}</th><th>{c("Source", "Kaynak")}</th></tr></thead><tbody>{historyRows.length ? historyRows.map((row) => {
      const starts = new Date(row.effectiveFrom).getTime();
      const ends = row.effectiveTo ? new Date(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      const current = starts <= now && ends >= now;
      return <tr key={row.id}><td>{row.employment ? employmentLabel(row.employment) : row.employmentId}</td><td><strong>{row.countryCode}</strong></td><td>{new Date(row.effectiveFrom).toLocaleDateString(dateLocale)}</td><td>{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString(dateLocale) : c("Open-ended", "Süresiz")}</td><td><em className={`platform-pill ${current ? "active" : "review"}`}>{current ? c("Current", "Güncel") : c("Historical", "Geçmiş")}</em></td><td>{row.source ?? "—"}</td></tr>;
    }) : <tr><td className={styles.empty} colSpan={6}>{c("No employment jurisdiction history is recorded.", "İstihdam yetki alanı geçmişi kaydedilmemiş.")}</td></tr>}</tbody></table></div>
  </section>;
}
