import Link from "next/link";
import { AlertTriangle, Clock3, Route, ShieldCheck } from "lucide-react";
import { can } from "@/lib/authorization";
import { getHRServiceEscalationLiveData, normalizeHRServiceEscalationFilter } from "@/lib/hr-service-escalation-live-data";
import { isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: Locale, en: string, tr: string) {
  return locale === "tr" ? tr : en;
}

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="services-metric card"><div className="services-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function filterHref(filter: string) {
  return filter === "all" ? "/module/hr-service" : `/module/hr-service?escalation=${encodeURIComponent(filter)}`;
}

export async function HRServiceEscalationPanel({ filterValue }: { filterValue?: string }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "hr-service:read") || isHRServiceSelfServiceRole(ctx.role)) return null;

  const filter = normalizeHRServiceEscalationFilter(filterValue);
  const data = await getHRServiceEscalationLiveData(ctx, filter);
  if (!data) return null;

  if (!data.schemaReady) {
    return <section className="card services-panel hr-escalation-shell hr-escalation-schema-warning">
      <AlertTriangle size={19}/>
      <div><span className="section-kicker">{c(locale, "Escalation controls unavailable", "Eskalasyon kontrolleri kullanılamıyor")}</span><h3>{c(locale, "Staging database schema sync required", "Staging veritabanı şema senkronizasyonu gerekli")}</h3><p>{c(locale, "The existing HR Service workspace remains available. Run the Staging DB Sync workflow to activate SLA escalation fields and operations reporting.", "Mevcut HR Service çalışma alanı kullanılmaya devam eder. SLA eskalasyon alanlarını ve operasyon raporlamasını etkinleştirmek için Staging DB Sync workflow'unu çalıştırın.")}</p></div>
    </section>;
  }

  const filters = [
    { key: "all", label: c(locale, "All", "Tümü"), count: data.counts.all },
    { key: "warning", label: c(locale, "Warning", "Uyarı"), count: data.counts.warning },
    { key: "breached", label: c(locale, "Breached", "İhlal"), count: data.counts.breached },
    { key: "severe", label: c(locale, "Severe", "Kritik"), count: data.counts.severe }
  ];

  return <div className="services-shell hr-escalation-shell">
    <section className="services-metrics">
      <Metric icon={<AlertTriangle size={18}/>} label={c(locale, "Escalated requests", "Eskalasyonlu talepler")} value={String(data.counts.all)} meta={c(locale, "Visible operational scope", "Görünür operasyon kapsamı")}/>
      <Metric icon={<Clock3 size={18}/>} label={c(locale, "SLA warnings", "SLA uyarıları")} value={String(data.counts.warning)} meta={c(locale, "Approaching breach", "İhlale yaklaşıyor")}/>
      <Metric icon={<Route size={18}/>} label={c(locale, "Breached", "İhlal edilen")} value={String(data.counts.breached)} meta={c(locale, "Level 2 or higher", "Seviye 2 veya üzeri")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale, "Severe", "Kritik")} value={String(data.counts.severe)} meta={c(locale, "Extended SLA breach", "Uzamış SLA ihlali")}/>
    </section>

    <section className="card services-panel">
      <div className="services-panel-head hr-escalation-head">
        <div><span className="section-kicker">{c(locale, "Automated SLA escalation", "Otomatik SLA eskalasyonu")}</span><h3>{c(locale, "Escalation operations queue", "Eskalasyon operasyon kuyruğu")}</h3></div>
        <span className="matrix-note">L1 → L2 → L3</span>
      </div>
      <div className="hr-escalation-filters" aria-label={c(locale, "Escalation filters", "Eskalasyon filtreleri")}>
        {filters.map((item) => <Link key={item.key} href={filterHref(item.key)} className={`hr-escalation-filter${filter === item.key ? " active" : ""}`} aria-current={filter === item.key ? "page" : undefined}>{item.label}<span>{item.count}</span></Link>)}
      </div>
      <div className="services-table-wrap">
        <table className="services-table hr-escalation-table">
          <thead><tr><th>{c(locale, "Request", "Talep")}</th><th>{c(locale, "Title", "Başlık")}</th><th>{c(locale, "Priority", "Öncelik")}</th><th>{c(locale, "Queue", "Kuyruk")}</th><th>SLA</th><th>{c(locale, "Escalation", "Eskalasyon")}</th><th>{c(locale, "Reason", "Neden")}</th><th>{c(locale, "Escalated", "Eskalasyon zamanı")}</th></tr></thead>
          <tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}>
            <td><strong>{row.requestNumber}</strong><small className="cell-sub">{row.category}</small></td>
            <td>{row.title}</td>
            <td>{row.priority}</td>
            <td>{row.queue}<small className="cell-sub">{row.assigneeId ? c(locale, "Assigned", "Atanmış") : c(locale, "Unassigned", "Atanmamış")}</small></td>
            <td>{row.sla}</td>
            <td><em className={`services-pill escalation-${row.escalation.toLowerCase()}`}>{c(locale, row.escalation, row.escalation === "Warning" ? "Uyarı" : row.escalation === "Breached" ? "İhlal" : "Kritik")}</em></td>
            <td className="hr-escalation-reason">{row.escalationReason}</td>
            <td>{row.escalatedAt}</td>
          </tr>) : <tr><td colSpan={8} className="hr-escalation-empty">{c(locale, "No requests match this escalation filter.", "Bu eskalasyon filtresiyle eşleşen talep yok.")}</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
