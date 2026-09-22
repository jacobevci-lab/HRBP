import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  EyeOff,
  FileKey2,
  Fingerprint,
  Gauge,
  GitBranch,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound
} from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import {
  getAIAssistantLiveData,
  getAnalyticsLiveData,
  getEngagementLiveData,
  getPrivacyLiveData,
  getWorkforcePlanningLiveData,
  governanceCapabilityFor
} from "@/lib/governance-planning-live-data";
import { GovernancePlanningWorkspace } from "@/components/governance-planning-workspace";

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="gov-metric card"><div className="gov-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  return <em className={`gov-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
}

function Empty({ text, columns = 8 }: { text: string; columns?: number }) {
  return <tr><td colSpan={columns} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{text}</td></tr>;
}

function AccessDenied({ slug }: { slug: string }) {
  const title = slug === "engagement" ? "Engagement" : slug === "workforce-planning" ? "Workforce Planning" : slug === "analytics" ? "People Analytics" : slug === "ai-assistant" ? "AI Assistant" : "Privacy & Compliance";
  return <div className="gov-shell"><section className="card gov-panel" style={{ minHeight: 270, display: "grid", placeItems: "center", textAlign: "center", padding: 36 }}><div style={{ maxWidth: 560 }}><LockKeyhole size={30} style={{ margin: "0 auto 12px" }}/><span className="section-kicker">Policy enforced</span><h3 style={{ margin: "5px 0 8px" }}>{title} access is restricted</h3><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>Your authenticated role does not include this capability. The workspace does not fall back to privileged mock data when authorization is denied.</p></div></section></div>;
}

