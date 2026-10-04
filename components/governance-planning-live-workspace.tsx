import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { governanceText } from "@/lib/governance-workspace-copy";
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
import { WorkforceScenarioActions } from "@/components/workforce-scenario-actions";
import { WorkforcePlanLineManager } from "@/components/workforce-plan-line-manager";
import { WorkforceScenarioCreateForm } from "@/components/workforce-scenario-create-form";
import { DSRLifecycleActions } from "@/components/dsr-lifecycle-actions";
import { EngagementCampaignActions } from "@/components/engagement-campaign-actions";
import { EngagementCampaignWindowEditor } from "@/components/engagement-campaign-window-editor";
import { EngagementSurveyAuthoring } from "@/components/engagement-survey-authoring";
import { EngagementCampaignCreateForm } from "@/components/engagement-campaign-create-form";
import { EngagementResponseAction } from "@/components/engagement-response-action";
import { EngagementResultsPanel } from "@/components/engagement-results-panel";
import { AIInteractionRequestForm } from "@/components/ai-interaction-request-form";
import { PrivacyAssessmentActions, PrivacyAssessmentCreateForm, PrivacyTransferActions, PrivacyTransferCreateForm } from "@/components/privacy-assurance-actions";
import { GovernedFocusScroller } from "@/components/governed-focus-scroller";
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

