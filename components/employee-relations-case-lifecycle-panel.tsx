import { AlertTriangle, BadgeCheck, FileLock2, Gavel, ShieldCheck } from "lucide-react";
import { can } from "@/lib/authorization";
import { getEmployeeRelationsLifecycleLiveData } from "@/lib/employee-relations-lifecycle-live-data";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";
import { EmployeeRelationsCaseLifecycleActions } from "@/components/employee-relations-case-lifecycle-actions";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function fmt(locale: Locale, value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(value));
}
function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) { return <div className="services-metric card"><div className="services-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>; }

export async function EmployeeRelationsCaseLifecyclePanel() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "cases:read")) return null;
  const data = await getEmployeeRelationsLifecycleLiveData(ctx);
  const canWrite = can(ctx, "cases:write");

  if (!data.schemaReady) return <section className="card services-panel" style={{ marginTop: 18 }}><div className="services-panel-head"><div><span className="section-kicker">{c(locale, "Case lifecycle evidence unavailable", "Vaka yaşam döngüsü kanıtı kullanılamıyor")}</span><h3>{c(locale, "Database schema sync required", "Veritabanı şema senkronizasyonu gerekli")}</h3></div><AlertTriangle size={18}/></div><p>{c(locale, "The existing Case Wall remains online. Sync the schema to activate immutable status and corrective-action transition evidence.", "Mevcut Vaka Duvarı çalışmaya devam eder. Değiştirilemez vaka ve düzeltici aksiyon geçiş kanıtlarını etkinleştirmek için şemayı senkronize edin.")}</p></section>;

  return <div className="services-shell" style={{ marginTop: 18 }}>
    <section className="services-metrics">
      <Metric icon={<FileLock2 size={18}/>} label={c(locale, "Case-wall scope", "Vaka duvarı kapsamı")} value={String(data.total)} meta={c(locale, "Owned or assigned only", "Yalnız sahip olunan / atanan")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale, "Investigating", "Soruşturuluyor")} value={String(data.investigating)} meta={c(locale, "Evidence gathering active", "Kanıt toplama aktif")}/>
      <Metric icon={<Gavel size={18}/>} label={c(locale, "Action required", "Aksiyon gerekli")} value={String(data.actionRequired)} meta={c(locale, `${data.resolutionBlocked} blocked from resolution`, `${data.resolutionBlocked} çözüm için bloklu`)}/>
      <Metric icon={<BadgeCheck size={18}/>} label={c(locale, "Ready to close", "Kapanışa hazır")} value={String(data.readyToClose)} meta={c(locale, "Resolved with no active appeal", "Çözüldü, aktif itiraz yok")}/>
    </section>

    <section className="card services-panel">
      <div className="services-panel-head"><div><span className="section-kicker">{c(locale, "Governed case lifecycle", "Yönetişimli vaka yaşam döngüsü")}</span><h3>{c(locale, "Resolution & closure gates", "Çözüm ve kapanış kontrolleri")}</h3></div><span className="matrix-note">OPEN → INVESTIGATING → ACTION REQUIRED → RESOLVED → CLOSED</span></div>
      <div className="services-table-wrap"><table className="services-table"><thead><tr><th>{c(locale, "Case", "Vaka")}</th><th>{c(locale, "Status", "Durum")}</th><th>{c(locale, "Open allegations", "Açık iddialar")}</th><th>{c(locale, "Open actions", "Açık aksiyonlar")}</th><th>{c(locale, "Appeals", "İtirazlar")}</th><th>{c(locale, "Findings", "Bulgular")}</th><th>{c(locale, "Last transition", "Son geçiş")}</th><th>{c(locale, "Gate", "Kontrol")}</th>{canWrite ? <th>{c(locale, "Action", "Aksiyon")}</th> : null}</tr></thead>
      <tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}>
        <td><strong>{row.caseNumber}</strong><small className="cell-sub">{row.caseType} · {row.title}</small></td>
        <td><em className={`services-pill ${row.status.toLowerCase().replace(/_/g, "-")}`}>{row.statusLabel}</em></td>
        <td>{row.openAllegations}</td><td>{row.openActions}</td><td>{row.activeAppeals}</td><td>{row.findings}</td>
        <td>{row.lastTransition ?? c(locale, "Created", "Oluşturuldu")}<small className="cell-sub">{fmt(locale, row.lastTransitionAt)}{row.lastTransitionActorId ? ` · ${row.lastTransitionActorId}` : ""}</small></td>
        <td>{row.readyToClose ? <><BadgeCheck size={14}/> {c(locale, "Close ready", "Kapanışa hazır")}</> : row.readyToResolve ? c(locale, "Resolution ready", "Çözüme hazır") : row.status === "CLOSED" ? c(locale, "Terminal", "Terminal") : c(locale, "Work remains", "İş devam ediyor")}</td>
        {canWrite ? <td><EmployeeRelationsCaseLifecycleActions caseId={row.id} status={row.status} locale={locale} actions={row.actions.map((action) => ({ id: action.id, actionType: action.actionType, status: action.status, ownerId: action.ownerId, dueAt: action.dueAt }))}/></td> : null}
      </tr>) : <tr><td colSpan={canWrite ? 9 : 8} style={{ textAlign: "center", padding: 26 }}>{c(locale, "No cases are visible in your case wall.", "Vaka duvarınızda görünür vaka bulunmuyor.")}</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
