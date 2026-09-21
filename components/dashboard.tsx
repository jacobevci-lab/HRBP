import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarClock, ChevronRight, CircleCheckBig, Clock3, Ellipsis, FileWarning, ShieldCheck, Sparkles, UserPlus, UsersRound } from "lucide-react";

const bars = [42, 52, 48, 61, 58, 69, 73, 77, 74, 82, 87, 91];
const departments = [
  ["Engineering", 184, 36], ["Sales", 128, 25], ["Operations", 86, 17], ["Finance", 48, 9], ["People", 35, 7], ["Security", 29, 6]
] as const;

export function Dashboard() {
  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow">Sunday, 21 September</div><h1>Good afternoon, Yakup.</h1><p>Here is what needs attention across your workforce today.</p></div>
        <button className="secondary-button">Customize dashboard</button>
      </section>

      <section className="ai-brief">
        <div className="ai-orb"><Sparkles size={20}/></div>
        <div className="ai-copy"><div className="section-kicker">AI morning brief</div><h2>Three workforce signals deserve your attention.</h2><p>Engineering has 4 probation reviews due this week, two critical positions remain without successors, and 3 employee-relations actions are approaching SLA.</p></div>
        <button>View full brief <ChevronRight size={16}/></button>
      </section>

      <section className="metrics-grid">
        <Metric label="Total workforce" value="510" meta="12 this month" trend="up" icon={<UsersRound size={18}/>} />
        <Metric label="Open positions" value="24" meta="6 critical roles" icon={<BriefcaseBusiness size={18}/>} />
        <Metric label="New starters" value="18" meta="Next 30 days" trend="up" icon={<UserPlus size={18}/>} />
        <Metric label="Open HR cases" value="7" meta="3 need attention" trend="down" icon={<ShieldCheck size={18}/>} />
      </section>

      <section className="dashboard-grid two-thirds">
        <div className="card workforce-card">
          <CardHeader title="Workforce overview" subtitle="Headcount, last 12 months" action="View analytics" />
          <div className="workforce-summary"><div><span>Current headcount</span><strong>510</strong><small><ArrowUpRight size={14}/> 8.3% YoY</small></div><div className="legend"><span><i className="legend-current"/>Employees</span><span><i className="legend-open"/>Plan</span></div></div>
          <div className="bar-chart">{bars.map((height, index) => <div className="bar-col" key={index}><div className="bar-plan" style={{height:`${Math.min(height + 8, 100)}%`}}/><div className="bar-actual" style={{height:`${height}%`}}/><span>{["Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep"][index]}</span></div>)}</div>
        </div>

        <div className="card action-card">
          <CardHeader title="Needs attention" subtitle="Prioritized for you" />
          <div className="attention-list">
            <Attention icon={<CalendarClock size={17}/>} tone="amber" title="Probation reviews" detail="4 reviews due within 7 days" tag="Due soon" />
            <Attention icon={<FileWarning size={17}/>} tone="red" title="Employee relations" detail="3 actions approaching SLA" tag="High" />
            <Attention icon={<BriefcaseBusiness size={17}/>} tone="purple" title="Succession gaps" detail="2 critical roles uncovered" tag="Review" />
            <Attention icon={<Clock3 size={17}/>} tone="blue" title="Overdue approvals" detail="6 workflow tasks waiting" tag="6 items" />
          </div>
          <button className="card-footer-button">Open action center <ChevronRight size={15}/></button>
        </div>
      </section>

      <section className="dashboard-grid half">
        <div className="card">
          <CardHeader title="Organization health" subtitle="Workforce distribution" action="Open org chart" />
          <div className="department-list">{departments.map(([name,count,pct]) => <div className="department-row" key={name}><div className="dept-main"><span>{name}</span><strong>{count}</strong></div><div className="dept-track"><i style={{width:`${pct*2.1}%`}}/></div><small>{pct}%</small></div>)}</div>
        </div>
        <div className="card">
          <CardHeader title="Lifecycle activity" subtitle="This month" action="View all" />
          <div className="lifecycle-grid">
            <Lifecycle icon={<UserPlus size={17}/>} value="18" label="Starters" helper="6 onboarding" />
            <Lifecycle icon={<ArrowUpRight size={17}/>} value="11" label="Promotions" helper="8 completed" />
            <Lifecycle icon={<BriefcaseBusiness size={17}/>} value="9" label="Transfers" helper="3 pending" />
            <Lifecycle icon={<ArrowDownRight size={17}/>} value="7" label="Leavers" helper="1 involuntary" />
          </div>
          <div className="timeline"><div className="timeline-item"><span className="timeline-dot green"/><div><strong>Elena Rossi starts today</strong><small>Product · Senior Product Manager</small></div><time>09:00</time></div><div className="timeline-item"><span className="timeline-dot amber"/><div><strong>3 contracts expire in 30 days</strong><small>Legal review recommended</small></div><time>Today</time></div><div className="timeline-item"><span className="timeline-dot teal"/><div><strong>Payroll input closes</strong><small>September 2026 payroll</small></div><time>2 days</time></div></div>
        </div>
      </section>

      <section className="dashboard-grid two-thirds bottom-grid">
        <div className="card">
          <CardHeader title="Recent people changes" subtitle="Effective-dated employee events" action="View event ledger" />
          <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Event</th><th>Organization</th><th>Effective</th><th>Status</th></tr></thead><tbody>
            <EventRow avatar="MR" name="Maya Rao" event="Promotion" org="Engineering" date="1 Oct 2026" status="Approved" />
            <EventRow avatar="DS" name="David Stein" event="Manager change" org="Sales" date="26 Sep 2026" status="Scheduled" />
            <EventRow avatar="EA" name="Emma Aydın" event="Compensation" org="Security" date="1 Sep 2026" status="Completed" />
            <EventRow avatar="LC" name="Lucas Chen" event="Transfer" org="Operations" date="22 Sep 2026" status="Approved" />
          </tbody></table></div>
        </div>
        <div className="card trust-card">
          <CardHeader title="Data & governance" subtitle="Platform trust posture" />
          <div className="trust-score"><div className="score-ring"><span>96</span><small>/100</small></div><div><strong>Healthy</strong><p>Privacy, access and retention controls are operating normally.</p></div></div>
          <div className="trust-list"><div><CircleCheckBig size={16}/><span>RBAC / ABAC policy engine</span><strong>Healthy</strong></div><div><CircleCheckBig size={16}/><span>Retention jobs</span><strong>Up to date</strong></div><div><CircleCheckBig size={16}/><span>Privileged access reviews</span><strong>98%</strong></div><div><ShieldCheck size={16}/><span>Restricted data vault</span><strong>Protected</strong></div></div>
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