function Pill({ value, locale }: { value: string; locale: Locale }) {
  return <em className={`gov-pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{governanceText(locale, value)}</em>;
}

function Empty({ text, columns = 8 }: { text: string; columns?: number }) {
  return <tr><td colSpan={columns} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>{text}</td></tr>;
}

function AccessDenied({ slug, locale }: { slug: GovernanceSlug; locale: Locale }) {
  const c = (text: string) => governanceText(locale, text);
  const title = slug === "engagement" ? c("Engagement") : slug === "workforce-planning" ? c("Workforce Planning") : slug === "ai-assistant" ? c("AI Assistant") : c("Privacy & Compliance");
  return <div className="gov-shell" data-governance-locale={locale}><section className="card gov-panel" style={{ minHeight: 270, display: "grid", placeItems: "center", textAlign: "center", padding: 36 }}><div style={{ maxWidth: 560 }}><LockKeyhole size={30} style={{ margin: "0 auto 12px" }}/><span className="section-kicker">{c("Policy enforced")}</span><h3 style={{ margin: "5px 0 8px" }}>{title} {c("access is restricted")}</h3><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>{c("The signed session does not include this governed capability. Privileged demo data is never substituted when authorization is denied.")}</p></div></section></div>;
}

export async function GovernancePlanningLiveWorkspace({ slug, focusId, mode }: { slug: GovernanceSlug; focusId?: string; mode?: string }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const c = (text: string) => governanceText(locale, text);
  if (!ctx || !can(ctx, governanceCapabilityFor(slug))) return <AccessDenied slug={slug} locale={locale}/>;

  if (slug === "engagement") {
    const data = await getEngagementLiveData(ctx);
    const scopeLabel = data.relationshipScoped ? c("Relationship scoped") : c("Tenant authorized");
    const campaignFocusVisible = focusId ? data.rows.some((row) => row.id === focusId) : true;
    const engagementCanWrite = can(ctx, "engagement:write");
    return <div className="gov-shell" data-governance-locale={locale}><GovernedFocusScroller attribute="data-engagement-campaign-id" value={campaignFocusVisible ? focusId : undefined}/>{focusId && !campaignFocusVisible ? <section className="card governance-note"><LockKeyhole size={18}/><p><strong>{c("Campaign focus is unavailable in your governed scope.")}</strong> {c("The deep link failed closed and did not broaden the engagement query.")}</p></section> : null}
      <section className="gov-metrics">
        <Metric icon={<UsersRound size={18}/>} label={c("Active campaigns")} value={String(data.activeCampaigns)} meta={(locale === "tr" ? `${scopeLabel} kampanya görünümü` : `${scopeLabel} campaign view`)}/>
        <Metric icon={<Gauge size={18}/>} label={c("Visible responses")} value={String(data.responses)} meta={(locale === "tr" ? `%${data.responseRate} ortalama görünür yanıt oranı` : `${data.responseRate}% average visible response rate`)}/>
        <Metric icon={<EyeOff size={18}/>} label={c("Suppressed campaigns")} value={String(data.suppressedCampaigns)} meta={c("Raw counts hidden below threshold")}/>
        <Metric icon={<ShieldCheck size={18}/>} label={c("Anonymous campaigns")} value={String(data.anonymousCampaigns)} meta={c("Identity separated from response content")}/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">{c("Live employee listening")}</span><h3>{c("Survey campaigns")}</h3></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span className="matrix-note">{scopeLabel}</span><EngagementSurveyAuthoring surveys={data.surveys} canWrite={engagementCanWrite}/><EngagementCampaignCreateForm surveys={data.surveys} canWrite={engagementCanWrite}/></div></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Campaign")}</th><th>{c("Survey")}</th><th>{c("Responses")}</th><th>{c("Rate")}</th><th>{c("Threshold")}</th><th>{c("Mode")}</th><th>{c("Window")}</th><th>{c("Status")}</th><th>{c("Lifecycle")}</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id} data-engagement-campaign-id={row.id} className={focusId === row.id ? "focused" : undefined}>
              <td><strong>{row.name}</strong>{focusId === row.id ? <small className="cell-sub">{mode === "work" ? c("Focused campaign action") : c("Focused campaign")}</small> : null}</td>
              <td>{row.survey}<small className="cell-sub">{row.surveyCode}</small></td>
              <td>{row.suppressed ? c("Suppressed") : `${row.responses}${row.target ? ` / ${row.target}` : ""}`}</td>
              <td>{row.suppressed ? c("Suppressed") : row.rate === null ? "—" : `${row.rate}%`}</td>
              <td>{row.threshold}</td><td>{c(row.mode)}</td><td>{row.opensAt} → {row.closesAt}</td><td><Pill value={row.status} locale={locale}/></td><td><div style={{display:"grid",gap:5}}>{row.rawStatus==="OPEN"&&ctx.employmentId?<EngagementResponseAction campaignId={row.id}/>:null}<EngagementCampaignWindowEditor campaignId={row.id} status={row.rawStatus} createdById={row.createdById} actorId={ctx.actorId} canWrite={engagementCanWrite} opensAt={row.opensAtIso} closesAt={row.closesAtIso}/>{engagementCanWrite&&["OPEN","CLOSED","ARCHIVED"].includes(row.rawStatus)?<EngagementResultsPanel campaignId={row.id}/>:null}<EngagementCampaignActions campaignId={row.id} status={row.rawStatus} createdById={row.createdById} actorId={ctx.actorId} canWrite={engagementCanWrite}/></div></td>
            </tr>) : <Empty text={c("No campaigns are visible inside your authorized population.")} columns={9}/>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="gov-panel-head"><div><span className="section-kicker">{c("Privacy by design")}</span><h3>{c("Anonymity controls")}</h3></div><EyeOff size={18}/></div>
          <div className="gov-controls">
            <p><ShieldCheck size={17}/><span><strong>{c("Threshold before disclosure")}</strong><small>{c("Anonymous response counts and rates remain hidden while the authorized cohort is below the campaign threshold.")}</small></span></p>
            <p><Fingerprint size={17}/><span><strong>{c("Scope-bound counting")}</strong><small>{c("Relationship-scoped viewers count only responses that can be bound to an authorized employment. Unattributed anonymous responses are not borrowed from tenant totals.")}</small></span></p>
            <p><BrainCircuit size={17}/><span><strong>{c("No answer-level exposure")}</strong><small>{c("This view never renders individual survey answers or employee-level engagement scoring.")}</small></span></p>
          </div>
        </aside>
      </section>
    </div>;
  }

  if (slug === "workforce-planning") {
    const data = await getWorkforcePlanningLiveData(ctx);
    const primary = data.primary;
    const scopeLabel = data.relationshipScoped ? c("Relationship scoped") : c("Tenant authorized");
    const focusVisible = focusId ? data.rows.some((row) => row.id === focusId) : true;
    const canWrite = can(ctx, "workforce-plan:write");
    const canApprove = can(ctx, "workforce-plan:approve");
    return <div className="gov-shell" data-governance-locale={locale}><GovernedFocusScroller attribute="data-workforce-scenario-id" value={focusVisible ? focusId : undefined}/>{focusId && !focusVisible ? <section className="card governance-note"><LockKeyhole size={18}/><p><strong>{c("Scenario focus is unavailable in your governed scope.")}</strong> {c("The deep link failed closed and did not broaden the workforce planning query.")}</p></section> : null}
      <section className="gov-metrics">
        <Metric icon={<Target size={18}/>} label={c("Active workforce")} value={String(data.activeEmployments)} meta={(locale === "tr" ? `${scopeLabel} aktif / izinli çalışanlar` : `${scopeLabel} active / leave population`)}/>
        <Metric icon={<UsersRound size={18}/>} label={c("Visible scenarios")} value={String(data.scenarioCount)} meta={(locale === "tr" ? `${data.approvedScenarios} onaylandı` : `${data.approvedScenarios} approved`)}/>
        <Metric icon={<Activity size={18}/>} label={c("Primary planned FTE")} value={primary ? String(primary.plannedFte) : "—"} meta={primary ? `${primary.delta >= 0 ? "+" : ""}${primary.delta} ${locale === "tr" ? "TZE farkı (kapsam tabanına göre)" : "FTE vs scoped baseline"}` : c("No scoped scenario selected")}/>
        <Metric icon={<Scale size={18}/>} label={c("Primary cost delta")} value={primary ? `${primary.currency} ${primary.costDelta.toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}` : "—"} meta={primary ? primary.name : c("No scoped plan data")}/>
      </section>
      <section className="gov-split">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">{c("Live scenario planning")}</span><h3>{c("Workforce scenarios")}</h3></div><div style={{display:"flex",gap:8,alignItems:"center"}}><span className="matrix-note">{scopeLabel}</span><WorkforceScenarioCreateForm canWrite={canWrite}/></div></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Scenario")}</th><th>{c("Horizon")}</th><th>{c("Current FTE")}</th><th>{c("Planned FTE")}</th><th>{c("Delta")}</th><th>{c("Cost delta")}</th><th>{c("Owner")}</th><th>{c("Status")}</th><th>{c("Governance")}</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id} data-workforce-scenario-id={row.id} className={focusId === row.id ? "focused" : undefined}>
              <td><strong>{row.name}</strong><small className="cell-sub">{row.code} {c("· base")} {row.baseDate}{focusId === row.id ? ` · ${mode === "review" ? c("focused review") : c("focused scenario")}` : ""}</small></td>
              <td>{row.horizonMonths}{c("m")}</td><td>{row.currentFte}</td><td>{row.plannedFte}</td><td>{row.delta >= 0 ? "+" : ""}{row.delta}</td><td>{row.currency} {row.costDelta.toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}</td><td>{row.owner}</td><td><Pill value={row.status} locale={locale}/></td><td><div style={{display:"grid",gap:6}}><WorkforcePlanLineManager scenarioId={row.id} status={row.rawStatus} ownerId={row.ownerId} actorId={ctx.actorId} canWrite={canWrite} currency={row.currency} lines={row.lines}/><WorkforceScenarioActions scenarioId={row.id} status={row.rawStatus} ownerId={row.ownerId} actorId={ctx.actorId} canWrite={canWrite} canApprove={canApprove}/></div></td>
            </tr>) : <Empty text={c("No workforce scenario lines intersect your authorized organization or position scope.")} columns={9}/>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="gov-panel-head"><div><span className="section-kicker">{c("Planning boundary")}</span><h3>{c("Demand → role → cost")}</h3></div><GitBranch size={18}/></div>
          <div className="planning-chain"><span>{c("Authorized org")}</span><i>→</i><span>{c("Role")}</span><i>→</i><span>{c("FTE")}</span><i>→</i><span>{c("Skills")}</span><i>→</i><span>{c("Cost")}</span></div>
          <p className="gov-copy">{c("Relationship-scoped users only see scenario lines intersecting their authorized organization or position set. Scenario approval remains evidence and never mutates the authoritative workforce implicitly.")}</p>
        </aside>
      </section>
    </div>;
  }

  if (slug === "ai-assistant") {
    const data = await getAIAssistantLiveData(ctx);
    return <div className="gov-shell" data-governance-locale={locale}>
      <section className="gov-metrics">
        <Metric icon={<Bot size={18}/>} label={c("My requests")} value={String(data.requests)} meta={c("Authenticated actor · last 7 days")}/>
        <Metric icon={<CheckCircle2 size={18}/>} label={c("Completed")} value={String(data.completed)} meta={c("Decision-support interactions")}/>
        <Metric icon={<LockKeyhole size={18}/>} label={c("Blocked")} value={String(data.blocked)} meta={(locale === "tr" ? `${data.restrictedAccessAttempts} kısıtlı veri işareti kaydedildi` : `${data.restrictedAccessAttempts} restricted-data flags recorded`)}/>
        <Metric icon={<Sparkles size={18}/>} label={c("Decision support only")} value={String(data.decisionSupportOnly)} meta={c("No autonomous employment decisions")}/>
      </section>
      <section className="ai-governance-grid">
        <div className="card gov-panel">
          <div className="gov-panel-head"><div><span className="section-kicker">{c("My interaction ledger")}</span><h3>{c("Minimal-retention AI telemetry")}</h3></div><div style={{display:"flex",gap:8,alignItems:"center"}}><span className="matrix-note">{c("Actor scoped")}</span><AIInteractionRequestForm/></div></div>
          <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Purpose")}</th><th>{c("Module")}</th><th>{c("Class")}</th><th>{c("Prompt fingerprint")}</th><th>{c("Model")}</th><th>{c("Created")}</th><th>{c("Status")}</th></tr></thead><tbody>
            {data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong>{row.purpose}</strong>{row.blockedReason ? <small className="cell-sub">{row.blockedReason}</small> : null}</td><td>{row.module}</td><td>{row.classification}</td><td><code>{row.promptFingerprint}</code></td><td>{row.model}</td><td>{row.createdAt}</td><td><Pill value={row.status} locale={locale}/></td></tr>) : <Empty text={c("No AI interaction telemetry is recorded for your account in the last 7 days.")} columns={7}/>}
          </tbody></table></div>
        </div>
        <aside className="card gov-side">
          <div className="ai-orb"><Sparkles size={24}/></div><div><span className="section-kicker">{c("HRBP One AI")}</span><h3>{c("Copilot, not decision maker.")}</h3><p className="gov-copy">{c("Operational telemetry is actor-scoped and stores fingerprints plus control context instead of raw prompts. Highly restricted ER and privacy operations remain outside the general assistant boundary.")}</p></div>
          <div className="gov-controls"><p><Fingerprint size={17}/><span><strong>{c("Prompt hashed")}</strong><small>{c("Raw prompt retention is disabled in the operational ledger.")}</small></span></p><p><FileKey2 size={17}/><span><strong>{c("Purpose required")}</strong><small>{c("Every request carries a declared business purpose and classification.")}</small></span></p><p><BrainCircuit size={17}/><span><strong>{c("Human-owned decisions")}</strong><small>{c("No autonomous hire, fire, promotion, rating or disciplinary outcome.")}</small></span></p></div>
        </aside>
      </section>
    </div>;
  }

  const data = await getPrivacyLiveData(ctx);
  const privacyCanWrite = can(ctx, "privacy:write");
  const privacyFocusType = mode === "assessment" ? "assessment" : mode === "transfer" ? "transfer" : "dsr";
  const privacyFocusVisible = !focusId
    || (privacyFocusType === "assessment" && data.assessments.some((row) => row.id === focusId))
    || (privacyFocusType === "transfer" && data.transfers.some((row) => row.id === focusId))
    || (privacyFocusType === "dsr" && data.dsrs.some((row) => row.id === focusId));
  const privacyFocusAttribute = privacyFocusType === "assessment" ? "data-privacy-assessment-id" : privacyFocusType === "transfer" ? "data-privacy-transfer-id" : "data-dsr-id";
  return <div className="gov-shell" data-governance-locale={locale}><GovernedFocusScroller attribute={privacyFocusAttribute} value={privacyFocusVisible ? focusId : undefined}/>{focusId && !privacyFocusVisible ? <section className="card governance-note"><LockKeyhole size={18}/><p><strong>{c("Privacy focus is unavailable in your governed scope.")}</strong> {c("The deep link failed closed and did not broaden the privacy query.")}</p></section> : null}
    <section className="gov-metrics">
      <Metric icon={<FileKey2 size={18}/>} label={c("Processing activities")} value={String(data.processingActivities)} meta={c("Active RoPA records")}/>
      <Metric icon={<Activity size={18}/>} label={c("Open DSRs")} value={String(data.openDsrs)} meta={(locale === "tr" ? `${data.dsrsDue7} talebin son tarihi 7 gün içinde` : `${data.dsrsDue7} due within 7 days`)}/>
      <Metric icon={<Scale size={18}/>} label={c("DPIA required")} value={String(data.dpiaRequired)} meta={c("Open high-risk privacy assessments")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c("Active transfers")} value={String(data.activeTransfers)} meta={c("Cross-border transfer register")}/>
    </section>
    <section className="gov-split">
      <div className="card gov-panel">
        <div className="gov-panel-head"><div><span className="section-kicker">{c("Live privacy operations")}</span><h3>{c("Data subject requests")}</h3></div><span className="matrix-note">{c("Privacy / Legal only")}</span></div>
        <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Request")}</th><th>{c("Type")}</th><th>{c("State")}</th><th>{c("Age")}</th><th>{c("Due")}</th><th>{c("Owner")}</th><th>{c("Status")}</th><th>{c("Lifecycle")}</th></tr></thead><tbody>
          {data.dsrs.length ? data.dsrs.map((row) => <tr key={row.id} data-dsr-id={row.id} className={privacyFocusType === "dsr" && focusId === row.id ? "focused" : undefined}><td><strong>{row.requestNumber}</strong>{privacyFocusType === "dsr" && focusId === row.id ? <small className="cell-sub">{mode === "work" ? c("Focused DSR action") : c("Focused DSR")}</small> : null}</td><td>{row.type}</td><td>{row.state}</td><td>{row.age}{c("d")}</td><td>{row.dueAt}</td><td>{row.owner}</td><td><Pill value={row.status} locale={locale}/></td><td><DSRLifecycleActions dsrId={row.id} status={row.rawStatus} ownerId={row.ownerId} actorId={ctx.actorId} canWrite={privacyCanWrite}/></td></tr>) : <Empty text={c("No data subject requests are recorded.")} columns={8}/>}
        </tbody></table></div>
      </div>
      <aside className="card gov-side">
        <div className="gov-panel-head"><div><span className="section-kicker">{c("Separation of duties")}</span><h3>{c("Privacy operations boundary")}</h3></div><ShieldCheck size={18}/></div>
        <div className="gov-controls"><p><LockKeyhole size={17}/><span><strong>{c("Privacy / Legal roles only")}</strong><small>{c("General HRBP, HR Operations and tenant administration do not inherit DSR, RoPA or transfer-register visibility.")}</small></span></p><p><Scale size={17}/><span><strong>{c("Lawful basis first")}</strong><small>{c("Processing purpose, legal basis, transfer mechanism and DPIA signals remain explicit records.")}</small></span></p><p><FileKey2 size={17}/><span><strong>{c("Operational traceability")}</strong><small>{c("Request ownership and due dates remain visible only inside the dedicated privacy boundary.")}</small></span></p></div>
      </aside>
    </section>
    <section className="card gov-panel">
      <div className="gov-panel-head"><div><span className="section-kicker">{c("Privacy assurance")}</span><h3>{c("DPIA & privacy risk assessments")}</h3></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span className="matrix-note">{c("Owner + due date")}</span><PrivacyAssessmentCreateForm canWrite={privacyCanWrite} activities={data.activities.map((activity) => ({id: activity.id, code: activity.code, name: activity.name}))}/></div></div>
      <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Assessment")}</th><th>{c("Risk")}</th><th>{c("DPIA")}</th><th>{c("Owner")}</th><th>{c("Due")}</th><th>{c("Status")}</th><th>{c("Lifecycle")}</th></tr></thead><tbody>
        {data.assessments.length ? data.assessments.map((row) => <tr key={row.id} data-privacy-assessment-id={row.id} className={privacyFocusType === "assessment" && focusId === row.id ? "focused" : undefined}><td><strong>{row.name}</strong>{privacyFocusType === "assessment" && focusId === row.id ? <small className="cell-sub">{c("Focused privacy assessment")}</small> : null}</td><td>{row.riskLevel}</td><td>{row.requiresDpia ? c("Required") : c("Not required")}</td><td>{row.owner}</td><td>{row.dueAt}</td><td><Pill value={row.status} locale={locale}/></td></tr>) : <Empty text={c("No privacy risk assessments are recorded.")} columns={6}/>}
      </tbody></table></div>
    </section>
    <section className="card gov-panel">
      <div className="gov-panel-head"><div><span className="section-kicker">{c("Cross-border assurance")}</span><h3>{c("Transfer impact review register")}</h3></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span className="matrix-note">{c("TIA due-date control")}</span><PrivacyTransferCreateForm canWrite={privacyCanWrite}/></div></div>
      <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>{c("Transfer")}</th><th>{c("Route")}</th><th>{c("Recipient")}</th><th>{c("Mechanism")}</th><th>{c("TIA due")}</th><th>{c("Status")}</th><th>{c("Lifecycle")}</th></tr></thead><tbody>
        {data.transfers.length ? data.transfers.map((row) => <tr key={row.id} data-privacy-transfer-id={row.id} className={privacyFocusType === "transfer" && focusId === row.id ? "focused" : undefined}><td><strong>{row.name}</strong>{privacyFocusType === "transfer" && focusId === row.id ? <small className="cell-sub">{c("Focused transfer impact review")}</small> : null}</td><td>{row.route}</td><td>{row.recipient}</td><td>{row.mechanism}</td><td>{row.tiaDueAt}</td></tr>) : <Empty text={c("No active cross-border transfer records are configured.")} columns={5}/>}
      </tbody></table></div>
    </section>
  </div>;
}
