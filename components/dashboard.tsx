import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarClock, ChevronRight, CircleCheckBig, Clock3, Ellipsis, FileWarning, ShieldCheck, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { getDashboardData } from "@/lib/dashboard-data";

function dayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul"
  }).format(new Date());
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Istanbul"
  }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export async function Dashboard() {
  const data = await getDashboardData();
  const maxPlan = Math.max(...data.headcountSeries.map((item) => item.plan), 1);
  const yoyTrend = data.yoyChange >= 0 ? "up" : "down";
  const yoyLabel = `${Math.abs(data.yoyChange).toFixed(1)}% YoY`;

  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow">{dayLabel()}</div><h1>{greeting()}, Yakup.</h1><p>Live workforce signals from {data.tenantName}.</p></div>
        <button className="secondary-button">Customize dashboard</button>
      </section>

      <section className="ai-brief">
        <div className="ai-orb"><Sparkles size={20}/></div>
        <div className="ai-copy"><div className="section-kicker">AI morning brief</div><h2>Three workforce signals deserve your attention.</h2><p>{data.upcomingStarters} starters are scheduled in the next 30 days, {data.criticalOpenPositions} critical positions remain open, and {data.openCases} employee-relations cases require active management.</p></div>
        <button>View full brief <ChevronRight size={16}/></button>
      </section>

      <section className="metrics-grid">
        <Metric label="Total workforce" value={String(data.totalWorkforce)} meta={`${data.startedThisMonth} started this month`} trend="up" icon={<UsersRound size={18}/>} />
        <Metric label="Open positions" value={String(data.openPositions)} meta={`${data.criticalOpenPositions} critical roles`} icon={<BriefcaseBusiness size={18}/>} />
        <Metric label="New starters" value={String(data.upcomingStarters)} meta="Next 30 days" trend="up" icon={<UserPlus size={18}/>} />
        <Metric label="Open HR cases" value={String(data.openCases)} meta="Restricted case wall" trend={data.openCases ? "down" : undefined} icon={<ShieldCheck size={18}/>} />
      </section>

      <section className="dashboard-grid two-thirds">
        <div className="card workforce-card">
          <CardHeader title="Workforce overview" subtitle="Headcount, last 12 months" action="View analytics" />
          <div className="workforce-summary"><div><span>Current headcount</span><strong>{data.totalWorkforce}</strong><small>{yoyTrend === "up" ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {yoyLabel}</small></div><div className="legend"><span><i className="legend-current"/>Employees</span><span><i className="legend-open"/>Plan</span></div></div>
          <div className="bar-chart">{data.headcountSeries.map((item) => <div className="bar-col" key={item.label}><div className="bar-plan" style={{height:`${Math.max((item.plan / maxPlan) * 100, 8)}%`}}/><div className="bar-actual" style={{height:`${Math.max((item.actual / maxPlan) * 100, item.actual ? 7 : 0)}%`}}/><span>{item.label}</span></div>)}</div>
        </div>

        <div className="card action-card">
          <CardHeader title="Needs attention" subtitle="Prioritized from live records" />
          <div className="attention-list">
            <Attention icon={<CalendarClock size={17}/>} tone="amber" title="Upcoming starters" detail={`${data.upcomingStarters} people start within 30 days`} tag="Onboarding" />
            <Attention icon={<FileWarning size={17}/>} tone="red" title="Employee relations" detail={`${data.openCases} active restricted cases`} tag={data.openCases ? "Review" : "Clear"} />
            <Attention icon={<BriefcaseBusiness size={17}/>} tone="purple" title="Critical vacancies" detail={`${data.criticalOpenPositions} critical positions remain open`} tag="Hiring" />
            <Attention icon={<Clock3 size={17}/>} tone="blue" title="Onboarding plans" detail={`${data.onboardingInProgress} plans in progress`} tag={`${data.onboardingInProgress} items`} />
          </div>
          <button className="card-footer-button">Open action center <ChevronRight size={15}/></button>
        </div>
      </section>

      <section className="dashboard-grid half">
        <div className="card">
          <CardHeader title="Organization health" subtitle="Active workforce distribution" action="Open org chart" />
          <div className="department-list">{data.departments.map(({name,count,pct}) => <div className="department-row" key={name}><div className="dept-main"><span>{name}</span><strong>{count}</strong></div><div className="dept-track"><i style={{width:`${Math.min(pct * 2.1, 100)}%`}}/></div><small>{pct}%</small></div>)}</div>
        </div>
        <div className="card">
          <CardHeader title="Lifecycle activity" subtitle="This month" action="View all" />
          <div className="lifecycle-grid">
            <Lifecycle icon={<UserPlus size={17}/>} value={String(data.lifecycle.starters)} label="Starters" helper={`${data.onboardingInProgress} onboarding`} />
            <Lifecycle icon={<ArrowUpRight size={17}/>} value={String(data.lifecycle.promotions)} label="Promotions" helper="Effective-dated" />
            <Lifecycle icon={<BriefcaseBusiness size={17}/>} value={String(data.lifecycle.transfers)} label="Transfers" helper="Effective-dated" />
            <Lifecycle icon={<ArrowDownRight size={17}/>} value={String(data.lifecycle.leavers)} label="Leavers" helper="This month" />
          </div>
          <div className="timeline">
            {data.recentEvents.slice(0, 3).map((event, index) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${index === 0 ? "green" : index === 1 ? "amber" : "teal"}`}/><div><strong>{event.name} · {event.event}</strong><small>{event.org}</small></div><time>{event.date}</time></div>)}
          </div>
        </div>
      </section>

      <section className="dashboard-grid two-thirds bottom-grid">
        <div className="card">
          <CardHeader title="Recent people changes" subtitle="Effective-dated employee events" action="View event ledger" />
          <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Event</th><th>Organization</th><th>Effective</th><th>Status</th></tr></thead><tbody>
            {data.recentEvents.slice(0, 4).map((event) => <EventRow key={event.id} avatar={event.initials} name={event.name} event={event.event} org={event.org} date={event.date} status={event.status} />)}
          </tbody></table></div>
        </div>
        <div className="card trust-card">
          <CardHeader title="Data & governance" subtitle="Platform trust posture" />
          <div className="trust-score"><div className="score-ring"><span>96</span><small>/100</small></div><div><strong>Healthy</strong><p>Privacy, access and retention controls are operating normally.</p></div></div>
          <div className="trust-list"><div><CircleCheckBig size={16}/><span>PostgreSQL / Hyperdrive data path</span><strong>Healthy</strong></div><div><CircleCheckBig size={16}/><span>RBAC / ABAC policy engine</span><strong>Healthy</strong></div><div><CircleCheckBig size={16}/><span>Effective-dated people ledger</span><strong>Active</strong></div><div><ShieldCheck size={16}/><span>Restricted case wall</span><strong>Protected</strong></div></div>
        </div>
      </section>
    </>
  );
}

function CardHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: string }) { return <div className="card-header"><div><h3>{title}</h3><p>{subtitle}</p></div>{action ? <button>{action}<ChevronRight size={15}/></button> : <button className="more-button"><Ellipsis size={18}/></button>}</div>; }
function Metric({ label, value, meta, trend, icon }: { label:string; value:string; meta:string; trend?:"up"|"down"; icon:React.ReactNode }) { return <div className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><button><Ellipsis size={17}/></button></div><span className="metric-label">{label}</span><div className="metric-value">{value}</div><div className={`metric-meta ${trend || ""}`}>{trend === "up" && <ArrowUpRight size={14}/>} {trend === "down" && <ArrowDownRight size={14}/>} {meta}</div></div>; }
function Attention({icon,tone,title,detail,tag}:{icon:React.ReactNode;tone:string;title:string;detail:string;tag:string}) { return <button className="attention-row"><span className={`attention-icon ${tone}`}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><em>{tag}</em><ChevronRight size={15}/></button>; }
function Lifecycle({icon,value,label,helper}:{icon:React.ReactNode;value:string;label:string;helper:string}) { return <div className="lifecycle-item"><span>{icon}</span><strong>{value}</strong><p>{label}</p><small>{helper}</small></div>; }
function EventRow({avatar,name,event,org,date,status}:{avatar:string;name:string;event:string;org:string;date:string;status:string}) { return <tr><td><div className="person-cell"><span>{avatar}</span><strong>{name}</strong></div></td><td>{event}</td><td>{org}</td><td>{date}</td><td><em className={`status ${status.toLowerCase()}`}>{status}</em></td></tr>; }
