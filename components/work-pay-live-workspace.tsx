import Link from "next/link";
import { AlertTriangle, BadgeDollarSign, CalendarCheck2, CheckCircle2, Clock3, Globe2, LockKeyhole, ReceiptText, ShieldCheck, TrendingUp, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getLeaveLiveData, getPayrollLiveData, getTimeAttendanceLiveData } from "@/lib/work-pay-live-data";
import { WorkPayWorkspace } from "@/components/work-pay-workspace";
import { LeaveDecisionButtons } from "@/components/leave-decision-buttons";
import { PayrollTransitionButton } from "@/components/payroll-transition-button";

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="workpay-metric card"><div className="workpay-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Status({ value }: { value: string }) {
  return <em className={`workpay-status ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
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

export async function WorkPayLiveWorkspace({ slug }: { slug: "time-attendance" | "leave" | "payroll" }) {
  const ctx = await getServerRequestContext();

  if (!ctx) {
    if (slug === "payroll") return <Restricted title="Payroll is a restricted domain" detail="Payroll runs, gross/net results and statutory country-pack operations are never exposed through the public staging surface." returnTo="/module/payroll"/>;
    return <WorkPayWorkspace slug={slug}/>;
  }

  const capability = slug === "time-attendance" ? "time:read" : slug === "leave" ? "leave:read" : "payroll:read";
  if (!can(ctx, capability)) return <Restricted title={`${slug === "time-attendance" ? "Time & Attendance" : slug === "leave" ? "Leave" : "Payroll"} access is restricted`} detail={`Your authenticated role does not include ${capability}. Employee and manager access is relationship-scoped; payroll remains role-separated.`} returnTo={`/module/${slug}`}/>;

  if (slug === "time-attendance") {
    const data = await getTimeAttendanceLiveData(ctx);
    return <div className="workpay-shell">
      <section className="workpay-metrics">
        <Metric icon={<UsersRound size={18}/>} label="Expected today" value={String(data.expected)} meta="Authorized employment population"/>
        <Metric icon={<Clock3 size={18}/>} label="Recorded" value={String(data.recorded)} meta={`${data.expected ? Math.round((data.recorded / data.expected) * 100) : 0}% of expected population`}/>
        <Metric icon={<TrendingUp size={18}/>} label="Overtime today" value={`${Math.round((data.overtimeMinutes / 60) * 10) / 10}h`} meta="Tenant-scoped recorded overtime"/>
        <Metric icon={<AlertTriangle size={18}/>} label="Exceptions" value={String(data.exceptions)} meta={`${data.scheduleCoverage}% schedule coverage`}/>
      </section>
      <section className="workpay-split">
        <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Live daily control</span><h3>Attendance operating view</h3></div><span className="matrix-note">Relationship scoped</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Employee</th><th>Organization</th><th>In</th><th>Out</th><th>Worked</th><th>OT</th><th>Source</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position}</small></td><td>{row.organization}</td><td>{row.startAt}</td><td>{row.endAt}</td><td>{Math.floor(row.minutes / 60)}h {row.minutes % 60}m</td><td>{row.overtimeMinutes ? `${Math.floor(row.overtimeMinutes / 60)}h ${row.overtimeMinutes % 60}m` : "—"}</td><td>{row.source}</td><td><Status value={row.status}/></td></tr>) : <tr><td colSpan={8} style={{ textAlign: "center", padding: 28 }}>No time entries are recorded for today.</td></tr>}</tbody></table></div></div>
        <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">Access model</span><h3>Relationship-aware time data</h3></div><ShieldCheck size={18}/></div><div className="control-stack"><div><ShieldCheck size={17}/><span><strong>Employee</strong><small>Own employment records only.</small></span></div><div><UsersRound size={17}/><span><strong>Manager</strong><small>Self plus direct reports resolved from the employment graph.</small></span></div><div><CheckCircle2 size={17}/><span><strong>Operations roles</strong><small>Explicit workforce-wide access through role capability, not tenant admin headers.</small></span></div></div></aside>
      </section>
    </div>;
  }

  if (slug === "leave") {
    const data = await getLeaveLiveData(ctx);
    const canWrite = can(ctx, "leave:write");
    return <div className="workpay-shell">
      <section className="workpay-metrics">
        <Metric icon={<CalendarCheck2 size={18}/>} label="Pending requests" value={String(data.pending)} meta="Within current 60-day operating horizon"/>
        <Metric icon={<UsersRound size={18}/>} label="Away today" value={String(data.awayToday)} meta="Approved or taken leave"/>
        <Metric icon={<CheckCircle2 size={18}/>} label="Balance records" value={String(data.balanceRecords)} meta="Current-year governed balances"/>
        <Metric icon={<TrendingUp size={18}/>} label="Avg. balance" value={String(data.averageRemaining)} meta="Opening + accrual + adjustment − used"/>
      </section>
      <section className="workpay-split">
        <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Live leave operations</span><h3>Request & approval queue</h3></div><span className="matrix-note">Effective-dated policy</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Units</th><th>Organization</th><th>Status</th>{canWrite ? <th>Decision</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position}</small></td><td>{row.leaveType}</td><td>{row.startsAt} → {row.endsAt}</td><td>{row.units} {row.unit.toLowerCase()}</td><td>{row.organization}</td><td><Status value={row.status}/></td>{canWrite ? <td>{row.rawStatus === "PENDING" && row.employmentId !== ctx.employmentId ? <LeaveDecisionButtons requestId={row.id}/> : <span style={{ color: "var(--muted)" }}>—</span>}</td> : null}</tr>) : <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", padding: 28 }}>No leave requests are in the operating horizon.</td></tr>}</tbody></table></div></div>
        <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">Approval control</span><h3>No self-approval</h3></div><ShieldCheck size={18}/></div><p>Managers can only view their relationship-scoped population. Their own request remains visible but cannot be approved from the manager decision path. HR operations can act through explicit workforce-wide authority.</p><div className="mini-rule"><span>Scope</span><strong>Employment graph</strong></div><div className="mini-rule"><span>Decision audit</span><strong>Enabled</strong></div><div className="mini-rule"><span>Balance overwrite</span><strong>Blocked</strong></div></aside>
      </section>
    </div>;
  }

  const data = await getPayrollLiveData(ctx);
  const canWrite = can(ctx, "payroll:write");
  return <div className="workpay-shell">
    <section className="workpay-metrics">
      <Metric icon={<ReceiptText size={18}/>} label="Open payroll runs" value={String(data.openRuns)} meta="Excludes paid and cancelled runs"/>
      <Metric icon={<Globe2 size={18}/>} label="Country packs" value={String(data.activeCountryPacks)} meta="Active jurisdiction engines"/>
      <Metric icon={<UsersRound size={18}/>} label="Result records" value={String(data.employeesInLatestRuns)} meta="Across loaded recent runs"/>
      <Metric icon={<LockKeyhole size={18}/>} label="Access boundary" value="Restricted" meta="Payroll capability required"/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">Live payroll operations</span><h3>Country-pack run register</h3></div><span className="matrix-note">Restricted</span></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>Period / country</th><th>Run</th><th>Employees</th><th>Gross</th><th>Net</th><th>Employer cost</th><th>Pay date</th><th>Status</th>{canWrite ? <th>Next control</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.periodCode}</strong><small className="cell-sub">{row.country} · {row.countryCode} · pack {row.packVersion}</small></td><td>#{row.runNumber}<small className="cell-sub">Period: {row.periodStatus}</small></td><td>{row.employees}</td><td>{money(row.currency, row.gross)}</td><td>{money(row.currency, row.net)}</td><td>{money(row.currency, row.employerCost)}</td><td>{row.payDate}</td><td><Status value={row.status}/></td>{canWrite ? <td><PayrollTransitionButton runId={row.id} status={row.rawStatus}/></td> : null}</tr>) : <tr><td colSpan={canWrite ? 9 : 8} style={{ textAlign: "center", padding: 28 }}>No payroll runs are recorded.</td></tr>}</tbody></table></div></div>
      <aside className="card workpay-side restricted-side"><div className="workpay-panel-head"><div><span className="section-kicker">Four-eyes payroll</span><h3>Controlled state machine</h3></div><BadgeDollarSign size={18}/></div><div className="control-stack"><div><CheckCircle2 size={17}/><span><strong>Draft → validation → calculation</strong><small>Each transition is explicit and audited.</small></span></div><div><ShieldCheck size={17}/><span><strong>Approval before payment</strong><small>Payroll write is isolated from broad tenant administration.</small></span></div><div><LockKeyhole size={17}/><span><strong>Restricted results</strong><small>Gross, net, tax and deductions never appear on the public surface.</small></span></div></div></aside>
    </section>
  </div>;
}
