import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, Fingerprint, History, Search, ShieldCheck } from "lucide-react";
import { DataClassification } from "@prisma/client";
import { getAuditLiveData } from "@/lib/audit-live-data";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";
import { can } from "@/lib/authorization";

function c(locale: "en" | "tr", en: string, tr: string) { return locale === "tr" ? tr : en; }
function text(value: string | string[] | undefined) { return typeof value === "string" ? value : ""; }
function cls(value: string): DataClassification | undefined {
  return Object.values(DataClassification).includes(value as DataClassification) ? value as DataClassification : undefined;
}

export async function AuditLivePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "audit:read")) {
    return <section className="card audit-access-denied"><ShieldCheck size={28}/><h2>{c(locale, "Audit access is restricted", "Denetim erişimi kısıtlı")}</h2><p>{c(locale, "Your role does not include audit:read.", "Rolünüz audit:read yetkisini içermiyor.")}</p></section>;
  }

  const q = text(searchParams.q).slice(0, 100);
  const actor = text(searchParams.actor).slice(0, 191);
  const resource = text(searchParams.resource).slice(0, 120);
  const classification = cls(text(searchParams.classification));
  const requestedDays = Number(text(searchParams.days) || 30);
  const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(1, Math.floor(requestedDays))) : 30;
  const data = await getAuditLiveData(ctx.tenantId, { query: q, actorId: actor, resourceType: resource, classification, days });

  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (actor) exportParams.set("actor", actor);
  if (resource) exportParams.set("resource", resource);
  if (classification) exportParams.set("classification", classification);
  exportParams.set("days", String(days));

  const integrityLabel = data.integrity.scope === "GENESIS"
    ? c(locale, "Full chain from genesis", "Genesis'ten tam zincir")
    : data.integrity.scope === "TAIL"
      ? c(locale, "Anchored recent-chain verification", "Ankrajlı yakın dönem zincir doğrulaması")
      : c(locale, "No audit events yet", "Henüz denetim olayı yok");

  return <div className="audit-live-page">
    <div className="page-heading audit-live-heading">
      <div><span className="eyebrow">{c(locale, "Trust & evidence", "Güven & kanıt")}</span><h1>{c(locale, "Audit Ledger", "Denetim Defteri")}</h1><p>{c(locale, "Immutable tenant activity with hash-chain integrity verification.", "Hash-zinciri bütünlük doğrulamalı değiştirilemez tenant aktivitesi.")}</p></div>
      <Link className="secondary-button" href={`/api/audit/export?${exportParams.toString()}`}><Download size={15}/>{c(locale, "Export CSV", "CSV dışa aktar")}</Link>
    </div>

    <section className="audit-metrics">
      <Metric icon={<History size={18}/>} label={c(locale, "Filtered events", "Filtrelenmiş olay") } value={String(data.total)} meta={c(locale, `Last ${days} days`, `Son ${days} gün`)}/>
      <Metric icon={<Fingerprint size={18}/>} label={c(locale, "Last 24 hours", "Son 24 saat")} value={String(data.last24h)} meta={c(locale, "Tenant-wide activity", "Tenant geneli aktivite")}/>
      <Metric icon={data.integrity.valid ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>} label={c(locale, "Hash-chain integrity", "Hash-zinciri bütünlüğü")} value={data.integrity.valid ? c(locale, "Verified", "Doğrulandı") : c(locale, "Broken", "Bozuk")} meta={`${data.integrity.checked} · ${integrityLabel}`} danger={!data.integrity.valid}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale, "Restricted+ events", "Restricted+ olay") } value={String((data.classificationCounts.RESTRICTED ?? 0) + (data.classificationCounts.HIGHLY_RESTRICTED ?? 0))} meta={c(locale, "Sensitive audit evidence", "Hassas denetim kanıtı")}/>
    </section>

    {!data.integrity.valid ? <section className="audit-integrity-alert"><AlertTriangle size={18}/><div><strong>{c(locale, "Audit chain integrity failure", "Denetim zinciri bütünlük hatası")}</strong><p>{data.integrity.reason} · {data.integrity.brokenEventId}</p></div></section> : null}

    <form className="card audit-filter-bar" method="get" action="/module/audit">
      <label className="audit-search"><Search size={15}/><input name="q" defaultValue={q} placeholder={c(locale, "Action, resource, purpose or actor…", "Aksiyon, kaynak, amaç veya aktör…")}/></label>
      <select name="actor" defaultValue={actor}><option value="">{c(locale, "All actors", "Tüm aktörler")}</option>{data.actorOptions.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select>
      <select name="resource" defaultValue={resource}><option value="">{c(locale, "All resources", "Tüm kaynaklar")}</option>{data.resourceOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select>
      <select name="classification" defaultValue={classification ?? ""}><option value="">{c(locale, "All classifications", "Tüm sınıflandırmalar")}</option>{Object.values(DataClassification).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
      <select name="days" defaultValue={String(days)}><option value="1">24h</option><option value="7">7d</option><option value="30">30d</option><option value="90">90d</option><option value="365">365d</option></select>
      <button className="create-button" type="submit">{c(locale, "Apply", "Uygula")}</button>
      <Link className="secondary-button" href="/module/audit">{c(locale, "Reset", "Sıfırla")}</Link>
    </form>

    <section className="card audit-ledger-card">
      <div className="audit-ledger-head"><div><span className="section-kicker">{c(locale, "Evidence stream", "Kanıt akışı")}</span><h3>{c(locale, "Recent audit events", "Son denetim olayları")}</h3></div><small>{c(locale, "Showing up to 250 records", "En fazla 250 kayıt gösteriliyor")}</small></div>
      <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>{c(locale, "Time", "Zaman")}</th><th>{c(locale, "Actor", "Aktör")}</th><th>{c(locale, "Action", "Aksiyon")}</th><th>{c(locale, "Resource", "Kaynak")}</th><th>{c(locale, "Classification", "Sınıflandırma")}</th><th>IP</th><th>{c(locale, "Purpose", "Amaç")}</th><th>Hash</th></tr></thead><tbody>
        {data.rows.length ? data.rows.map((row) => <tr key={row.id}>
          <td><time>{new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(row.occurredAt)}</time></td>
          <td><strong>{row.actorName}</strong><small>{row.actorRole ?? row.actorId}</small></td>
          <td><span className="audit-action">{row.action}</span></td>
          <td><strong>{row.resourceType}</strong><small>{row.resourceId}</small></td>
          <td><span className={`audit-classification ${row.classification.toLowerCase()}`}>{row.classification.replaceAll("_", " ")}</span></td>
          <td>{row.ipAddress ?? "—"}</td>
          <td className="audit-purpose">{row.purpose ?? "—"}</td>
          <td><code title={row.hash}>{row.hash.slice(0, 10)}…</code></td>
        </tr>) : <tr><td colSpan={8} className="audit-empty">{c(locale, "No audit events match the current filters.", "Geçerli filtrelerle eşleşen denetim olayı yok.")}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function Metric({ icon, label, value, meta, danger = false }: { icon: React.ReactNode; label: string; value: string; meta: string; danger?: boolean }) {
  return <div className={`card audit-metric ${danger ? "danger" : ""}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{meta}</p></div></div>;
}
