import { AlertTriangle, BadgeCheck, BookOpenCheck, CheckCircle2, CircleHelp, Clock3, FileLock2, Gavel, GitBranch, LockKeyhole, MoreHorizontal, Route, ShieldCheck, Sparkles, TimerReset, UsersRound, Workflow } from "lucide-react";

export const employeeServicesWorkspaceSlugs = new Set(["employee-relations", "hr-service", "policies", "workflows"]);

const erRows = [
  ["ER-2026-0041", "Conduct", "Case team only", "Investigation", "11d", "Open"],
  ["ER-2026-0037", "Grievance", "Case team only", "Findings", "18d", "Action required"],
  ["ER-2026-0032", "Conflict", "Case team only", "Appeal", "29d", "Review"],
  ["ER-2026-0028", "Policy breach", "Case team only", "Closure", "35d", "Resolved"]
];

const serviceRows = [
  ["HR-2026-1842", "Employment letter", "42m", "2h 18m", "HR Operations", "In progress"],
  ["HR-2026-1839", "Payroll query", "1h 14m", "46m", "Payroll", "Waiting employee"],
  ["HR-2026-1837", "Benefits", "2h 02m", "5h 58m", "Total Rewards", "In progress"],
  ["HR-2026-1828", "Policy question", "4h 31m", "19h 29m", "HRBP", "Open"]
];

const policyRows = [
  ["POL-HR-001", "Code of Conduct", "v4.2", "All employees", "99.1%", "Dec 2026", "Published"],
  ["POL-HR-006", "Remote Work", "v3.1", "Eligible employees", "96.8%", "Nov 2026", "Published"],
  ["POL-SEC-004", "Acceptable Use", "v5.0", "All workforce", "98.4%", "Jan 2027", "Published"],
  ["POL-HR-011", "Disciplinary Process", "v2.4", "Managers & HR", "94.2%", "Oct 2026", "Review"]
];

const workflowRows = [
  ["New hire orchestration", "Offer accepted", "84", "0", "HR Operations", "Active"],
  ["Job change", "Employment event", "31", "1", "HRBP", "Active"],
  ["Leave approval", "Request submitted", "126", "0", "HR Operations", "Active"],
  ["Policy attestation", "Policy published", "512", "3", "Compliance", "Active"]
];

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="services-metric card"><div className="services-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return <em className={`services-pill ${key}`}>{value}</em>;
}