export async function GovernancePlanningLiveWorkspace({ slug }: { slug: string }) {
  const ctx = await getServerRequestContext();
  if (!ctx) return <GovernancePlanningWorkspace slug={slug}/>;
  if (!can(ctx, governanceCapabilityFor(slug))) return <AccessDenied slug={slug}/>;

  if (slug === "engagement") {
    const data = await getEngagementLiveData(ctx);
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<UsersRound size={18}/>} label="Active campaigns" value={String(data.activeCampaigns)} meta="Open or scheduled listening"/>
        <Metric icon={<Gauge size={18}/>} label="Responses" value={String(data.responses)} meta={`${data.responseRate}% average known-target response rate`}/>
        <Metric icon={<EyeOff size={18}/>} label="Suppressed campaigns" value={String(data.suppressedCampaigns)} meta="Below configured anonymity threshold"/>
        <Metric icon={<ShieldCheck size={18}/>} label="Anonymous campaigns" value={String(data.anonymousCampaigns)} meta="Identity separated from response content"/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">Live employee listening</span><h3>Survey campaigns</h3></div><span className="matrix-note">Privacy enforced</span></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Campaign</th><th>Survey</th><th>Responses</th><th>Rate</th><th>Threshold</th><th>Mode</th><th>Window</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.survey}<small className="cell-sub">{row.surveyCode}</small></td><td>{row.responses}{row.target ? ` / ${row.target}` : ""}</td><td>{row.suppressed ? "Suppressed" : row.rate === null ? "—" : `${row.rate}%`}</td><td>{row.threshold}</td><td>{row.mode}</td><td>{row.opensAt} → {row.closesAt}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No engagement campaigns are configured."/>}</tbody></table></div></div>
        <aside className="card gov-side"><div className="gov-panel-head"><div><span className="section-kicker">Privacy by design</span><h3>Anonymity controls</h3></div><EyeOff size={18}/></div><div className="gov-controls"><p><ShieldCheck size={17}/><span><strong>Threshold before disclosure</strong><small>Anonymous results remain suppressed while response population is below the campaign minimum.</small></span></p><p><Fingerprint size={17}/><span><strong>No answer-level exposure</strong><small>This operating view projects campaign counts only; individual answer content is never rendered here.</small></span></p><p><BrainCircuit size={17}/><span><strong>AI themes, not people scores</strong><small>Future text analysis must remain cohort-scoped and human-reviewed.</small></span></p></div></aside>
      </section>
    </div>;
  }

  if (slug === "workforce-planning") {
    const data = await getWorkforcePlanningLiveData(ctx);
    const primary = data.primary;
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<Target size={18}/>} label="Active workforce" value={String(data.activeEmployments)} meta="Current active / leave employment records"/>
        <Metric icon={<UsersRound size={18}/>} label="Scenarios" value={String(data.scenarioCount)} meta={`${data.approvedScenarios} approved`}/>
        <Metric icon={<BarChart3 size={18}/>} label="Primary planned FTE" value={primary ? String(primary.plannedFte) : "—"} meta={primary ? `${primary.delta >= 0 ? "+" : ""}${primary.delta} FTE vs scenario baseline` : "No scenario selected"}/>
        <Metric icon={<Activity size={18}/>} label="Primary cost delta" value={primary ? `${primary.currency} ${primary.costDelta.toLocaleString("en-US")}` : "—"} meta={primary ? primary.name : "No plan data"}/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">Live scenario planning</span><h3>Workforce scenarios</h3></div><span className="matrix-note">Sandboxed from live org</span></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Scenario</th><th>Horizon</th><th>Current FTE</th><th>Planned FTE</th><th>Delta</th><th>Cost delta</th><th>Owner</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="cell-sub">{row.code} · base {row.baseDate}</small></td><td>{row.horizonMonths}m</td><td>{row.currentFte}</td><td>{row.plannedFte}</td><td>{row.delta >= 0 ? "+" : ""}{row.delta}</td><td>{row.currency} {row.costDelta.toLocaleString("en-US")}</td><td>{row.owner}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No workforce planning scenarios are configured."/>}</tbody></table></div></div>
        <aside className="card gov-side"><div className="gov-panel-head"><div><span className="section-kicker">Planning boundary</span><h3>Demand → role → cost</h3></div><GitBranch size={18}/></div><div className="planning-chain"><span>Business demand</span><i>→</i><span>Org / Role</span><i>→</i><span>FTE</span><i>→</i><span>Skills</span><i>→</i><span>Cost</span></div><p className="gov-copy">Scenario records stay isolated from the authoritative organization and employment records. Approval is evidence; it is not an implicit mutation of the live workforce.</p></aside>
      </section>
    </div>;
  }

  if (slug === "analytics") {
    const data = await getAnalyticsLiveData(ctx);
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<BarChart3 size={18}/>} label="Governed metrics" value={String(data.governedMetrics)} meta="Shared semantic definitions"/>
        <Metric icon={<CheckCircle2 size={18}/>} label="Fresh today" value={String(data.freshToday)} meta="Latest snapshot generated within 24 hours"/>
        <Metric icon={<EyeOff size={18}/>} label="Privacy suppressed" value={String(data.suppressed)} meta="Snapshot or minimum-population rule"/>
        <Metric icon={<Scale size={18}/>} label="Populated metrics" value={String(data.populated)} meta="Definitions with a current snapshot"/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">Live people intelligence</span><h3>Metric catalog & current values</h3></div><span className="matrix-note">Threshold aware</span></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Metric</th><th>Category</th><th>Value</th><th>Period</th><th>Population</th><th>Aggregation</th><th>Privacy</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="cell-sub">{row.key}</small></td><td>{row.category}</td><td>{row.value}</td><td>{row.period}</td><td>{row.population}</td><td>{row.aggregation}</td><td><Pill value={row.privacy}/></td></tr>) : <Empty text="No governed analytics metrics are configured." columns={7}/>}</tbody></table></div></div>
        <aside className="card gov-side"><div className="gov-panel-head"><div><span className="section-kicker">Explainability</span><h3>Metric contract</h3></div><ClipboardCheck size={18}/></div><div className="gov-controls"><p><CheckCircle2 size={17}/><span><strong>Definition before dashboard</strong><small>Metric key, unit, aggregation and minimum population travel together.</small></span></p><p><EyeOff size={17}/><span><strong>Defense-in-depth suppression</strong><small>The UI suppresses a snapshot if either its flag is set or population falls below the definition threshold.</small></span></p><p><ShieldCheck size={17}/><span><strong>No employee ranking</strong><small>Analytics describes workforce patterns and does not generate opaque individual scores.</small></span></p></div></aside>
      </section>
    </div>;
  }

  if (slug === "ai-assistant") {
    const data = await getAIAssistantLiveData(ctx);
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<Bot size={18}/>} label="My requests" value={String(data.requests)} meta="Authenticated actor · last 7 days"/>
        <Metric icon={<CheckCircle2 size={18}/>} label="Completed" value={String(data.completed)} meta="Decision-support interactions"/>
        <Metric icon={<LockKeyhole size={18}/>} label="Blocked" value={String(data.blocked)} meta={`${data.restrictedAccessAttempts} restricted-data flags recorded`}/>
        <Metric icon={<Sparkles size={18}/>} label="Decision support only" value={String(data.decisionSupportOnly)} meta="No autonomous employment decisions"/>
      </section>
      <section className="ai-governance-grid">
        <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">My interaction ledger</span><h3>Minimal-retention AI telemetry</h3></div><span className="matrix-note">No raw prompts</span></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Purpose</th><th>Module</th><th>Class</th><th>Prompt fingerprint</th><th>Model</th><th>Created</th><th>Status</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.purpose}</strong>{row.blockedReason ? <small className="cell-sub">{row.blockedReason}</small> : null}</td><td>{row.module}</td><td>{row.classification}</td><td><code>{row.promptFingerprint}</code></td><td>{row.model}</td><td>{row.createdAt}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No AI interaction telemetry is recorded for your account in the last 7 days." columns={7}/>}</tbody></table></div></div>
        <aside className="card gov-side"><div className="ai-orb"><Sparkles size={24}/></div><div><span className="section-kicker">HRBP One AI</span><h3>Copilot, not decision maker.</h3><p className="gov-copy">The assistant can support governed work, but the interaction ledger stores fingerprints and control context rather than raw prompt content. Highly restricted ER data remains outside the general assistant boundary.</p></div><div className="gov-controls"><p><Fingerprint size={17}/><span><strong>Prompt hashed</strong><small>Raw prompt retention is disabled in the operational ledger.</small></span></p><p><FileKey2 size={17}/><span><strong>Purpose required</strong><small>Every request carries a declared business purpose and classification.</small></span></p><p><BrainCircuit size={17}/><span><strong>Human-owned decisions</strong><small>No autonomous hire, fire, promotion, rating or disciplinary outcome.</small></span></p></div></aside>
      </section>
    </div>;
  }

  const data = await getPrivacyLiveData(ctx);
  return <div className="gov-shell">
    <section className="gov-metrics">
      <Metric icon={<FileKey2 size={18}/>} label="Processing activities" value={String(data.processingActivities)} meta="Active RoPA records"/>
      <Metric icon={<Activity size={18}/>} label="Open DSRs" value={String(data.openDsrs)} meta={`${data.dsrsDue7} due within 7 days`}/>
      <Metric icon={<Scale size={18}/>} label="DPIA required" value={String(data.dpiaRequired)} meta="Open high-risk privacy assessments"/>
      <Metric icon={<ShieldCheck size={18}/>} label="Active transfers" value={String(data.activeTransfers)} meta="Cross-border transfer register"/>
    </section>
    <section className="gov-split">
      <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">Live privacy operations</span><h3>Data subject requests</h3></div><span className="matrix-note">Restricted</span></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Request</th><th>Type</th><th>State</th><th>Age</th><th>Due</th><th>Owner</th><th>Status</th></tr></thead><tbody>{data.dsrs.length ? data.dsrs.map((row) => <tr key={row.id}><td><strong>{row.requestNumber}</strong></td><td>{row.type}</td><td>{row.state}</td><td>{row.age}d</td><td>{row.dueAt}</td><td>{row.owner}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No data subject requests are recorded." columns={7}/>}</tbody></table></div></div>
      <aside className="card gov-side"><div className="gov-panel-head"><div><span className="section-kicker">Employment privacy</span><h3>Lawful basis first</h3></div><Scale size={18}/></div><p className="gov-copy">The privacy plane tracks processing purpose, legal basis, risk assessment, rights operations and transfer safeguards without treating employment consent as the universal default.</p><div className="gov-controls"><p><ShieldCheck size={17}/><span><strong>Purpose-bound processing</strong><small>RoPA entries stay tenant-scoped with explicit owners and legal basis.</small></span></p><p><EyeOff size={17}/><span><strong>No subject identity in this dashboard</strong><small>DSR operating rows avoid rendering the underlying person identifier.</small></span></p></div></aside>
    </section>
    <section className="gov-split">
      <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">RoPA</span><h3>Processing activities</h3></div></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Code</th><th>Activity</th><th>Legal basis</th><th>Risk</th><th>Special category</th><th>Owner</th></tr></thead><tbody>{data.activities.length ? data.activities.map((row) => <tr key={row.id}><td><strong>{row.code}</strong></td><td>{row.name}</td><td>{row.legalBasis}</td><td>{row.risk}</td><td>{row.specialCategory ? "Yes" : "No"}</td><td>{row.owner}</td></tr>) : <Empty text="No active processing activities are configured." columns={6}/>}</tbody></table></div></div>
      <div className="card gov-panel"><div className="gov-panel-head"><div><span className="section-kicker">Transfers</span><h3>Cross-border safeguards</h3></div></div><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Transfer</th><th>Route</th><th>Recipient</th><th>Mechanism</th><th>TIA due</th></tr></thead><tbody>{data.transfers.length ? data.transfers.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.route}</td><td>{row.recipient}</td><td><Pill value={row.mechanism}/></td><td>{row.tiaDueAt}</td></tr>) : <Empty text="No active transfer records are configured." columns={5}/>}</tbody></table></div></div>
    </section>
  </div>;
}
