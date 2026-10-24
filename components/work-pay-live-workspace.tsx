import Link from "next/link";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { AlertTriangle, BadgeDollarSign, CalendarCheck2, CheckCircle2, Clock3, Globe2, LockKeyhole, ReceiptText, ShieldCheck, TrendingUp, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getLeaveLiveData, getPayrollLiveData, getTimeAttendanceLiveData } from "@/lib/work-pay-live-data";
import { WorkPayWorkspace } from "@/components/work-pay-workspace";
import { LeaveDecisionButtons } from "@/components/leave-decision-buttons";
import { PayrollTransitionButton } from "@/components/payroll-transition-button";
import { TimeEntryTransitionButtons } from "@/components/time-entry-transition-buttons";

type TimeTarget = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED";
type TimeAccess = { selfEntry: boolean; operationalWrite: boolean; approve: boolean; lock: boolean };
type PayrollAccess = { prepare: boolean; approve: boolean; pay: boolean; configure: boolean };

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="workpay-metric card"><div className="workpay-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

// The live query returns a closed unit union. Keep both translations explicit;
// a new schema unit must be handled here rather than silently labelled as hours.
function leaveUnitLabel(unit: "DAYS" | "HOURS", locale: Locale): string {
  const labels = {
    DAYS: { en: "days", tr: "gün" },
    HOURS: { en: "hours", tr: "saat" }
  };
  return labels[unit][locale];
}

function Status({ value, locale = "en" }: { value: string; locale?: Locale }) {
  const labels: Record<string, string> = { Pending: "Bekliyor", Approved: "Onaylandı", Rejected: "Reddedildi", Cancelled: "İptal edildi", Taken: "Kullanıldı", Draft: "Taslak", Submitted: "Gönderildi", Locked: "Kilitlendi" };
  const display = locale === "tr" ? labels[value] ?? value : value;
  return <em className={`workpay-status ${value.toLowerCase().replace(/\s+/g, "-")}`}>{display}</em>;
}

function Restricted({ title, detail, returnTo }: { title: string; detail: string; returnTo: string }) {
  return <section className="card workpay-side restricted-side" style={{ minHeight: 260, display: "grid", placeItems: "center", textAlign: "center", padding: 36 }}><div style={{ maxWidth: 620 }}><LockKeyhole size={28} style={{ margin: "0 auto 12px" }}/><span className="section-kicker">Policy enforced</span><h3 style={{ margin: "5px 0 8px" }}>{title}</h3><p>{detail}</p><Link className="secondary-button" style={{ marginTop: 14 }} href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with enterprise SSO</Link></div></section>;
}

function money(currency: string, amount: number) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

function timeTargets(access: TimeAccess, actorEmploymentId: string | undefined, rowEmploymentId: string, status: TimeTarget): TimeTarget[] {
  const self = Boolean(actorEmploymentId && actorEmploymentId === rowEmploymentId);
  if ((status === "DRAFT" || status === "REJECTED") && ((self && access.selfEntry) || (!self && access.operationalWrite))) return ["SUBMITTED"];
  if (status === "SUBMITTED" && !self && access.approve) return ["APPROVED", "REJECTED"];
  if (status === "APPROVED" && !self && access.lock) return ["LOCKED"];
  return [];
}

