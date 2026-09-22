import { Activity, Award, BookOpenCheck, BrainCircuit, BriefcaseBusiness, CheckCircle2, GraduationCap, HeartHandshake, ShieldCheck, Sparkles, Target, TrendingUp, UsersRound } from "lucide-react";
import { can, type Capability } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getBenefitsGrowthData, getLearningGrowthData, getPerformanceGrowthData, getSuccessionGrowthData, getTalentGrowthData } from "@/lib/growth-live-data";
import { GrowthWorkspace } from "@/components/growth-workspace";

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="growth-metric card"><div className="growth-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  return <em className={`growth-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
}

function accessFor(slug: string): Capability {
  if (slug === "benefits") return "benefits:read";
  if (slug === "performance") return "performance:read";
  if (slug === "talent") return "talent:read";
  if (slug === "succession") return "succession:read";
  return "learning:read";
}

function Empty({ text }: { text: string }) {
  return <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{text}</td></tr>;
}

export async function GrowthLiveWorkspace({ slug }: { slug: string }) {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, accessFor(slug))) return <GrowthWorkspace slug={slug}/>;

  if (slug === "benefits") {
    const data = await getBenefitsGrowthData(ctx.tenantId);
    return <div className="growth-shell">
      <section className="growth-metrics"><Metric icon={<HeartHandshake size={18}/>} label="Active workforce" value={String(data.activeEmployments)} meta="Eligible employment population"/><Metric icon={<CheckCircle2 size={18}/>} label="Active enrollments" value={String(data.activeEnrollments)} meta={`${data.pendingEnrollments} pending actions`}/><Metric icon={<TrendingUp size={18}/>} label="Active plans" value={String(data.activePlans)} meta="Effective benefit catalog"/><Metric icon={<ShieldCheck size={18}/>} label="Data source" value="Live" meta="Tenant-scoped PostgreSQL"/></section>
      <section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Live benefits administration</span><h3>Plan coverage & enrollment</h3></div><span className="matrix-note">PostgreSQL</span></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Plan</th><th>Type</th><th>Provider</th><th>Country</th><th>Enrolled</th><th>Pending</th><th>Coverage</th><th>Employer cost</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="cell-sub">{row.code}</small></td><td>{row.type}</td><td>{row.provider}</td><td>{row.country}</td><td>{row.enrolled}</td><td>{row.pending}</td><td>{row.coverage}%</td><td>{row.currency === "—" ? "—" : `${row.currency} ${row.employerCost.toLocaleString("en-US")}`}</td></tr>) : <Empty text="No active benefit plans are configured."/>}</tbody></table></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Coverage governance</span><h3>Effective-dated benefits</h3></div><ShieldCheck size={18}/></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>Tenant scope enforced</strong><small>Plan and enrollment queries never cross tenant boundaries.</small></span></div><div><CheckCircle2 size={17}/><span><strong>Effective records</strong><small>Coverage history remains distinct from current elections.</small></span></div><div><Activity size={17}/><span><strong>Payroll-ready design</strong><small>Only governed active enrollment inputs should flow to payroll.</small></span></div></div></aside></section>
    </div>;
  }

  if (slug === "performance") {
    const data = await getPerformanceGrowthData(ctx.tenantId);
    return <div className="growth-shell">
      <section className="growth-metrics"><Metric icon={<Target size={18}/>} label="Cycle completion" value={`${data.completion}%`} meta={data.activeCycle?.name ?? "No active cycle"}/><Metric icon={<Activity size={18}/>} label="Goals at risk" value={String(data.goalsAtRisk)} meta="Live goal register"/><Metric icon={<UsersRound size={18}/>} label="Calibration queue" value={String(data.calibrationQueue)} meta="Human review required"/><Metric icon={<CheckCircle2 size={18}/>} label="Reviews finalized" value={String(data.finalized)} meta={`${data.reviewCount} reviews in selected cycle`}/></section>
      <section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">{data.activeCycle ? `${data.activeCycle.status} · ${data.activeCycle.startsAt} → ${data.activeCycle.endsAt}` : "Performance cycle"}</span><h3>Review operating view</h3></div><span className="matrix-note">Live</span></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Organization</th><th>People</th><th>Complete</th><th>At-risk goals</th><th>Calibration</th></tr></thead><tbody>{data.orgRows.length ? data.orgRows.map((row) => <tr key={row.organization}><td><strong>{row.organization}</strong></td><td>{row.people}</td><td>{row.complete}%</td><td>{row.atRiskGoals}</td><td>{row.calibration}</td></tr>) : <Empty text="No live performance reviews are available yet."/>}</tbody></table></div></div><aside className="card growth-side decision-side"><div className="growth-panel-head"><div><span className="section-kicker">Decision integrity</span><h3>Human-owned ratings</h3></div><BrainCircuit size={18}/></div><p>AI may summarize evidence and flag missing inputs, but final performance ratings remain assigned and calibrated by authorized people.</p><div className="growth-rule"><span>Automatic rating</span><strong>Disabled</strong></div><div className="growth-rule"><span>Calibration audit</span><strong>Enabled</strong></div><div className="growth-rule"><span>Tenant isolation</span><strong>Enforced</strong></div></aside></section>
      <section className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Goals</span><h3>Goal health</h3></div></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Employee</th><th>Goal</th><th>Progress</th><th>Status</th><th>Due</th></tr></thead><tbody>{data.goals.length ? data.goals.map((goal) => <tr key={goal.id}><td>{goal.person}</td><td><strong>{goal.title}</strong></td><td>{goal.progress}%</td><td><Pill value={goal.status}/></td><td>{goal.dueAt}</td></tr>) : <Empty text="No goals have been recorded."/>}</tbody></table></div></section>
    </div>;
  }

  if (slug === "talent") {
    const data = await getTalentGrowthData(ctx.tenantId);
    return <div className="growth-shell">
      <section className="growth-metrics"><Metric icon={<UsersRound size={18}/>} label="People reviewed" value={String(data.reviewed)} meta={data.cycleLabel ?? "No talent cycle"}/><Metric icon={<Sparkles size={18}/>} label="High potential" value={String(data.highPotential)} meta="Human-reviewed designation"/><Metric icon={<Award size={18}/>} label="Critical talent" value={String(data.criticalTalent)} meta="Explicit assessment flag"/><Metric icon={<ShieldCheck size={18}/>} label="AI scoring" value="Off" meta="No autonomous employee scoring"/></section>
      <section className="growth-grid"><div className="card talent-matrix"><div className="growth-panel-head"><div><span className="section-kicker">Human-reviewed talent matrix</span><h3>Performance × potential</h3></div><span className="matrix-note">Not AI-scored</span></div><div className="matrix-body">{data.matrix.map((row) => <div className="matrix-row" key={row.potential}><div className="matrix-label"><strong>{row.potential}</strong><small>Assessor-owned</small></div>{row.cells.map((cell, index) => <div className={`matrix-cell m${Math.min(index, 2)}`} key={cell.performance}><strong>{cell.count}</strong><small>{cell.performance}</small></div>)}</div>)}</div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Governance</span><h3>Talent decision controls</h3></div><ShieldCheck size={18}/></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>No hidden employee score</strong><small>Assessment values are explicit human-owned records.</small></span></div><div><BrainCircuit size={17}/><span><strong>AI supports evidence</strong><small>No automatic promotion or high-potential decision.</small></span></div><div><Activity size={17}/><span><strong>Audit-ready context</strong><small>Cycle and assessment timestamps remain traceable.</small></span></div></div></aside></section>
      <section className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Talent register</span><h3>Latest assessments</h3></div></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Employee</th><th>Position</th><th>Organization</th><th>Performance</th><th>Potential</th><th>Critical talent</th><th>Assessed</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.person}</strong></td><td>{row.position}</td><td>{row.organization}</td><td>{row.performance}</td><td>{row.potential}</td><td>{row.criticalTalent ? "Yes" : "No"}</td><td>{row.assessedAt}</td></tr>) : <Empty text="No talent assessments are recorded."/>}</tbody></table></div></section>
    </div>;
  }

  if (slug === "succession") {
    const data = await getSuccessionGrowthData(ctx.tenantId);
    return <div className="growth-shell">
      <section className="growth-metrics"><Metric icon={<BriefcaseBusiness size={18}/>} label="Critical positions" value={String(data.criticalPositions)} meta="Covered by active plans"/><Metric icon={<CheckCircle2 size={18}/>} label="Covered plans" value={String(data.covered)} meta={`${data.plans} active succession plans`}/><Metric icon={<Award size={18}/>} label="Ready now" value={String(data.readyNow)} meta="Human-assessed readiness"/><Metric icon={<Activity size={18}/>} label="Coverage gaps" value={String(data.gaps)} meta="No successor identified"/></section>
      <section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Critical role continuity</span><h3>Succession coverage</h3></div><span className="matrix-note">Live</span></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Position</th><th>Organization</th><th>Critical</th><th>Candidates</th><th>Ready now</th><th>Review due</th><th>Coverage</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.position}</strong><small className="cell-sub">{row.positionCode}</small></td><td>{row.organization}</td><td>{row.critical ? "Yes" : "No"}</td><td>{row.candidates}</td><td>{row.readyNow}</td><td>{row.reviewDueAt}</td><td><Pill value={row.candidates ? "Covered" : "Gap"}/></td></tr>) : <Empty text="No succession plans are configured."/>}</tbody></table></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Readiness</span><h3>Pipeline distribution</h3></div></div><div className="readiness-list">{data.readiness.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.count}</strong><i style={{ width: `${Math.min(100, row.count * 10)}%` }}/></div>)}</div></aside></section>
    </div>;
  }

  const data = await getLearningGrowthData(ctx.tenantId);
  return <div className="growth-shell">
    <section className="growth-metrics"><Metric icon={<BookOpenCheck size={18}/>} label="Mandatory compliance" value={`${data.compliance}%`} meta="Completed or formally waived"/><Metric icon={<GraduationCap size={18}/>} label="Skills catalog" value={String(data.skillCount)} meta={`${data.criticalSkills} marked critical`}/><Metric icon={<Activity size={18}/>} label="Overdue learning" value={String(data.overdue)} meta="Needs follow-up"/><Metric icon={<Target size={18}/>} label="Due in 30 days" value={String(data.due30)} meta="Open assignments"/></section>
    <section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Learning compliance</span><h3>Assigned learning</h3></div><span className="matrix-note">Live</span></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Course</th><th>Provider</th><th>Requirement</th><th>Assigned</th><th>Completed</th><th>Rate</th><th>Next due</th></tr></thead><tbody>{data.courses.length ? data.courses.map((row) => <tr key={row.id}><td><strong>{row.title}</strong><small className="cell-sub">{row.code}</small></td><td>{row.provider}</td><td>{row.requirement}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.rate}%</td><td>{row.dueAt}</td></tr>) : <Empty text="No learning courses are configured."/>}</tbody></table></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Skills intelligence</span><h3>Critical capability catalog</h3></div></div><div className="skill-list">{data.skills.length ? data.skills.map((skill) => <div key={skill.id}><span>{skill.name}<small className="cell-sub">{skill.category} · {skill.code}</small></span><strong>{skill.critical ? "Critical" : `${skill.assessed} assessed`}</strong></div>) : <div><span>No active skills configured</span><strong>—</strong></div>}</div></aside></section>
  </div>;
}
