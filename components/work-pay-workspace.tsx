import { AlertTriangle, BadgeDollarSign, CalendarCheck2, CheckCircle2, Clock3, Globe2, LockKeyhole, MoreHorizontal, ReceiptText, ShieldCheck, TimerReset, TrendingUp, UsersRound } from "lucide-react";

export const workPayWorkspaceSlugs = new Set(["time-attendance", "leave", "compensation", "payroll"]);

const timeRows = [
  ["Elif Kaya", "Engineering", "09:02", "18:11", "8h 39m", "+9m", "Approved"],
  ["Mert Arslan", "Security", "08:47", "18:24", "9h 07m", "+37m", "Review"],
  ["Derya Aksoy", "Finance", "09:12", "—", "6h 14m", "—", "Missing exit"],
  ["Can Demir", "Operations", "08:55", "17:58", "8h 33m", "+3m", "Approved"]
];

const leaveRows = [
  ["Selin Yılmaz", "Annual leave", "24–27 Sep", "4.0 days", "Ayşe K.", "Pending"],
  ["Burak Öz", "Medical", "22 Sep", "1.0 day", "Auto", "Approved"],
  ["Ece Aydın", "Annual leave", "06–10 Oct", "5.0 days", "Kerem T.", "Pending"],
  ["Ozan Şen", "Personal", "30 Sep", "0.5 day", "Ayşe K.", "Approved"]
];

const compRows = [
  ["Engineering", "184", "₺2.61M", "0.96", "14", "Review"],
  ["Sales", "128", "₺1.84M", "1.01", "9", "Ready"],
  ["Security", "29", "₺612K", "1.04", "3", "Review"],
  ["Finance", "48", "₺721K", "0.99", "2", "Ready"]
];

const payrollRows = [
  ["TR-2026-09", "Türkiye", "Monthly", "520", "₺48.2M", "7", "Validation"],
  ["DE-2026-09", "Germany", "Monthly", "84", "€612K", "1", "Review"],
  ["NL-2026-09", "Netherlands", "Monthly", "41", "€331K", "0", "Approved"]
];

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="workpay-metric card"><div className="workpay-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Status({ value }: { value: string }) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return <em className={`workpay-status ${key}`}>{value}</em>;
}

function TimeWorkspace() {
  return <>
    <section className="workpay-metrics">
      <Metric icon={<UsersRound size={18}/>} label="Expected today" value="497" meta="95.6% of active workforce"/>
      <Metric icon={<Clock3 size={18}/>} label="Clocked in" value="472" meta="25 not yet recorded"/>
      <Metric icon={<TrendingUp size={18}/>} label="Overtime today" value="31.4h" meta="8 employees above threshold"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Exceptions" value="12" meta="4 require manager action"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Daily control</span><h3>Attendance exceptions</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Employee</th><th>Department</th><th>In</th><th>Out</th><th>Worked</th><th>OT</th><th>Status</th></tr></thead><tbody>{timeRows.map((r)=><tr key={r[0]}>{r.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[6]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">Controls</span><h3>Time governance</h3></div></div><div className="control-stack"><div><CheckCircle2 size={17}/><span><strong>Schedule coverage</strong><small>98.7% assigned to an effective schedule</small></span></div><div><TimerReset size={17}/><span><strong>Auto-lock</strong><small>Period locks 3 days after month end</small></span></div><div><ShieldCheck size={17}/><span><strong>Approval separation</strong><small>Managers approve; payroll consumes locked time</small></span></div></div></aside>
    </section>
  </>;
}

function LeaveWorkspace() {
  return <>
    <section className="workpay-metrics">
      <Metric icon={<CalendarCheck2 size={18}/>} label="Pending requests" value="18" meta="6 due today"/>
      <Metric icon={<UsersRound size={18}/>} label="Away today" value="23" meta="4.4% of workforce"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Coverage conflicts" value="5" meta="3 teams below threshold"/>
      <Metric icon={<CheckCircle2 size={18}/>} label="SLA compliance" value="96%" meta="30-day approval SLA"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Requests</span><h3>Leave approval queue</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Units</th><th>Approver</th><th>Status</th></tr></thead><tbody>{leaveRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">Balance policy</span><h3>2026 annual leave</h3></div></div><div className="balance-ring"><strong>14.8</strong><span>avg. days remaining</span></div><div className="mini-rule"><span>Accrual engine</span><strong>Monthly</strong></div><div className="mini-rule"><span>Carry-over cap</span><strong>5 days</strong></div><div className="mini-rule"><span>Negative balance</span><strong>Blocked</strong></div></aside>
    </section>
  </>;
}

function CompensationWorkspace() {
  return <>
    <section className="workpay-metrics">
      <Metric icon={<BadgeDollarSign size={18}/>} label="Annual base payroll" value="₺67.4M" meta="Current effective records"/>
      <Metric icon={<TrendingUp size={18}/>} label="Median increase" value="8.6%" meta="Current review cycle"/>
      <Metric icon={<UsersRound size={18}/>} label="In review" value="28" meta="5 approvals overdue"/>
      <Metric icon={<ShieldCheck size={18}/>} label="Budget variance" value="+1.2%" meta="Against approved envelope"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Review cycle</span><h3>Compensation control center</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Org</th><th>Employees</th><th>Monthly base</th><th>Compa ratio</th><th>Changes</th><th>Status</th></tr></thead><tbody>{compRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side restricted-side"><div className="workpay-panel-head"><div><span className="section-kicker">Restricted domain</span><h3>Compensation boundary</h3></div><LockKeyhole size={18}/></div><p>Compensation records are not exposed through broad tenant administration. Access is separated through compensation and payroll roles, purpose-aware audit and restricted exports.</p><div className="mini-rule"><span>Four-eyes approval</span><strong>Enabled</strong></div><div className="mini-rule"><span>Effective dating</span><strong>Required</strong></div><div className="mini-rule"><span>Audit on read</span><strong>Target</strong></div></aside>
    </section>
  </>;
}

function PayrollWorkspace() {
  return <>
    <section className="workpay-metrics">
      <Metric icon={<ReceiptText size={18}/>} label="Open payrolls" value="3" meta="625 employees in scope"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Validation issues" value="8" meta="7 TR · 1 DE"/>
      <Metric icon={<BadgeDollarSign size={18}/>} label="Gross this cycle" value="₺48.2M" meta="Türkiye September run"/>
      <Metric icon={<Globe2 size={18}/>} label="Country packs" value="3" meta="TR · DE · NL active"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Payroll operations</span><h3>Country-pack runs</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Period</th><th>Country</th><th>Frequency</th><th>Employees</th><th>Gross</th><th>Issues</th><th>Status</th></tr></thead><tbody>{payrollRows.map((r)=><tr key={r[0]}>{r.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[6]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side payroll-flow"><div className="workpay-panel-head"><div><span className="section-kicker">Run controls</span><h3>September payroll</h3></div></div>{["Input collection","Validation","Calculation","Review & sign-off","Payment release"].map((v,i)=><div className="payroll-step" key={v}><span>{i<2?<CheckCircle2 size={15}/>:<Clock3 size={15}/>}</span><div><strong>{v}</strong><small>{i<2?"Completed":i===2?"In progress":"Waiting"}</small></div></div>)}</aside>
    </section>
  </>;
}

export function WorkPayWorkspace({ slug }: { slug: string }) {
  return <div className="workpay-shell">{slug === "time-attendance" ? <TimeWorkspace/> : slug === "leave" ? <LeaveWorkspace/> : slug === "compensation" ? <CompensationWorkspace/> : <PayrollWorkspace/>}</div>;
}
