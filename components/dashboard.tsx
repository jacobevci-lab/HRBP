import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarClock, ChevronRight, CircleAlert, CircleCheckBig, Clock3, FileWarning, ShieldCheck, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getDashboardDataSafe } from "@/lib/dashboard-safe";
import { getDashboardLifecycleAttentionSafe } from "@/lib/dashboard-lifecycle-attention";
import { getServerLocale } from "@/lib/i18n-server";
import { translate, type Locale, type TranslationKey } from "@/lib/i18n";
import { getServerSessionClaims } from "@/lib/server-session";

function dayLabel(locale: Locale) {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul"
  }).format(new Date());
}

function greeting(locale: Locale) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Istanbul"
  }).format(new Date()));
  if (hour < 12) return translate(locale, "dashboard.goodMorning");
  if (hour < 18) return translate(locale, "dashboard.goodAfternoon");
  return translate(locale, "dashboard.goodEvening");
}

function localizedStatus(locale: Locale, status: string) {
  const normalized = status.trim().toUpperCase();
  if (locale !== "tr") return status;
  const values: Record<string, string> = {
    ACTIVE: "Aktif",
    SCHEDULED: "Planlandı",
    COMPLETED: "Tamamlandı",
    APPROVED: "Onaylandı",
    PENDING: "Bekliyor",
    OPEN: "Açık",
    CLOSED: "Kapalı"
  };
  return values[normalized] ?? status;
}

function attentionCopy(locale: Locale, key: "critical" | "overdue" | "hr-service" | "employee-relations", count: number) {
  const tr = {
    critical: { title: "Kritik yaşam döngüsü aksiyonları", detail: `${count} kritik aksiyon veya operasyonel blokaj bekliyor` },
    overdue: { title: "Geciken aksiyonlar", detail: `${count} aksiyon hedef tarihini geçti` },
    "hr-service": { title: "İK hizmet aksiyonları", detail: `${count} hizmet talebi yanıt, atama veya operasyonel takip bekliyor` },
    "employee-relations": { title: "Çalışan ilişkileri aksiyonları", detail: `${count} yetkili vaka aksiyonu veya itiraz incelemesi bekliyor` }
  } as const;
  const en = {
    critical: { title: "Critical lifecycle actions", detail: `${count} critical actions or operational blockers are pending` },
    overdue: { title: "Overdue actions", detail: `${count} actions are past their target date` },
    "hr-service": { title: "HR service actions", detail: `${count} service requests need response, assignment or operational follow-up` },
    "employee-relations": { title: "Employee relations actions", detail: `${count} authorized case actions or appeal reviews are pending` }
  } as const;
  return (locale === "tr" ? tr : en)[key];
}

