import { AlertTriangle, BadgeCheck, CheckCircle2, Clock3, KeyRound, Laptop2, LockKeyhole, MoreHorizontal, PackageCheck, ShieldCheck, UserMinus } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getOffboardingWorkspaceData } from "@/lib/offboarding-live-data";
import { OffboardingOperationsConsole } from "@/components/offboarding-operations-console";

export const offboardingWorkspaceSlugs = new Set(["offboarding"]);

const demoRows = [
  ["E00418 · Deniz A.", "Resignation", "30 Sep", "12 / 15", "1", "Notice period"],
  ["E00372 · Emre T.", "End of contract", "25 Sep", "9 / 12", "0", "Clearance"],
  ["E00294 · Selin K.", "Retirement", "31 Oct", "6 / 14", "2", "Notice period"],
  ["E00461 · Burak N.", "Termination", "23 Sep", "14 / 14", "0", "Ready to close"]
];

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="off-metric card"><div className="off-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  return <em className={`off-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
}

function ClosureGate() {
  return <aside className="card off-side"><div className="off-head"><div><span className="section-kicker">Closure gate</span><h3>All controls must clear</h3></div><ShieldCheck size={18}/></div><div className="off-controls"><p><KeyRound size={17}/><span><strong>Logical access</strong><small>Revoked or explicitly excepted before closure.</small></span></p><p><Laptop2 size={17}/><span><strong>Company assets</strong><small>Returned or formally written off.</small></span></p><p><PackageCheck size={17}/><span><strong>Knowledge transfer</strong><small>Manager-owned handover tasks are recorded.</small></span></p><p><CheckCircle2 size={17}/><span><strong>Final employment event</strong><small>Employment is terminated only when the process closes.</small></span></p></div></aside>;
}

function DemoOffboarding() {
  return <div className="off-shell">
    <section className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>Offboarding data is protected</h3><p>The public staging surface shows synthetic separation records. Sign in with an authorized HR role to access live employee exits and clearance controls.</p></div></section>
    <section className="off-metrics"><Metric icon={<UserMinus size={18}/>} label="Open separations" value="11" meta="Synthetic staging data"/><Metric icon={<Clock3 size={18}/>} label="Leaving this week" value="4" meta="Synthetic staging data"/><Metric icon={<AlertTriangle size={18}/>} label="Blocking tasks" value="7" meta="IT · assets · payroll"/><Metric icon={<BadgeCheck size={18}/>} label="Ready to close" value="3" meta="Synthetic staging data"/></section>
    <section className="off-split"><div className="card off-panel"><div className="off-head"><div><span className="section-kicker">Controlled employee exit</span><h3>Separation register</h3></div><MoreHorizontal size={18}/></div><div className="off-table-wrap"><table className="off-table"><thead><tr><th>Employee</th><th>Type</th><th>Last day</th><th>Tasks</th><th>Open blocks</th><th>Stage</th></tr></thead><tbody>{demoRows.map((row) => <tr key={row[0]}>{row.slice(0, 5).map((value, index) => <td key={index}>{value}</td>)}<td><Pill value={row[5]}/></td></tr>)}</tbody></table></div></div><ClosureGate/></section>
  </div>;
}

export async function OffboardingWorkspace() {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, "offboarding:read")) return <DemoOffboarding/>;

  try {
    const canWrite = can(ctx, "offboarding:write");
    const data = await getOffboardingWorkspaceData(ctx, canWrite);
    return <div className="off-shell">
      <section className="off-metrics"><Metric icon={<UserMinus size={18}/>} label="Open separations" value={String(data.openSeparations)} meta="Live governed processes"/><Metric icon={<Clock3 size={18}/>} label="Leaving next 7 days" value={String(data.leavingThisWeek)} meta="Based on last working date"/><Metric icon={<AlertTriangle size={18}/>} label="Blocking tasks" value={String(data.blockingTasks)} meta="Must clear before closure"/><Metric icon={<BadgeCheck size={18}/>} label="Ready to close" value={String(data.readyToClose)} meta="Exit gate satisfied"/></section>
      {canWrite ? <OffboardingOperationsConsole processes={data.processes} employments={data.eligibleEmployments}/> : null}
      <section className="off-split"><div className="card off-panel"><div className="off-head"><div><span className="section-kicker">Controlled employee exit</span><h3>Live separation register</h3></div><span className="off-live-badge"><ShieldCheck size={14}/> PostgreSQL</span></div><div className="off-table-wrap"><table className="off-table"><thead><tr><th>Employee</th><th>Type</th><th>Last day</th><th>Tasks</th><th>Open blocks</th><th>Stage</th></tr></thead><tbody>{data.processes.length ? data.processes.map((row) => <tr key={row.id}><td><strong>{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position}</small></td><td>{row.type}</td><td>{row.lastWorkingDate}</td><td>{row.completedTasks} / {row.taskCount}</td><td>{row.openBlockingTasks + row.assetsOpen + row.accessOpen}</td><td><Pill value={row.readyToClose ? "Ready to close" : row.status}/></td></tr>) : <tr><td colSpan={6} style={{ textAlign: "center", padding: 26 }}>No open separations in your authorized employment scope.</td></tr>}</tbody></table></div></div><ClosureGate/></section>
    </div>;
  } catch (error) {
    console.error("[HRBP] Live offboarding workspace failed; using protected staging fallback.", error);
    return <DemoOffboarding/>;
  }
}