export async function WorkPayLiveWorkspace({ slug, focusId }: { slug: "time-attendance" | "leave" | "payroll"; focusId?: string }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  if (!ctx) {
    if (slug === "payroll") return <Restricted title="Payroll is a restricted domain" detail="Payroll runs, gross/net results and statutory country-pack operations are never exposed through the public staging surface." returnTo="/module/payroll"/>;
    return <WorkPayWorkspace slug={slug}/>;
  }

  const capability = slug === "time-attendance" ? "time:read" : slug === "leave" ? "leave:read" : "payroll:read";
  if (!can(ctx, capability)) return <Restricted title={`${slug === "time-attendance" ? "Time & Attendance" : slug === "leave" ? "Leave" : "Payroll"} access is restricted`} detail={`Your authenticated role does not include ${capability}. Employee and manager access is relationship-scoped; payroll remains role-separated.`} returnTo={`/module/${slug}`}/>;

  if (slug === "time-attendance") {
    const data = await getTimeAttendanceLiveData(ctx, focusId);
    const access: TimeAccess = {
      selfEntry: can(ctx, "time:self-entry"),
      operationalWrite: can(ctx, "time:write"),
      approve: can(ctx, "time:approve"),
      lock: can(ctx, "time:lock")
    };
    const showControl = access.selfEntry || access.operationalWrite || access.approve || access.lock;
    return <div className="workpay-shell" data-workforce-live={slug} lang={locale}>
      {focusId && !data.focusVisible ? <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "10px 12px" }}><strong>{c("Requested time entry is not available in your governed scope.", "İstenen zaman kaydı erişim kapsamınızda bulunmuyor.")}</strong></section> : null}
      <section className="workpay-metrics">
        <Metric icon={<UsersRound size={18}/>} label={c("Expected today", "Bugün beklenen")} value={String(data.expected)} meta={c("Authorized employment population", "Yetki kapsamındaki çalışanlar")}/>
        <Metric icon={<Clock3 size={18}/>} label={c("Recorded", "Kaydedilen")} value={String(data.recorded)} meta={c(`${data.expected ? Math.round((data.recorded / data.expected) * 100) : 0}% of expected population`, `Beklenen çalışanların %${data.expected ? Math.round((data.recorded / data.expected) * 100) : 0}'i`)}/>
        <Metric icon={<TrendingUp size={18}/>} label={c("Overtime today", "Bugünkü fazla mesai")} value={`${Math.round((data.overtimeMinutes / 60) * 10) / 10} ${c("h", "sa")}`} meta={c("Tenant-scoped recorded overtime", "Kurum kapsamındaki kayıtlı fazla mesai")}/>
        <Metric icon={<AlertTriangle size={18}/>} label={c("Exceptions", "İstisnalar")} value={String(data.exceptions)} meta={c(`${data.scheduleCoverage}% schedule coverage`, `%${data.scheduleCoverage} çalışma takvimi kapsamı`)}/>
      </section>
      <section className="workpay-split">
        <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c("Live daily control", "Güncel günlük kontrol")}</span><h3>{c("Attendance operating view", "Zaman ve devam kayıtları")}</h3></div><span className="matrix-note">{c("Relationship scoped", "İlişki bazlı kapsam")}</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c("Employee", "Çalışan")}</th><th>{c("Organization", "Organizasyon")}</th><th>{c("In", "Giriş")}</th><th>{c("Out", "Çıkış")}</th><th>{c("Worked", "Çalışılan süre")}</th><th>{c("OT", "Fazla mesai")}</th><th>{c("Source", "Kaynak")}</th><th>{c("Status", "Durum")}</th>{showControl ? <th>{c("Control", "İşlem")}</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => {
          const targets = showControl ? timeTargets(access, ctx.employmentId, row.employmentId, row.rawStatus as TimeTarget) : [];
          return <tr key={row.id} className={row.focused ? "focused" : undefined}><td><strong>{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position}</small></td><td>{row.organization}</td><td>{row.startAt}</td><td>{row.endAt}</td><td>{Math.floor(row.minutes / 60)} {c("h", "sa")} {row.minutes % 60} {c("m", "dk")}</td><td>{row.overtimeMinutes ? `${Math.floor(row.overtimeMinutes / 60)} ${c("h", "sa")} ${row.overtimeMinutes % 60} ${c("m", "dk")}` : "—"}</td><td>{row.source}</td><td><Status value={row.status} locale={locale}/></td>{showControl ? <td><TimeEntryTransitionButtons entryId={row.id} targets={targets}/></td> : null}</tr>;
        }) : <tr><td colSpan={showControl ? 9 : 8} style={{ textAlign: "center", padding: 28 }}>{c("No time entries are recorded for today.", "Bugün için zaman kaydı bulunmuyor.")}</td></tr>}</tbody></table></div></div>
        <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">{c("Approval & payroll control", "Onay ve bordro kontrolü")}</span><h3>{c("Separated time authority", "Ayrılmış zaman yönetimi yetkileri")}</h3></div><ShieldCheck size={18}/></div><div className="control-stack"><div><ShieldCheck size={17}/><span><strong>{c("Employee self-service", "Çalışan self-servisi")}</strong><small>{c("Own drafts can be created and submitted only through signed employment identity.", "Çalışanlar yalnız doğrulanmış istihdam kimlikleriyle kendi taslaklarını oluşturup gönderebilir.")}</small></span></div><div><UsersRound size={17}/><span><strong>{c("Manager approval", "Yönetici onayı")}</strong><small>{c("Relationship-scoped reports can be approved or rejected; self-approval remains blocked.", "Yönetici, ilişki kapsamındaki çalışan kayıtlarını onaylayabilir veya reddedebilir; kendi kaydını onaylayamaz.")}</small></span></div><div><CheckCircle2 size={17}/><span><strong>{c("Payroll-ready lock", "Bordroya hazırlık kilidi")}</strong><small>{c("An effective schedule and valid interval are required. The approving actor cannot also perform the payroll lock.", "Geçerli bir çalışma takvimi ve zaman aralığı gerekir. Kaydı onaylayan kişi bordro kilidini uygulayamaz.")}</small></span></div></div></aside>
      </section>
    </div>;
  }

  if (slug === "leave") {
    const data = await getLeaveLiveData(ctx, focusId);
    const canApprove = can(ctx, "leave:approve");
    return <div className="workpay-shell" data-workforce-live={slug} lang={locale}>
      {focusId && !data.focusVisible ? <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "10px 12px" }}><strong>{c("Requested leave record is not available in your governed scope.", "İstenen izin kaydı erişim kapsamınızda bulunmuyor.")}</strong></section> : null}
      <section className="workpay-metrics">
        <Metric icon={<CalendarCheck2 size={18}/>} label={c("Pending requests", "Bekleyen talepler")} value={String(data.pending)} meta={c("Within current 60-day operating horizon", "Güncel 60 günlük işlem aralığında")}/>
        <Metric icon={<UsersRound size={18}/>} label={c("Away today", "Bugün izinli")} value={String(data.awayToday)} meta={c("Approved or taken leave", "Onaylanmış veya kullanılmış izin")}/>
        <Metric icon={<CheckCircle2 size={18}/>} label={c("Balance records", "Bakiye kayıtları")} value={String(data.balanceRecords)} meta={c("Current-year governed balances", "İçinde bulunulan yılın izin bakiyeleri")}/>
        <Metric icon={<TrendingUp size={18}/>} label={c("Avg. balance", "Ortalama bakiye")} value={String(data.averageRemaining)} meta={c("Opening + accrual + adjustment − used", "Açılış + hak ediş + düzeltme − kullanılan")}/>
      </section>
      <section className="workpay-split">
        <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c("Live leave operations", "Güncel izin işlemleri")}</span><h3>{c("Request & approval queue", "Talep ve onay kuyruğu")}</h3></div><span className="matrix-note">{c("Effective-dated policy", "Geçerlilik tarihli politika")}</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c("Employee", "Çalışan")}</th><th>{c("Type", "Tür")}</th><th>{c("Dates", "Tarihler")}</th><th>{c("Units", "Miktar")}</th><th>{c("Organization", "Organizasyon")}</th><th>{c("Status", "Durum")}</th>{canApprove ? <th>{c("Decision", "Karar")}</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id} className={row.focused ? "focused" : undefined}><td><strong>{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position}</small></td><td>{row.leaveType}</td><td>{row.startsAt} → {row.endsAt}</td><td>{row.units} {leaveUnitLabel(row.unit, locale)}</td><td>{row.organization}</td><td><Status value={row.status} locale={locale}/></td>{canApprove ? <td>{row.rawStatus === "PENDING" && row.employmentId !== ctx.employmentId ? <LeaveDecisionButtons requestId={row.id}/> : <span style={{ color: "var(--muted)" }}>—</span>}</td> : null}</tr>) : <tr><td colSpan={canApprove ? 7 : 6} style={{ textAlign: "center", padding: 28 }}>{c("No leave requests are in the operating horizon.", "İşlem aralığında izin talebi bulunmuyor.")}</td></tr>}</tbody></table></div></div>
        <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">{c("Approval control", "Onay kontrolü")}</span><h3>{c("No self-approval", "Kendi talebini onaylayamaz")}</h3></div><ShieldCheck size={18}/></div><p className="workforce-approval-description">{c("Managers can only view their relationship-scoped population. Their own request remains visible but cannot be approved from the manager decision path. HR operations can act through explicit approval authority.", "Yöneticiler yalnız ilişki kapsamındaki çalışanları görebilir. Kendi talepleri görünür kalır ancak yönetici onayıyla onaylanamaz. İK operasyonları yalnız açıkça tanımlanmış onay yetkisiyle işlem yapabilir.")}</p><div className="mini-rule"><span>{c("Scope", "Kapsam")}</span><strong>{c("Employment graph", "İstihdam ilişkileri")}</strong></div><div className="mini-rule"><span>{c("Decision audit", "Karar denetim kaydı")}</span><strong>{c("Enabled", "Etkin")}</strong></div><div className="mini-rule"><span>{c("Balance reservation", "Bakiye rezervasyonu")}</span><strong>{c("Atomic", "Tek işlemde")}</strong></div></aside>
      </section>
    </div>;
  }

  const data = await getPayrollLiveData(ctx, focusId);
  const payrollAccess: PayrollAccess = {
    prepare: can(ctx, "payroll:prepare"),
    approve: can(ctx, "payroll:approve"),
    pay: can(ctx, "payroll:pay"),
    configure: can(ctx, "payroll:configure")
  };
  const showPayrollControl = payrollAccess.prepare || payrollAccess.approve || payrollAccess.pay;
  return <div className="workpay-shell">
    {focusId && !data.focusVisible ? <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "10px 12px" }}><strong>Requested payroll run is not available in your governed tenant scope.</strong></section> : null}
    <section className="workpay-metrics">
      <Metric icon={<ReceiptText size={18}/>} label="Open payroll runs" value={String(data.openRuns)} meta="Excludes paid and cancelled runs"/>
      <Metric icon={<Globe2 size={18}/>} label="Country packs" value={String(data.activeCountryPacks)} meta={payrollAccess.configure ? "Configuration authority granted" : "Configuration is role-separated"}/>
      <Metric icon={<UsersRound size={18}/>} label="Result records" value={String(data.employeesInLatestRuns)} meta="Across loaded recent runs"/>
      <Metric icon={<LockKeyhole size={18}/>} label="Access boundary" value="Restricted" meta="Prepare · approve · pay are independently authorized"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Live payroll operations</span><h3>Country-pack run register</h3></div><span className="matrix-note">Input fingerprint protected</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Period / country</th><th>Run</th><th>Employees</th><th>Gross</th><th>Net</th><th>Employer cost</th><th>Pay date</th><th>Status</th>{showPayrollControl ? <th>Next control</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id} className={row.focused ? "focused" : undefined}><td><strong>{row.periodCode}</strong><small className="cell-sub">{row.country} · {row.countryCode} · pack {row.packVersion}</small></td><td>#{row.runNumber}<small className="cell-sub">Period: {row.periodStatus}</small></td><td>{row.employees}</td><td>{money(row.currency, row.gross)}</td><td>{money(row.currency, row.net)}</td><td>{money(row.currency, row.employerCost)}</td><td>{row.payDate}</td><td><Status value={row.status}/></td>{showPayrollControl ? <td><PayrollTransitionButton runId={row.id} status={row.rawStatus} access={payrollAccess}/></td> : null}</tr>) : <tr><td colSpan={showPayrollControl ? 9 : 8} style={{ textAlign: "center", padding: 28 }}>No payroll runs are recorded.</td></tr>}</tbody></table></div></div>
      <aside className="card workpay-side restricted-side"><div className="workpay-panel-head"><div><span className="section-kicker">Four-eyes payroll</span><h3>Locked-input state machine</h3></div><BadgeDollarSign size={18}/></div><div className="control-stack"><div><CheckCircle2 size={17}/><span><strong>Prepare & input lock</strong><small>Time must be locked; pending leave and unapplied compensation block validation. A SHA-256 fingerprint freezes governed inputs before calculation.</small></span></div><div><ShieldCheck size={17}/><span><strong>Independent approval</strong><small>The run creator cannot approve the run. Approval authority is distinct from payroll preparation.</small></span></div><div><LockKeyhole size={17}/><span><strong>Payment separation</strong><small>The payroll approver cannot mark the same run paid. Post-lock input drift blocks calculation, approval and payment.</small></span></div></div></aside>
    </section>
  </div>;
}
