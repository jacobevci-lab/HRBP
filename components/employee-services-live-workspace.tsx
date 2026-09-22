import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileLock2,
  Gavel,
  GitBranch,
  LockKeyhole,
  Route,
  ShieldCheck,
  TimerReset,
  UsersRound,
  Workflow
} from "lucide-react";
import { can, type Capability } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import {
  getEmployeeRelationsLiveData,
  getHRServiceLiveData,
  getPoliciesLiveData,
  getWorkflowsLiveData
} from "@/lib/employee-services-live-data";
import { EmployeeServicesWorkspace } from "@/components/employee-services-workspace";

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="services-metric card"><div className="services-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  return <em className={`services-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
}

function Empty({ text, columns = 8 }: { text: string; columns?: number }) {
  return <tr><td colSpan={columns} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{text}</td></tr>;
}

function accessFor(slug: string): Capability {
  if (slug === "employee-relations") return "cases:read";
  if (slug === "hr-service") return "hr-service:read";
  if (slug === "policies") return "policies:read";
  return "workflows:read";
}

function AccessDenied({ slug }: { slug: string }) {
  const title = slug === "employee-relations" ? "Employee Relations" : slug === "hr-service" ? "HR Service" : slug === "policies" ? "Policies" : "Workflows";
  return <div className="services-shell"><section className="card services-panel" style={{ minHeight: 270, display: "grid", placeItems: "center", textAlign: "center", padding: 36 }}><div style={{ maxWidth: 560 }}><LockKeyhole size={30} style={{ margin: "0 auto 12px" }}/><span className="section-kicker">Policy enforced</span><h3 style={{ margin: "5px 0 8px" }}>{title} access is restricted</h3><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>Your authenticated role does not include this governed data capability. Tenant administration does not bypass restricted HR or case boundaries.</p></div></section></div>;
}

