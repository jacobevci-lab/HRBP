import { Activity, BarChart3, CheckCircle2, CircleAlert, Clock3, EyeOff, Fingerprint, Headphones, ShieldCheck, UsersRound, Workflow } from "lucide-react";
import Link from "next/link";
import { AnalyticsRefreshButton } from "@/components/analytics-refresh-button";
import { getGovernedAnalyticsMetrics, type AnalyticsPrivacyState } from "@/lib/analytics-privacy";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getLifecycleAnalyticsContinuity } from "@/lib/lifecycle-analytics-continuity";
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

function metricLabel(locale: Locale, key: string, fallback: string) {
  if (locale !== "tr") return fallback;
  const labels: Record<string, string> = {
    WORKFORCE_HEADCOUNT: "Güncel Çalışan Sayısı",
    LEAVE_INCIDENCE_30D: "30 Günlük İzin Görülme Oranı",
    TIME_APPROVAL_RATE_30D: "30 Günlük Zaman Onay Oranı",
    GOAL_COVERAGE_YTD: "Yıl İçi Hedef Kapsamı",
    PERFORMANCE_REVIEW_COVERAGE: "Son Değerlendirme Döngüsü Kapsamı"
  };
  return labels[key] ?? fallback;
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

  const [result, continuity] = await Promise.all([
    getGovernedAnalyticsMetrics(db, ctx),
    getLifecycleAnalyticsContinuity(ctx)
  ]);
  const visible = result.data.filter((metric) => metric.privacy.state === "VISIBLE").length;
  const protectedCount = result.data.length - visible;
  const scoped = result.privacy.authorizationMode === "RELATIONSHIP_SCOPED";
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {c(locale, "Analytics", "Analitik")}</div><h1>{c(locale, "Analytics", "Analitik")}</h1><p>{c(locale, "Privacy-bound workforce metrics use the same authorized population as People, Performance and Talent. Small cohorts and mismatched snapshots fail closed.", "Gizlilik sınırına bağlı iş gücü metrikleri Çalışanlar, Performans ve Yetenek ile aynı yetkili popülasyonu kullanır. Küçük kohortlar ve kapsamı eşleşmeyen snapshot'lar güvenli biçimde kapatılır.")}</p></div>
      <div className="module-heading-actions"><button className="secondary-button" disabled><ShieldCheck size={16}/>{scoped ? c(locale, "Relationship scoped", "İlişki kapsamlı") : c(locale, "Tenant-wide governed", "Tenant-geneli yönetişimli")}</button><AnalyticsRefreshButton/></div>
    </section>

    <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<BarChart3 size={18}/>} label={c(locale, "Governed metrics", "Yönetişimli metrikler")} value={String(result.data.length)} meta={c(locale, "Active semantic definitions", "Aktif semantik tanımlar")}/>
        <Metric icon={<UsersRound size={18}/>} label={c(locale, "Authorized population", "Yetkili popülasyon")} value={String(result.privacy.authorizedPopulation)} meta={scoped ? c(locale, "Relationship scope", "İlişki kapsamı") : c(locale, "Tenant workforce scope", "Tenant iş gücü kapsamı")}/>
        <Metric icon={<CheckCircle2 size={18}/>} label={c(locale, "Visible metrics", "Görünür metrikler")} value={String(visible)} meta={c(locale, "Scope + threshold passed", "Kapsam + eşik geçti")}/>
        <Metric icon={<EyeOff size={18}/>} label={c(locale, "Privacy held", "Gizlilik nedeniyle tutuldu")} value={String(protectedCount)} meta={c(locale, "Suppressed or awaiting scoped compute", "Bastırıldı veya kapsamlı hesap bekliyor")}/>
      </section>

      {scoped ? <section className="card governance-note" style={{ margin: 0 }}><Fingerprint size={18}/><p><strong>{c(locale, "Population fingerprint enforcement is active.", "Popülasyon parmak izi zorunluluğu aktif.")}</strong> {c(locale, "A tenant-wide snapshot is never substituted for a Manager or HRBP population. Refresh computes the built-in metrics for the exact current authorization set.", "Manager veya HRBP popülasyonu için tenant-geneli snapshot hiçbir zaman ikame edilmez. Yenileme, yerleşik metrikleri tam güncel yetkilendirme kümesi için hesaplar.")}</p></section> : null}

      <section className="card gov-panel">
        <div className="gov-panel-head"><div><span className="section-kicker">{c(locale, "Lifecycle continuity", "Yaşam döngüsü sürekliliği")}</span><h3>{c(locale, "Operational attention, without sensitive record exposure", "Hassas kayıt açığa çıkarmadan operasyonel dikkat")}</h3></div><Activity size={18}/></div>
        <p style={{ marginTop: 0, color: "var(--muted)" }}>{c(locale, "These counters reuse your governed Action Center scope. Analytics receives aggregates only; request subjects, case narratives, document names and record identifiers are never projected here.", "Bu sayaçlar yönetişimli Aksiyon Merkezi kapsamınızı yeniden kullanır. Analitik yalnızca toplamları alır; talep konuları, vaka anlatıları, doküman adları ve kayıt kimlikleri buraya hiçbir zaman taşınmaz.")}</p>
        {continuity.degraded ? <div className="governance-note" style={{ margin: "12px 0" }}><CircleAlert size={18}/><p><strong>{c(locale, "Lifecycle summary is temporarily unavailable.", "Yaşam döngüsü özeti geçici olarak kullanılamıyor.")}</strong> {c(locale, "The system failed closed and did not retry with a broader tenant query.", "Sistem güvenli biçimde kapandı ve daha geniş tenant sorgusuyla yeniden denemedi.")}</p></div> : null}
        <section className="gov-metrics">
          <Metric icon={<Activity size={18}/>} label={c(locale, "Open attention", "Açık dikkat")} value={String(continuity.summary.total)} meta={c(locale, "Actor-scoped Action Center", "Aktör kapsamlı Aksiyon Merkezi")}/>
          <Metric icon={<CircleAlert size={18}/>} label={c(locale, "Critical", "Kritik")} value={String(continuity.summary.critical)} meta={c(locale, "Urgent governed work", "Acil yönetişimli iş")}/>
          <Metric icon={<Clock3 size={18}/>} label={c(locale, "Overdue / due soon", "Geciken / yakında")} value={`${continuity.summary.overdue} / ${continuity.summary.dueSoon}`} meta={c(locale, "Due-date continuity", "Termin sürekliliği")}/>
          <Metric icon={<Workflow size={18}/>} label={c(locale, "Workflow tasks", "İş akışı görevleri")} value={String(continuity.summary.workflow)} meta={c(locale, "Assigned or role-scoped", "Atanmış veya rol kapsamlı")}/>
          <Metric icon={<Headphones size={18}/>} label={c(locale, "HR Service", "HR Service")} value={String(continuity.summary.hrService)} meta={c(locale, "Visible service attention", "Görünür servis dikkati")}/>
          <Metric icon={<ShieldCheck size={18}/>} label={c(locale, "Employee Relations", "Çalışan İlişkileri")} value={String(continuity.summary.employeeRelations)} meta={c(locale, "Case Wall governed", "Case Wall yönetişimli")}/>
        </section>
        <div className="module-heading-actions" style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <Link className="secondary-button" href="/module/workflows?view=critical">{c(locale, "Open critical work", "Kritik işleri aç")}</Link>
          <Link className="secondary-button" href="/module/workflows?view=hr-service">{c(locale, "Open HR Service queue", "HR Service kuyruğunu aç")}</Link>
          <Link className="secondary-button" href="/module/workflows?view=employee-relations">{c(locale, "Open ER queue", "ER kuyruğunu aç")}</Link>
        </div>
      </section>

      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">{c(locale, "Governed live catalog", "Yönetişimli canlı katalog")}</span><h3>{c(locale, "Metric values & privacy state", "Metrik değerleri & gizlilik durumu")}</h3></div><ShieldCheck size={18}/></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c(locale, "Metric", "Metrik")}</th><th>{c(locale, "Value", "Değer")}</th><th>{c(locale, "Period", "Dönem")}</th><th>{c(locale, "Population", "Popülasyon")}</th><th>{c(locale, "Minimum", "Minimum")}</th><th>{c(locale, "Privacy", "Gizlilik")}</th></tr></thead><tbody>
            {result.data.length ? result.data.map((metric) => {
              const snapshot = metric.snapshots[0];
              const period = snapshot ? `${new Date(snapshot.periodStart).toLocaleDateString(dateLocale)} → ${new Date(snapshot.periodEnd).toLocaleDateString(dateLocale)}` : "—";
              return <tr key={metric.id}><td><strong>{metricLabel(locale, metric.key, metric.name)}</strong><small className="cell-sub">{metric.category} · {metric.aggregation}</small></td><td><strong>{snapshot && !snapshot.suppressed ? displayValue(snapshot.value, metric.unit, locale) : "—"}</strong></td><td>{period}</td><td>{snapshot && !snapshot.suppressed && snapshot.population !== null ? snapshot.population : "—"}</td><td>{metric.minPopulation}</td><td><em className={`gov-pill ${privacyClass(metric.privacy.state)}`}>{privacyLabel(locale, metric.privacy.state)}</em></td></tr>;
            }) : <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{c(locale, "No active metric definitions are configured. Use Refresh governed metrics to provision the built-in catalog.", "Aktif metrik tanımı yapılandırılmamış. Yerleşik kataloğu oluşturmak için Yönetişimli metrikleri yenile seçeneğini kullanın.")}</td></tr>}
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