function EmployeeRelationsWorkspace() {
  return <>
    <section className="services-metrics">
      <Metric icon={<FileLock2 size={18}/>} label="Open restricted cases" value="14" meta="Case-wall protected matters"/>
      <Metric icon={<TimerReset size={18}/>} label="Triage due" value="3" meta="Within next 24 hours"/>
      <Metric icon={<Gavel size={18}/>} label="Findings pending" value="5" meta="2 legal reviews requested"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Appeals" value="2" meta="Independent reviewer required"/>
    </section>
    <section className="services-split">
      <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Restricted casework</span><h3>Employee relations case register</h3></div><button><MoreHorizontal size={18}/></button></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Case</th><th>Type</th><th>Access</th><th>Phase</th><th>Age</th><th>Status</th></tr></thead><tbody>{erRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card services-side restricted-case"><div className="services-panel-head"><div><span className="section-kicker">Case Wall</span><h3>Need-to-know boundary</h3></div><LockKeyhole size={18}/></div><div className="services-control-stack"><div><ShieldCheck size={17}/><span><strong>Membership enforced</strong><small>Tenant administration does not grant access to ER matters.</small></span></div><div><FileLock2 size={17}/><span><strong>Highly restricted evidence</strong><small>Allegations, interviews, findings and appeals stay inside the case wall.</small></span></div><div><BadgeCheck size={17}/><span><strong>Read access is auditable</strong><small>Purpose and actor context travel with sensitive case activity.</small></span></div></div></aside>
    </section>
  </>;
}

function HRServiceWorkspace() {
  return <>
    <section className="services-metrics">
      <Metric icon={<CircleHelp size={18}/>} label="Open requests" value="47" meta="Across 8 service queues"/>
      <Metric icon={<Clock3 size={18}/>} label="SLA compliance" value="97.4%" meta="Rolling 30 days"/>
      <Metric icon={<UsersRound size={18}/>} label="First response" value="38m" meta="Median response time"/>
      <Metric icon={<Sparkles size={18}/>} label="Auto-routed" value="82%" meta="Rules route before human triage"/>
    </section>
    <section className="services-split">
      <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Employee service</span><h3>Request operating queue</h3></div><button><MoreHorizontal size={18}/></button></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Request</th><th>Category</th><th>Age</th><th>SLA left</th><th>Queue</th><th>Status</th></tr></thead><tbody>{serviceRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card services-side"><div className="services-panel-head"><div><span className="section-kicker">Routing</span><h3>Service governance</h3></div><Route size={18}/></div><div className="services-control-stack"><div><CheckCircle2 size={17}/><span><strong>Identity-bound self service</strong><small>Employee submissions use trusted employment context, not a user-entered person ID.</small></span></div><div><TimerReset size={17}/><span><strong>Priority-aware SLA</strong><small>Critical requests receive a four-hour service target.</small></span></div><div><ShieldCheck size={17}/><span><strong>Private HR notes</strong><small>Requestor-visible replies stay separated from internal case handling.</small></span></div></div></aside>
    </section>
  </>;
}

function PoliciesWorkspace() {
  return <>
    <section className="services-metrics">
      <Metric icon={<BookOpenCheck size={18}/>} label="Published policies" value="34" meta="7 jurisdiction-specific variants"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Review due" value="4" meta="Within next 60 days"/>
      <Metric icon={<BadgeCheck size={18}/>} label="Acknowledgement" value="97.6%" meta="Current published versions"/>
      <Metric icon={<ShieldCheck size={18}/>} label="Active exceptions" value="11" meta="All with expiry or review date"/>
    </section>
    <section className="services-split">
      <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Policy lifecycle</span><h3>Controlled policy register</h3></div><button><MoreHorizontal size={18}/></button></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Code</th><th>Policy</th><th>Version</th><th>Audience</th><th>Acknowledged</th><th>Review</th><th>Status</th></tr></thead><tbody>{policyRows.map((r)=><tr key={r[0]}>{r.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[6]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card services-side"><div className="services-panel-head"><div><span className="section-kicker">Control evidence</span><h3>Policy integrity</h3></div></div><div className="services-control-stack"><div><BadgeCheck size={17}/><span><strong>Version-bound acknowledgement</strong><small>Acknowledgements bind employee, exact version, actor and timestamp.</small></span></div><div><ShieldCheck size={17}/><span><strong>Content hashing</strong><small>Published text can be integrity-checked against its stored SHA-256 hash.</small></span></div><div><Clock3 size={17}/><span><strong>Review & exception dates</strong><small>Policy debt becomes visible before controls silently expire.</small></span></div></div></aside>
    </section>
  </>;
}

function WorkflowsWorkspace() {
  return <>
    <section className="services-metrics">
      <Metric icon={<Workflow size={18}/>} label="Active definitions" value="18" meta="Versioned process templates"/>
      <Metric icon={<GitBranch size={18}/>} label="In flight" value="263" meta="Across employee lifecycle events"/>
      <Metric icon={<Clock3 size={18}/>} label="Waiting approvals" value="31" meta="9 due within 8 hours"/>
      <Metric icon={<AlertTriangle size={18}/>} label="Failed tasks" value="4" meta="No silent workflow failure"/>
    </section>
    <section className="services-split">
      <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Process orchestration</span><h3>Workflow control plane</h3></div><button><MoreHorizontal size={18}/></button></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Workflow</th><th>Trigger</th><th>Instances</th><th>Failures</th><th>Owner</th><th>Status</th></tr></thead><tbody>{workflowRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card services-side workflow-side"><div className="services-panel-head"><div><span className="section-kicker">Orchestration pattern</span><h3>Event → decision → action</h3></div></div><div className="workflow-chain"><span>Event</span><i>→</i><span>Rules</span><i>→</i><span>Approval</span><i>→</i><span>Task</span><i>→</i><span>Audit</span></div><p>Definitions are versioned. Every instance keeps its subject, actor, task state, SLA and event history instead of hiding process logic inside email threads.</p></aside>
    </section>
  </>;
}

export function EmployeeServicesWorkspace({ slug }: { slug: string }) {
  return <div className="services-shell">{slug === "employee-relations" ? <EmployeeRelationsWorkspace/> : slug === "hr-service" ? <HRServiceWorkspace/> : slug === "policies" ? <PoliciesWorkspace/> : <WorkflowsWorkspace/>}</div>;
}
