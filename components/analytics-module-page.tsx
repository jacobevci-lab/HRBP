import { BarChart3, CheckCircle2, CircleAlert, EyeOff, Fingerprint, ShieldCheck, UsersRound } from "lucide-react";
import { getGovernedAnalyticsMetrics, type AnalyticsPrivacyState } from "@/lib/analytics-privacy";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="gov-metric card"><div className="gov-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function displayValue(value: unknown, unit: string, locale: Locale) {
  if (value === null || value === undefined) return "—";
  const suffix = unit === "PERCENT" ? "%" : unit === "DAYS" ? c(locale, "d", "g") : "";
  if (typeof value === "number") return `${value.toLocaleString(locale === "tr" ? "tr-TR" : "en-GB")}${suffix}`;
  if (typeof value === "string") return `${value}${suffix}`;
  if (typeof value === "boolean") return value ? c(locale, "Yes", "Evet") : c(locale, "No", "Hayır");
  return JSON.stringify(value);
}

function privacyLabel(locale: Locale, state: AnalyticsPrivacyState) {
  const labels: Record<AnalyticsPrivacyState, [string, string]> = {
    VISIBLE: ["Visible", "Görünür"],
    MIN_POPULATION: ["Below threshold", "Eşik altında"],
    SOURCE_SUPPRESSED: ["Source suppressed", "Kaynak bastırdı"],
    SCOPED_RECOMPUTE_REQUIRED: ["Scoped recompute", "Kapsamlı yeniden hesaplama"],
    NO_SNAPSHOT: ["No snapshot", "Snapshot yok"]
  };
  return c(locale, labels[state][0], labels[state][1]);
}

function privacyClass(state: AnalyticsPrivacyState) {
  return state === "VISIBLE" ? "visible" : state === "SCOPED_RECOMPUTE_REQUIRED" || state === "NO_SNAPSHOT" ? "review" : "suppressed";
}

