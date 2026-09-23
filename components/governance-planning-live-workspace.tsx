import {
  Activity,
  Bot,
  BrainCircuit,
  CheckCircle2,
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
  getEngagementLiveData,
  getPrivacyLiveData,
  getWorkforcePlanningLiveData,
  governanceCapabilityFor
} from "@/lib/governance-planning-live-data";

type GovernanceSlug = "engagement" | "workforce-planning" | "ai-assistant" | "privacy";

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="gov-metric card"><div className="gov-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  return <em className={`gov-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</em>;
}

function Empty({ text, columns = 8 }: { text: string; columns?: number }) {
  return <tr><td colSpan={columns} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{text}</td></tr>;
}

function AccessDenied({ slug }: { slug: GovernanceSlug }) {
  const title = slug === "engagement" ? "Engagement" : slug === "workforce-planning" ? "Workforce Planning" : slug === "ai-assistant" ? "AI Assistant" : "Privacy & Compliance";
  return <div className="gov-shell"><section className="card gov-panel" style={{ minHeight: 270, display: "grid", placeItems: "center", textAlign: "center", padding: 36 }}><div style={{ maxWidth: 560 }}><LockKeyhole size={30} style={{ margin: "0 auto 12px" }}/><span className="section-kicker">Policy enforced</span><h3 style={{ margin: "5px 0 8px" }}>{title} access is restricted</h3><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>The signed session does not include this governed capability. Privileged demo data is never substituted when authorization is denied.</p></div></section></div>;
}