export async function EmployeeServicesLiveWorkspace({ slug }: { slug: string }) {
  const ctx = await getServerRequestContext();
  if (!ctx) return <EmployeeServicesWorkspace slug={slug}/>;
  if (!can(ctx, accessFor(slug))) return <AccessDenied slug={slug}/>;

  if (slug === "employee-relations") {
    const data = await getEmployeeRelationsLiveData(ctx);
    return <div className="services-shell">
      <section className="services-metrics">
        <Metric icon={<FileLock2 size={18}/>} label="Accessible open cases" value={String(data.openCases)} meta="Case-wall scoped to your membership"/>
        <Metric icon={<TimerReset size={18}/>} label="Active allegations" value={String(data.activeAllegations)} meta="Open or under investigation"/>
        <Metric icon={<Gavel size={18}/>} label="Open actions" value={String(data.openActions)} meta={`${data.findings} findings recorded`}/>
        <Metric icon={<AlertTriangle size={18}/>} label="Active appeals" value={String(data.activeAppeals)} meta="Submitted or under review"/>
      </section>
      <section className="services-split">
        <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Restricted live casework</span><h3>Employee relations case register</h3></div><span className="matrix-note">Case Wall</span></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Case</th><th>Type</th><th>Title</th><th>Phase</th><th>Age</th><th>Findings</th><th>Actions</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.caseNumber)}</strong><small className="cell-sub">{String(row.openedAt)}</small></td><td>{String(row.caseType)}</td><td>{String(row.title)}</td><td>{String(row.phase)}</td><td>{String(row.age)}</td><td>{String(row.findings)}</td><td>{String(row.openActions)}</td><td><Pill value={String(row.status)}/></td></tr>) : <Empty text="No employee-relations cases are assigned to your case wall."/>}</tbody></table></div></div>
        <aside className="card services-side restricted-case"><div className="services-panel-head"><div><span className="section-kicker">Case Wall</span><h3>Need-to-know boundary</h3></div><LockKeyhole size={18}/></div><div className="services-control-stack"><div><ShieldCheck size={17}/><span><strong>Membership enforced</strong><small>Only owned or explicitly assigned cases are queried.</small></span></div><div><FileLock2 size={17}/><span><strong>Highly restricted evidence</strong><small>Case visibility remains independent from tenant administration.</small></span></div><div><BadgeCheck size={17}/><span><strong>API and UI align</strong><small>The same actor ID and tenant boundary govern case access.</small></span></div></div></aside>
      </section>
    </div>;
  }

  if (slug === "hr-service") {
    const data = await getHRServiceLiveData(ctx);
    return <div className="services-shell">
      <section className="services-metrics">
        <Metric icon={<CircleHelp size={18}/>} label={data.mode === "self" ? "My open requests" : "Open requests"} value={String(data.openRequests)} meta={data.mode === "self" ? "Identity-bound self service" : "Across visible service queues"}/>
        <Metric icon={<Clock3 size={18}/>} label="SLA compliance" value={`${data.slaCompliance}%`} meta={`${data.breached} measured breaches`}/>
        <Metric icon={<UsersRound size={18}/>} label="First response" value={data.medianFirstResponse} meta="Median measured response"/>
        <Metric icon={<Route size={18}/>} label="Routed" value={`${data.routedPercent}%`} meta="Queue or assignee set"/>
      </section>
      <section className="services-split">
        <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Live employee service</span><h3>Request operating queue</h3></div><span className="matrix-note">Tenant scoped</span></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Request</th><th>Category</th><th>Title</th><th>Priority</th><th>Age</th><th>SLA</th><th>Queue</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.requestNumber}</strong></td><td>{row.category}</td><td>{row.title}</td><td>{row.priority}</td><td>{row.age}</td><td>{row.sla}</td><td>{row.queue}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No HR service requests are visible in this scope."/>}</tbody></table></div></div>
        <aside className="card services-side"><div className="services-panel-head"><div><span className="section-kicker">Routing</span><h3>Service governance</h3></div><Route size={18}/></div><div className="services-control-stack"><div><CheckCircle2 size={17}/><span><strong>Identity-bound requests</strong><small>Employee and manager views are restricted to the authenticated requestor.</small></span></div><div><TimerReset size={17}/><span><strong>SLA measured from records</strong><small>Live due timestamps drive breach and compliance metrics.</small></span></div><div><ShieldCheck size={17}/><span><strong>Private notes stay separate</strong><small>Internal HR comments remain governed by API visibility rules.</small></span></div></div></aside>
      </section>
    </div>;
  }

  if (slug === "policies") {
    const data = await getPoliciesLiveData(ctx);
    return <div className="services-shell">
      <section className="services-metrics">
        <Metric icon={<BookOpenCheck size={18}/>} label={data.mode === "self" ? "Assigned policies" : "Published policies"} value={String(data.published)} meta={data.mode === "self" ? `${data.pending} acknowledgement actions open` : "Current governed register"}/>
        <Metric icon={<AlertTriangle size={18}/>} label="Review due" value={String(data.reviewDue)} meta="Within the next 60 days"/>
        <Metric icon={<BadgeCheck size={18}/>} label="Acknowledgement" value={`${data.acknowledgement}%`} meta={data.mode === "self" ? "My assigned policy set" : "Current assignments"}/>
        <Metric icon={<ShieldCheck size={18}/>} label={data.mode === "self" ? "Governance" : "Active exceptions"} value={data.mode === "self" ? "On" : String(data.activeExceptions)} meta={data.mode === "self" ? "Version-bound evidence" : "Approved exception records"}/>
      </section>
      <section className="services-split">
        <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Live policy lifecycle</span><h3>{data.mode === "self" ? "My policy register" : "Controlled policy register"}</h3></div><span className="matrix-note">Version bound</span></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Code</th><th>Policy</th><th>Version</th><th>Jurisdiction</th><th>{data.mode === "self" ? "My status" : "Audience"}</th><th>{data.mode === "self" ? "Effective" : "Acknowledged"}</th><th>Review</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.code}</strong></td><td>{row.title}</td><td>{row.version}</td><td>{row.jurisdiction}</td><td>{data.mode === "self" ? <Pill value={row.assignmentStatus ?? "Pending"}/> : row.audience}</td><td>{data.mode === "self" ? row.effectiveFrom : `${row.acknowledged}%`}</td><td>{row.reviewDueAt}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No policies are visible in this scope."/>}</tbody></table></div></div>
        <aside className="card services-side"><div className="services-panel-head"><div><span className="section-kicker">Control evidence</span><h3>Policy integrity</h3></div><BadgeCheck size={18}/></div><div className="services-control-stack"><div><BadgeCheck size={17}/><span><strong>Version-bound acknowledgement</strong><small>Assignments and acknowledgements bind to the governed policy version.</small></span></div><div><ShieldCheck size={17}/><span><strong>Jurisdiction aware</strong><small>Policy records retain audience, jurisdiction and effective dates.</small></span></div><div><Clock3 size={17}/><span><strong>Review debt visible</strong><small>Upcoming review dates surface before policy controls silently age out.</small></span></div></div></aside>
      </section>
    </div>;
  }

  const data = await getWorkflowsLiveData(ctx);
  return <div className="services-shell">
    <section className="services-metrics">
      <Metric icon={<Workflow size={18}/>} label="Active definitions" value={String(data.activeDefinitions)} meta="Versioned process templates"/>
      <Metric icon={<GitBranch size={18}/>} label="In flight" value={String(data.inFlight)} meta="Pending, running or waiting"/>
      <Metric icon={<Clock3 size={18}/>} label="Waiting tasks" value={String(data.waitingTasks)} meta={`${data.overdueTasks} overdue`}/>
      <Metric icon={<AlertTriangle size={18}/>} label="Failures" value={String(data.failed)} meta="Instance and task failures"/>
    </section>
    <section className="services-split">
      <div className="card services-panel"><div className="services-panel-head"><div><span className="section-kicker">Live process orchestration</span><h3>Workflow control plane</h3></div><span className="matrix-note">Event driven</span></div><div className="services-table-wrap"><table className="services-table"><thead><tr><th>Workflow</th><th>Version</th><th>Trigger</th><th>Instances</th><th>In flight</th><th>Failures</th><th>Owner</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="cell-sub">{row.key}</small></td><td>v{row.version}</td><td>{row.trigger}</td><td>{row.instances}</td><td>{row.inFlight}</td><td>{row.failures}</td><td>{row.owner}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No workflow definitions are configured."/>}</tbody></table></div></div>
      <aside className="card services-side workflow-side"><div className="services-panel-head"><div><span className="section-kicker">Orchestration pattern</span><h3>Event → decision → action</h3></div></div><div className="workflow-chain"><span>Event</span><i>→</i><span>Rules</span><i>→</i><span>Approval</span><i>→</i><span>Task</span><i>→</i><span>Audit</span></div><p>Definitions and versions are now projected from the live workflow store. Instance and task failures remain visible instead of disappearing into email or background jobs.</p></aside>
    </section>
  </div>;
}