export async function Dashboard() {
  const [locale, session, dashboard, lifecycleAttention] = await Promise.all([
    getServerLocale(),
    getServerSessionClaims(),
    getDashboardDataSafe(),
    getDashboardLifecycleAttentionSafe()
  ]);
  const t = (key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const { data, degraded } = dashboard;
  const actionSummary = lifecycleAttention.summary;
  const actionDataDegraded = lifecycleAttention.degraded;
  const ctx = session ? { tenantId: session.tenantId, actorId: session.actorId, role: session.role, employmentId: session.employmentId } : null;
  const firstName = session?.displayName?.trim().split(/\s+/)[0] || (locale === "tr" ? "ekip" : "team");
  const maxPlan = Math.max(...data.headcountSeries.map((item) => item.plan), 1);
  const yoyTrend = data.yoyChange >= 0 ? "up" : "down";
  const yoyLabel = locale === "tr" ? `%${Math.abs(data.yoyChange).toFixed(1)} yıllık` : `${Math.abs(data.yoyChange).toFixed(1)}% YoY`;
  const links = {
    analytics: ctx && can(ctx, "analytics:read") ? "/module/analytics" : null,
    organization: ctx && can(ctx, "organization:read") ? "/module/organization" : null,
    onboarding: ctx && can(ctx, "onboarding:read") ? "/module/onboarding" : null,
    cases: ctx && can(ctx, "cases:read") ? "/module/employee-relations" : null,
    hrService: ctx && can(ctx, "hr-service:read") ? "/module/hr-service" : null,
    recruiting: ctx && can(ctx, "recruiting:read") ? "/module/recruiting" : null,
    people: ctx && can(ctx, "people:read") ? "/module/people" : null,
    audit: ctx && can(ctx, "audit:read") ? "/module/audit" : null,
    settings: ctx && can(ctx, "settings:read") ? "/module/settings" : null,
    ai: ctx && can(ctx, "ai:use") ? "/module/ai-assistant" : null,
    workflows: session ? "/module/workflows" : null
  };
  const criticalCopy = attentionCopy(locale, "critical", actionSummary.critical);
  const overdueCopy = attentionCopy(locale, "overdue", actionSummary.overdue);
  const serviceCopy = attentionCopy(locale, "hr-service", actionSummary.hrService);
  const relationsCopy = attentionCopy(locale, "employee-relations", actionSummary.employeeRelations);

  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow">{dayLabel(locale)}</div><h1>{greeting(locale)}, {firstName}.</h1><p>{degraded ? t("dashboard.safeSignals") : t("dashboard.liveSignals", { tenant: data.tenantName })}</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {degraded ? <button className="secondary-button" disabled><CircleAlert size={15}/> {t("dashboard.safeFallback")}</button> : null}
          {links.settings ? <Link className="secondary-button" href={links.settings}>{t("dashboard.customize")}</Link> : null}
        </div>
      </section>

      {degraded ? <section className="card" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <CircleAlert size={18} style={{ flex: "0 0 auto", marginTop: 1, color: "var(--orange)" }}/>
        <div><strong style={{ display: "block", fontSize: 11 }}>{t("dashboard.liveUnavailable")}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "var(--muted)" }}>{t("dashboard.fallbackDetail")}</p></div>
      </section> : null}

      <section className="ai-brief">
        <div className="ai-orb"><Sparkles size={20}/></div>
        <div className="ai-copy"><div className="section-kicker">{t("dashboard.aiMorningBrief")}</div><h2>{t("dashboard.aiHeadline")}</h2><p>{t("dashboard.aiDetail", { starters: data.upcomingStarters, positions: data.criticalOpenPositions, cases: data.openCases })}</p></div>
        {links.ai ? <Link href={links.ai}>{t("dashboard.viewFullBrief")} <ChevronRight size={16}/></Link> : null}
      </section>

      <section className="metrics-grid">
        <Metric label={t("dashboard.totalWorkforce")} value={String(data.totalWorkforce)} meta={t("dashboard.startedThisMonth", { count: data.startedThisMonth })} trend="up" icon={<UsersRound size={18}/>} href={links.people} />
        <Metric label={t("dashboard.openPositions")} value={String(data.openPositions)} meta={t("dashboard.criticalRoles", { count: data.criticalOpenPositions })} icon={<BriefcaseBusiness size={18}/>} href={links.recruiting} />
        <Metric label={t("dashboard.newStarters")} value={String(data.upcomingStarters)} meta={t("dashboard.next30Days")} trend="up" icon={<UserPlus size={18}/>} href={links.onboarding} />
        <Metric label={t("dashboard.openHrCases")} value={String(data.openCases)} meta={t("dashboard.restrictedCaseWall")} trend={data.openCases ? "down" : undefined} icon={<ShieldCheck size={18}/>} href={links.cases} />
      </section>

      <section className="dashboard-grid two-thirds">
        <div className="card workforce-card">
          <CardHeader title={t("dashboard.workforceOverview")} subtitle={t("dashboard.headcount12")} action={t("dashboard.viewAnalytics")} href={links.analytics} />
          <div className="workforce-summary"><div><span>{t("dashboard.currentHeadcount")}</span><strong>{data.totalWorkforce}</strong><small>{yoyTrend === "up" ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {yoyLabel}</small></div><div className="legend"><span><i className="legend-current"/>{t("dashboard.employees")}</span><span><i className="legend-open"/>{t("dashboard.plan")}</span></div></div>
          <div className="bar-chart">{data.headcountSeries.map((item) => <div className="bar-col" key={item.label}><div className="bar-plan" style={{height:`${Math.max((item.plan / maxPlan) * 100, 8)}%`}}/><div className="bar-actual" style={{height:`${Math.max((item.actual / maxPlan) * 100, item.actual ? 7 : 0)}%`}}/><span>{item.label}</span></div>)}</div>
        </div>

        <div className="card action-card">
          <CardHeader title={t("dashboard.needsAttention")} subtitle={actionDataDegraded ? t("dashboard.safePriorities") : (locale === "tr" ? "Yetkili yaşam döngüsü kuyruğundan önceliklendirildi" : "Prioritized from your authorized lifecycle queue")} />
          <div className="attention-list">
            {!actionDataDegraded ? <>
              <Attention icon={<CircleAlert size={17}/>} tone="red" title={criticalCopy.title} detail={criticalCopy.detail} tag={t("dashboard.items", { count: actionSummary.critical })} href={links.workflows} />
              <Attention icon={<Clock3 size={17}/>} tone="amber" title={overdueCopy.title} detail={overdueCopy.detail} tag={t("dashboard.items", { count: actionSummary.overdue })} href={links.workflows} />
              <Attention icon={<FileWarning size={17}/>} tone="sage" title={serviceCopy.title} detail={serviceCopy.detail} tag={t("dashboard.items", { count: actionSummary.hrService })} href={links.hrService ?? links.workflows} />
              <Attention icon={<ShieldCheck size={17}/>} tone="purple" title={relationsCopy.title} detail={relationsCopy.detail} tag={t("dashboard.items", { count: actionSummary.employeeRelations })} href={links.cases ?? links.workflows} />
            </> : <>
              <Attention icon={<CalendarClock size={17}/>} tone="amber" title={t("dashboard.upcomingStarters")} detail={t("dashboard.peopleStart", { count: data.upcomingStarters })} tag={t("nav.onboarding")} href={links.onboarding} />
              <Attention icon={<FileWarning size={17}/>} tone="red" title={t("dashboard.employeeRelations")} detail={t("dashboard.activeCases", { count: data.openCases })} tag={data.openCases ? t("dashboard.review") : t("dashboard.clear")} href={links.cases} />
              <Attention icon={<BriefcaseBusiness size={17}/>} tone="purple" title={t("dashboard.criticalVacancies")} detail={t("dashboard.positionsRemainOpen", { count: data.criticalOpenPositions })} tag={t("dashboard.hiring")} href={links.recruiting} />
              <Attention icon={<Clock3 size={17}/>} tone="sage" title={t("dashboard.onboardingPlans")} detail={t("dashboard.plansInProgress", { count: data.onboardingInProgress })} tag={t("dashboard.items", { count: data.onboardingInProgress })} href={links.onboarding} />
            </>}
          </div>
          {links.workflows ? <Link className="card-footer-button" href={links.workflows}>{t("dashboard.openActionCenter")} {actionDataDegraded ? null : <strong>{actionSummary.total}</strong>} <ChevronRight size={15}/></Link> : null}
        </div>
      </section>

      <section className="dashboard-grid half">
        <div className="card">
          <CardHeader title={t("dashboard.organizationHealth")} subtitle={t("dashboard.activeWorkforceDistribution")} action={t("dashboard.openOrgChart")} href={links.organization} />
          <div className="department-list">{data.departments.map(({name,count,pct}) => <div className="department-row" key={name}><div className="dept-main"><span>{name}</span><strong>{count}</strong></div><div className="dept-track"><i style={{width:`${Math.min(pct * 2.1, 100)}%`}}/></div><small>{pct}%</small></div>)}</div>
        </div>
        <div className="card">
          <CardHeader title={t("dashboard.lifecycleActivity")} subtitle={t("dashboard.thisMonth")} action={t("dashboard.viewAll")} href={links.people} />
          <div className="lifecycle-grid">
            <Lifecycle icon={<UserPlus size={17}/>} value={String(data.lifecycle.starters)} label={t("dashboard.starters")} helper={t("dashboard.onboardingCount", { count: data.onboardingInProgress })} />
            <Lifecycle icon={<ArrowUpRight size={17}/>} value={String(data.lifecycle.promotions)} label={t("dashboard.promotions")} helper={t("dashboard.effectiveDated")} />
            <Lifecycle icon={<BriefcaseBusiness size={17}/>} value={String(data.lifecycle.transfers)} label={t("dashboard.transfers")} helper={t("dashboard.effectiveDated")} />
            <Lifecycle icon={<ArrowDownRight size={17}/>} value={String(data.lifecycle.leavers)} label={t("dashboard.leavers")} helper={t("dashboard.thisMonth")} />
          </div>
          <div className="timeline">
            {data.recentEvents.slice(0, 3).map((event, index) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${index === 0 ? "green" : index === 1 ? "amber" : "teal"}`}/><div><strong>{event.name} · {event.event}</strong><small>{event.org}</small></div><time>{event.date}</time></div>)}
          </div>
        </div>
      </section>

      <section className="dashboard-grid two-thirds bottom-grid">
        <div className="card">
          <CardHeader title={t("dashboard.recentPeopleChanges")} subtitle={t("dashboard.employeeEvents")} action={t("dashboard.viewEventLedger")} href={links.audit} />
          <div className="table-wrap"><table><thead><tr><th>{t("dashboard.employee")}</th><th>{t("dashboard.event")}</th><th>{t("dashboard.organization")}</th><th>{t("dashboard.effective")}</th><th>{t("dashboard.status")}</th></tr></thead><tbody>
            {data.recentEvents.slice(0, 4).map((event) => <EventRow key={event.id} avatar={event.initials} name={event.name} event={event.event} org={event.org} date={event.date} status={event.status} displayStatus={localizedStatus(locale, event.status)} />)}
          </tbody></table></div>
        </div>
        <div className="card trust-card">
          <CardHeader title={t("dashboard.dataGovernance")} subtitle={t("dashboard.platformTrust")} />
          <div className="trust-score"><div className="score-ring"><span>{degraded ? "82" : "96"}</span><small>/100</small></div><div><strong>{degraded ? t("dashboard.degraded") : t("dashboard.healthy")}</strong><p>{degraded ? t("dashboard.degradedDetail") : t("dashboard.healthyDetail")}</p></div></div>
          <div className="trust-list"><div>{degraded ? <CircleAlert size={16}/> : <CircleCheckBig size={16}/>}<span>{t("dashboard.dataPath")}</span><strong>{degraded ? t("dashboard.recovering") : t("dashboard.healthy")}</strong></div><div><CircleCheckBig size={16}/><span>{t("dashboard.policyEngine")}</span><strong>{t("dashboard.healthy")}</strong></div><div><CircleCheckBig size={16}/><span>{t("dashboard.peopleLedger")}</span><strong>{t("dashboard.active")}</strong></div><div><ShieldCheck size={16}/><span>{t("dashboard.caseWall")}</span><strong>{t("dashboard.protected")}</strong></div></div>
        </div>
      </section>
    </>
  );
}

function CardHeader({ title, subtitle, action, href }: { title: string; subtitle: string; action?: string; href?: string | null }) {
  return <div className="card-header"><div><h3>{title}</h3><p>{subtitle}</p></div>{action && href ? <Link href={href}>{action}<ChevronRight size={15}/></Link> : null}</div>;
}
function Metric({ label, value, meta, trend, icon, href }: { label:string; value:string; meta:string; trend?:"up"|"down"; icon:React.ReactNode; href?:string|null }) {
  const body = <><div className="metric-top"><span className="metric-icon">{icon}</span></div><span className="metric-label">{label}</span><div className="metric-value">{value}</div><div className={`metric-meta ${trend || ""}`}>{trend === "up" && <ArrowUpRight size={14}/>} {trend === "down" && <ArrowDownRight size={14}/>} {meta}</div></>;
  return href ? <Link className="metric-card" href={href}>{body}</Link> : <div className="metric-card">{body}</div>;
}
function Attention({icon,tone,title,detail,tag,href}:{icon:React.ReactNode;tone:string;title:string;detail:string;tag:string;href?:string|null}) {
  const body = <><span className={`attention-icon ${tone}`}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><em>{tag}</em><ChevronRight size={15}/></>;
  return href ? <Link className="attention-row" href={href}>{body}</Link> : <div className="attention-row">{body}</div>;
}
function Lifecycle({icon,value,label,helper}:{icon:React.ReactNode;value:string;label:string;helper:string}) { return <div className="lifecycle-item"><span>{icon}</span><strong>{value}</strong><p>{label}</p><small>{helper}</small></div>; }
function EventRow({avatar,name,event,org,date,status,displayStatus}:{avatar:string;name:string;event:string;org:string;date:string;status:string;displayStatus:string}) { return <tr><td><div className="person-cell"><span>{avatar}</span><strong>{name}</strong></div></td><td>{event}</td><td>{org}</td><td>{date}</td><td><em className={`status ${status.toLowerCase()}`}>{displayStatus}</em></td></tr>; }
