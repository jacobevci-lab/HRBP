import { AlertTriangle, BadgeCheck, Clock3, Link2, MessageSquareText, PauseCircle } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { formatHRServiceLifecycleDate, getHRServiceLifecycleLiveData } from "@/lib/hr-service-lifecycle-live-data";
import { getServerRequestContext } from "@/lib/server-session";
import { HRServiceLifecycleActions } from "@/components/hr-service-lifecycle-actions";
import { HRServiceRequestForm } from "@/components/hr-service-request-form";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) { return <div className="services-metric card"><div className="services-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>; }

export async function HRServiceLifecyclePanel({ focus }: { focus?: string }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "hr-service:read")) return null;
  const data = await getHRServiceLifecycleLiveData(ctx, focus);
  const canWrite = can(ctx, "hr-service:write");
  const focusRequested = Boolean(focus?.trim());

  if (!data.schemaReady) {
    return <section className="card services-panel" style={{ marginTop: 18 }}>
      <div className="services-panel-head"><div><span className="section-kicker">{c(locale, "Lifecycle evidence unavailable", "Yaşam döngüsü kanıtı kullanılamıyor")}</span><h3>{c(locale, "Database schema sync required", "Veritabanı şema senkronizasyonu gerekli")}</h3></div><AlertTriangle size={18}/></div>
      <p>{c(locale, "The existing HR Service queue remains online. Sync the database schema to activate immutable transition history and SLA pause evidence.", "Mevcut İK Hizmet kuyruğu çalışmaya devam eder. Değiştirilemez geçiş geçmişi ve SLA duraklatma kanıtını etkinleştirmek için veritabanı şemasını senkronize edin.")}</p>
    </section>;
  }

  return <div className="services-shell" style={{ marginTop: 18 }}>
    <section className="services-metrics">
      <Metric icon={<Clock3 size={18}/>} label={c(locale, "Active requests", "Aktif talepler")} value={String(data.active)} meta={c(locale, "Governed operating state", "Yönetişimli operasyon durumu")}/>
      <Metric icon={<PauseCircle size={18}/>} label={c(locale, "SLA paused", "SLA duraklatıldı")} value={String(data.waiting)} meta={c(locale, "Waiting on employee / third party", "Çalışan / üçüncü taraf bekleniyor")}/>
      <Metric icon={<BadgeCheck size={18}/>} label={c(locale, "Resolved", "Çözülen")} value={String(data.resolved)} meta={c(locale, "Can be reopened before close", "Kapanmadan önce yeniden açılabilir")}/>
      <Metric icon={<MessageSquareText size={18}/>} label={c(locale, "Recorded transitions", "Kaydedilen geçişler")} value={String(data.transitions)} meta={c(locale, "Bounded visible scope", "Sınırlı görünür kapsam")}/>
    </section>

    {focusRequested ? <section className="card services-panel" style={{ padding: "10px 12px", borderColor: data.focusedRequestId ? "color-mix(in srgb,var(--accent) 35%,var(--line))" : "color-mix(in srgb,var(--orange) 35%,var(--line))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {data.focusedRequestId ? <Link2 size={16} style={{ color: "var(--accent)" }}/> : <AlertTriangle size={16} style={{ color: "var(--orange)" }}/>} 
        <div><strong style={{ display: "block", fontSize: 10.5 }}>{data.focusedRequestId ? c(locale, "Lifecycle link resolved", "Yaşam döngüsü bağlantısı bulundu") : c(locale, "Linked request is not visible", "Bağlantılı talep görünür değil")}</strong><small style={{ color: "var(--muted)" }}>{data.focusedRequestId ? c(locale, "The linked request is pinned to the top of the governed history below.", "Bağlantılı talep aşağıdaki yönetişimli geçmişte en üste sabitlendi.") : c(locale, "The request may be outside your authorized scope, removed, or the link may be stale. No broader fallback query was used.", "Talep yetkili kapsamınızın dışında, kaldırılmış veya bağlantı eski olabilir. Daha geniş bir yedek sorgu kullanılmadı.")}</small></div>
      </div>
    </section> : null}

    {canWrite ? <section className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">{c(locale, "Governed intake", "Yönetişimli talep girişi")}</span><h3>{c(locale, "Create an HR service request", "İK hizmet talebi oluştur")}</h3></div></div><HRServiceRequestForm locale={locale}/></section> : null}

    <section className="card services-panel">
      <div className="services-panel-head"><div><span className="section-kicker">{c(locale, "Immutable service lifecycle", "Değiştirilemez hizmet yaşam döngüsü")}</span><h3>{data.selfService ? c(locale, "My request history & replies", "Talep geçmişim ve yanıtlar") : c(locale, "Lifecycle operating controls", "Yaşam döngüsü operasyon kontrolleri")}</h3></div><span className="matrix-note">OPEN → TRIAGE → IN PROGRESS → RESOLVED → CLOSED</span></div>
      <div className="services-table-wrap"><table className="services-table"><thead><tr><th>{c(locale, "Request", "Talep")}</th><th>{c(locale, "Title", "Başlık")}</th><th>{c(locale, "Status", "Durum")}</th><th>SLA</th><th>{c(locale, "Routing", "Yönlendirme")}</th><th>{c(locale, "Last transition", "Son geçiş")}</th><th>{c(locale, "Evidence", "Kanıt")}</th>{canWrite ? <th>{c(locale, "Action", "Aksiyon")}</th> : null}</tr></thead>
      <tbody>{data.rows.length ? data.rows.slice(0, 40).map((row) => {
        const terminal = row.rawStatus === "CLOSED" || row.rawStatus === "CANCELLED";
        const focused = row.id === data.focusedRequestId;
        return <tr key={row.id} style={focused ? { background: "var(--accent-soft)", boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}>
          <td><strong>{row.requestNumber}</strong>{focused ? <small className="cell-sub">{c(locale, "Linked action", "Bağlantılı aksiyon")}</small> : <small className="cell-sub">{row.category} · {row.priority}</small>}</td>
          <td>{row.title}{focused ? <small className="cell-sub">{row.category} · {row.priority}</small> : null}</td>
          <td><em className={`services-pill ${row.rawStatus.toLowerCase().replace(/_/g, "-")}`}>{row.status}</em></td>
          <td>{row.slaPaused ? <><PauseCircle size={13}/> {c(locale, "Paused", "Duraklatıldı")}</> : row.sla}{row.escalationLevel ? <small className="cell-sub">L{row.escalationLevel} {c(locale, "escalation", "eskalasyon")}</small> : null}</td>
          <td>{row.queue}<small className="cell-sub">{row.assigneeId ? c(locale, "Assigned", "Atanmış") : c(locale, "Unassigned", "Atanmamış")}</small></td>
          <td>{row.lastTransition}<small className="cell-sub">{formatHRServiceLifecycleDate(row.lastTransitionAt)}</small></td>
          <td>{row.openPauseReason ?? row.lastTransitionReason ?? "—"}<small className="cell-sub">{row.lastTransitionActorId ? `${c(locale, "Actor", "İşlemi yapan")}: ${row.lastTransitionActorId}` : c(locale, "Domain evidence", "Domain kanıtı")}</small></td>
          {canWrite ? <td>{terminal ? <small>{c(locale, "Read only", "Salt okunur")}</small> : <HRServiceLifecycleActions requestId={row.id} status={row.rawStatus} locale={locale} staff={!data.selfService}/>}</td> : null}
        </tr>;
      }) : <tr><td colSpan={canWrite ? 8 : 7} style={{ textAlign: "center", padding: 26 }}>{c(locale, "No HR service requests are visible in this scope.", "Bu kapsamda görünür İK hizmet talebi bulunmuyor.")}</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