export async function GovernancePlanningLiveWorkspace({ slug }: { slug: GovernanceSlug }) {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, governanceCapabilityFor(slug))) return <AccessDenied slug={slug}/>;

  if (slug === "engagement") {
    const data = await getEngagementLiveData(ctx);
    const scopeLabel = data.relationshipScoped ? "Relationship scoped" : "Tenant authorized";
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<UsersRound size={18}/>} label="Active campaigns" value={String(data.activeCampaigns)} meta={`${scopeLabel} campaign view`}/>
        <Metric icon={<Gauge size={18}/>} label="Visible responses" value={String(data.responses)} meta={`${data.responseRate}% average visible response rate`}/>
        <Metric icon={<EyeOff size={18}/>} label="Suppressed campaigns" value={String(data.suppressedCampaigns)} meta="Raw counts hidden below threshold"/>
        <Metric icon={<ShieldCheck size={18}/>} label="Anonymous campaigns" value={String(data.anonymousCampaigns)} meta="Identity separated from response content"/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">Live employee listening</span><h3>Survey campaigns</h3></div><span className="matrix-note">{scopeLabel}</span></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Campaign</th><th>Survey</th><th>Responses</th><th>Rate</th><th>Threshold</th><th>Mode</th><th>Window</th><th>Status</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id}>
              <td><strong>{row.name}</strong></td>
              <td>{row.survey}<small className="cell-sub">{row.surveyCode}</small></td>
              <td>{row.suppressed ? "Suppressed" : `${row.responses}${row.target ? ` / ${row.target}` : ""}`}</td>
              <td>{row.suppressed ? "Suppressed" : row.rate === null ? "—" : `${row.rate}%`}</td>
              <td>{row.threshold}</td><td>{row.mode}</td><td>{row.opensAt} → {row.closesAt}</td><td><Pill value={row.status}/></td>
            </tr>) : <Empty text="No campaigns are visible inside your authorized population."/>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="gov-panel-head"><div><span className="section-kicker">Privacy by design</span><h3>Anonymity controls</h3></div><EyeOff size={18}/></div>
          <div className="gov-controls">
            <p><ShieldCheck size={17}/><span><strong>Threshold before disclosure</strong><small>Anonymous response counts and rates remain hidden while the authorized cohort is below the campaign threshold.</small></span></p>
            <p><Fingerprint size={17}/><span><strong>Scope-bound counting</strong><small>Relationship-scoped viewers count only responses that can be bound to an authorized employment. Unattributed anonymous responses are not borrowed from tenant totals.</small></span></p>
            <p><BrainCircuit size={17}/><span><strong>No answer-level exposure</strong><small>This view never renders individual survey answers or employee-level engagement scoring.</small></span></p>
          </div>
        </aside>
      </section>
    </div>;
  }

  if (slug === "workforce-planning") {
    const data = await getWorkforcePlanningLiveData(ctx);
    const primary = data.primary;
    const scopeLabel = data.relationshipScoped ? "Relationship scoped" : "Tenant authorized";
    return <div className="gov-shell">
      <section className="gov-metrics">
        <Metric icon={<Target size={18}/>} label="Active workforce" value={String(data.activeEmployments)} meta={`${scopeLabel} active / leave population`}/>
        <Metric icon={<UsersRound size={18}/>} label="Visible scenarios" value={String(data.scenarioCount)} meta={`${data.approvedScenarios} approved`}/>
        <Metric icon={<Activity size={18}/>} label="Primary planned FTE" value={primary ? String(primary.plannedFte) : "—"} meta={primary ? `${primary.delta >= 0 ? "+" : ""}${primary.delta} FTE vs scoped baseline` : "No scoped scenario selected"}/>
        <Metric icon={<Scale size={18}/>} label="Primary cost delta" value={primary ? `${primary.currency} ${primary.costDelta.toLocaleString("en-US")}` : "—"} meta={primary ? primary.name : "No scoped plan data"}/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">Live scenario planning</span><h3>Workforce scenarios</h3></div><span className="matrix-note">{scopeLabel}</span></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Scenario</th><th>Horizon</th><th>Current FTE</th><th>Planned FTE</th><th>Delta</th><th>Cost delta</th><th>Owner</th><th>Status</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id}>
              <td><strong>{row.name}</strong><small className="cell-sub">{row.code} · base {row.baseDate}</small></td>
              <td>{row.horizonMonths}m</td><td>{row.currentFte}</td><td>{row.plannedFte}</td><td>{row.delta >= 0 ? "+" : ""}{row.delta}</td><td>{row.currency} {row.costDelta.toLocaleString("en-US")}</td><td>{row.owner}</td><td><Pill value={row.status}/></td>
            </tr>) : <Empty text="No workforce scenario lines intersect your authorized organization or position scope."/>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="gov-panel-head"><div><span className="section-kicker">Planning boundary</span><h3>Demand → role → cost</h3></div><GitBranch size={18}/></div>
          <div className="planning-chain"><span>Authorized org</span><i>→</i><span>Role</span><i>→</i><span>FTE</span><i>→</i><span>Skills</span><i>→</i><span>Cost</span></div>
          <p className="gov-copy">Relationship-scoped users only see scenario lines intersecting their authorized organization or position set. Scenario approval remains evidence and never mutates the authoritative workforce implicitly.</p>
        </aside>
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
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">My interaction ledger</span><h3>Minimal-retention AI telemetry</h3></div><span className="matrix-note">Actor scoped</span></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Purpose</th><th>Module</th><th>Class</th><th>Prompt fingerprint</th><th>Model</th><th>Created</th><th>Status</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.purpose}</strong>{row.blockedReason ? <small className="cell-sub">{row.blockedReason}</small> : null}</td><td>{row.module}</td><td>{row.classification}</td><td><code>{row.promptFingerprint}</code></td><td>{row.model}</td><td>{row.createdAt}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No AI interaction telemetry is recorded for your account in the last 7 days." columns={7}/>} 
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="ai-orb"><Sparkles size={24}/></div><div><span className="section-kicker">HRBP One AI</span><h3>Copilot, not decision maker.</h3><p className="gov-copy">Operational telemetry is actor-scoped and stores fingerprints plus control context instead of raw prompts. Highly restricted ER and privacy operations remain outside the general assistant boundary.</p></div>
          <div className="gov-controls"><p><Fingerprint size={17}/><span><strong>Prompt hashed</strong><small>Raw prompt retention is disabled in the operational ledger.</small></span></p><p><FileKey2 size={17}/><span><strong>Purpose required</strong><small>Every request carries a declared business purpose and classification.</small></span></p><p><BrainCircuit size={17}/><span><strong>Human-owned decisions</strong><small>No autonomous hire, fire, promotion, rating or disciplinary outcome.</small></span></p></div>
        </aside>
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
      <div className="card gov-panel">
        <div className="gov-panel-head"><div><span className="section-kicker">Live privacy operations</span><h3>Data subject requests</h3></div><span className="matrix-note">Privacy / Legal only</span></div>
        <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Request</th><th>Type</th><th>State</th><th>Age</th><th>Due</th><th>Owner</th><th>Status</th></tr></thead><tbody>
          {data.dsrs.length ? data.dsrs.map((row) => <tr key={row.id}><td><strong>{row.requestNumber}</strong></td><td>{row.type}</td><td>{row.state}</td><td>{row.age}d</td><td>{row.dueAt}</td><td>{row.owner}</td><td><Pill value={row.status}/></td></tr>) : <Empty text="No data subject requests are recorded." columns={7}/>} 
        </tbody></table></div>
      </div>
      <aside className="card gov-side">
        <div className="gov-panel-head"><div><span className="section-kicker">Separation of duties</span><h3>Privacy operations boundary</h3></div><ShieldCheck size={18}/></div>
        <div className="gov-controls"><p><LockKeyhole size={17}/><span><strong>Privacy / Legal roles only</strong><small>General HRBP, HR Operations and tenant administration do not inherit DSR, RoPA or transfer-register visibility.</small></span></p><p><Scale size={17}/><span><strong>Lawful basis first</strong><small>Processing purpose, legal basis, transfer mechanism and DPIA signals remain explicit records.</small></span></p><p><FileKey2 size={17}/><span><strong>Operational traceability</strong><small>Request ownership and due dates remain visible only inside the dedicated privacy boundary.</small></span></p></div>
      </aside>
    </section>
  </div>;
}