export async function AnalyticsModulePage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "analytics:read")) {
    return <><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c(locale, "Analytics", "Analitik")}</div><h1>{c(locale, "Analytics", "Analitik")}</h1><p>{c(locale, "Governed workforce analytics are available only to authorized roles.", "Yönetişimli iş gücü analitiği yalnızca yetkili roller tarafından görüntülenebilir.")}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{c(locale, "Analytics access is restricted", "Analitik erişimi kısıtlı")}</h3><p>{c(locale, "Your signed role does not include analytics:read.", "İmzalı rolünüz analytics:read yetkisi içermiyor.")}</p></div></section></>;
  }

  const result = await getGovernedAnalyticsMetrics(db, ctx);
  const visible = result.data.filter((metric) => metric.privacy.state === "VISIBLE").length;
  const protectedCount = result.data.length - visible;
  const scoped = result.privacy.authorizationMode === "RELATIONSHIP_SCOPED";
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {c(locale, "Analytics", "Analitik")}</div><h1>{c(locale, "Analytics", "Analitik")}</h1><p>{c(locale, "Privacy-bound workforce metrics use the same authorized population as People, Performance and Talent. Small cohorts and mismatched snapshots fail closed.", "Gizlilik sınırına bağlı iş gücü metrikleri Çalışanlar, Performans ve Yetenek ile aynı yetkili popülasyonu kullanır. Küçük kohortlar ve kapsamı eşleşmeyen snapshot'lar güvenli biçimde kapatılır.")}</p></div>
      <button className="secondary-button" disabled><ShieldCheck size={16}/>{scoped ? c(locale, "Relationship scoped", "İlişki kapsamlı") : c(locale, "Tenant-wide governed", "Tenant-geneli yönetişimli")}</button>
    </section>

    <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<BarChart3 size={18}/>} label={c(locale, "Governed metrics", "Yönetişimli metrikler")} value={String(result.data.length)} meta={c(locale, "Active semantic definitions", "Aktif semantik tanımlar")}/>
        <Metric icon={<UsersRound size={18}/>} label={c(locale, "Authorized population", "Yetkili popülasyon")} value={String(result.privacy.authorizedPopulation)} meta={scoped ? c(locale, "Relationship scope", "İlişki kapsamı") : c(locale, "Tenant workforce scope", "Tenant iş gücü kapsamı")}/>
        <Metric icon={<CheckCircle2 size={18}/>} label={c(locale, "Visible metrics", "Görünür metrikler")} value={String(visible)} meta={c(locale, "Scope + threshold passed", "Kapsam + eşik geçti")}/>
        <Metric icon={<EyeOff size={18}/>} label={c(locale, "Privacy held", "Gizlilik nedeniyle tutuldu")} value={String(protectedCount)} meta={c(locale, "Suppressed or awaiting scoped compute", "Bastırıldı veya kapsamlı hesap bekliyor")}/>
      </section>

      {scoped ? <section className="card governance-note" style={{ margin: 0 }}><Fingerprint size={18}/><p><strong>{c(locale, "Population fingerprint enforcement is active.", "Popülasyon parmak izi zorunluluğu aktif.")}</strong> {c(locale, "A tenant-wide snapshot is never substituted for a Manager or HRBP population. A value becomes visible only when the materialized snapshot was generated for the exact authorized employment set.", "Manager veya HRBP popülasyonu için tenant-geneli snapshot hiçbir zaman ikame edilmez. Bir değer yalnızca materialize snapshot tam yetkili istihdam kümesi için üretildiyse görünür olur.")}</p></section> : null}

      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">{c(locale, "Governed live catalog", "Yönetişimli canlı katalog")}</span><h3>{c(locale, "Metric values & privacy state", "Metrik değerleri & gizlilik durumu")}</h3></div><ShieldCheck size={18}/></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c(locale, "Metric", "Metrik")}</th><th>{c(locale, "Value", "Değer")}</th><th>{c(locale, "Period", "Dönem")}</th><th>{c(locale, "Population", "Popülasyon")}</th><th>{c(locale, "Minimum", "Minimum")}</th><th>{c(locale, "Privacy", "Gizlilik")}</th></tr></thead><tbody>
            {result.data.length ? result.data.map((metric) => {
              const snapshot = metric.snapshots[0];
              const period = snapshot ? `${new Date(snapshot.periodStart).toLocaleDateString(dateLocale)} → ${new Date(snapshot.periodEnd).toLocaleDateString(dateLocale)}` : "—";
              return <tr key={metric.id}><td><strong>{metric.name}</strong><small className="cell-sub">{metric.category} · {metric.aggregation}</small></td><td><strong>{snapshot && !snapshot.suppressed ? displayValue(snapshot.value, metric.unit, locale) : "—"}</strong></td><td>{period}</td><td>{snapshot && !snapshot.suppressed && snapshot.population !== null ? snapshot.population : "—"}</td><td>{metric.minPopulation}</td><td><em className={`gov-pill ${privacyClass(metric.privacy.state)}`}>{privacyLabel(locale, metric.privacy.state)}</em></td></tr>;
            }) : <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{c(locale, "No active metric definitions are configured.", "Aktif metrik tanımı yapılandırılmamış.")}</td></tr>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side"><div className="gov-panel-head"><div><span className="section-kicker">{c(locale, "Privacy contract", "Gizlilik sözleşmesi")}</span><h3>{c(locale, "Distribution controls", "Dağıtım kontrolleri")}</h3></div><EyeOff size={18}/></div><div className="gov-controls">
          <p><Fingerprint size={17}/><span><strong>{c(locale, "Exact population binding", "Tam popülasyon bağlama")}</strong><small>{c(locale, "Scoped snapshots must match the authorized employment fingerprint.", "Kapsamlı snapshot'lar yetkili istihdam parmak iziyle eşleşmelidir.")}</small></span></p>
          <p><EyeOff size={17}/><span><strong>{c(locale, "Read-time minimum threshold", "Okuma anında minimum eşik")}</strong><small>{c(locale, "minPopulation is re-evaluated even if a stored suppression flag is wrong.", "Saklanan suppression flag'i yanlış olsa bile minPopulation yeniden değerlendirilir.")}</small></span></p>
          <p><ShieldCheck size={17}/><span><strong>{c(locale, "Fail-closed distribution", "Güvenli kapalı dağıtım")}</strong><small>{c(locale, "Missing scoped materialization returns no tenant-wide substitute value.", "Kapsamlı materializasyon yoksa tenant-geneli ikame değer dönmez.")}</small></span></p>
        </div></aside>
      </section>
    </div>
  </>;
}
