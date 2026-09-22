import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheckBig, Plus, Search, SlidersHorizontal } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { CoreHRWorkspace, coreWorkspaceSlugs } from "@/components/core-hr-workspace";
import { CoreHRLiveWorkspace, liveCoreWorkspaceSlugs } from "@/components/core-hr-live-workspace";
import { GovernanceLiveWorkspace, liveGovernanceWorkspaceSlugs } from "@/components/governance-live-workspace";
import { CompensationLiveWorkspace } from "@/components/compensation-live-workspace";
import { RecruitingWorkspace, recruitingWorkspaceSlugs } from "@/components/recruiting-workspace";
import { WorkPayWorkspace, workPayWorkspaceSlugs } from "@/components/work-pay-workspace";
import { GrowthWorkspace, growthWorkspaceSlugs } from "@/components/growth-workspace";
import { EmployeeServicesWorkspace, employeeServicesWorkspaceSlugs } from "@/components/employee-services-workspace";
import { GovernancePlanningWorkspace, governancePlanningWorkspaceSlugs } from "@/components/governance-planning-workspace";
import { PlatformAdminWorkspace, platformAdminWorkspaceSlugs } from "@/components/platform-admin-workspace";
import { OffboardingWorkspace, offboardingWorkspaceSlugs } from "@/components/offboarding-workspace";

const descriptions: Record<string, string> = {
  people: "The employee golden record: identity, employment, position, organization and lifecycle history in one governed workspace.",
  organization: "Model legal entities, business units, departments, teams, cost centers and effective-dated hierarchy changes.",
  "employee-360": "A policy-aware view of the complete employee relationship without collapsing restricted security boundaries.",
  positions: "Manage budgeted seats independently from incumbents, with status, grade, location, criticality and history.",
  recruiting: "Plan position-backed requisitions, govern candidate data, manage selection and convert accepted offers directly into employee records.",
  onboarding: "Orchestrate the controlled transition from accepted offer to ready employee across HR, IT and the hiring manager.",
  offboarding: "Control resignations, terminations, retirement and contract exits across HR, manager, IT, security, facilities and payroll before employment is closed.",
  "time-attendance": "Govern schedules, attendance, overtime, exceptions, approvals and payroll-ready locked time from one effective-dated work model.",
  leave: "Manage leave policy, balances, accrual, approvals, coverage and absence history without disconnecting it from employment.",
  compensation: "Run effective-dated salary changes, review cycles, budget controls and restricted compensation approvals.",
  payroll: "Control country packs, payroll periods, validation, calculations, approvals, restricted results and employee payslip data.",
  benefits: "Manage jurisdiction-aware benefit plans, eligibility, employee elections, contributions and effective-dated coverage.",
  performance: "Run goals, continuous feedback, review cycles and calibration while keeping final ratings human-owned and auditable.",
  talent: "Connect performance and potential assessments to development decisions without opaque automated employee scoring.",
  succession: "Protect business continuity through position-centric succession plans, candidate readiness and development gaps.",
  learning: "Operate a governed skills taxonomy, skill evidence, mandatory learning, development assignments and certification history.",
  engagement: "Run privacy-preserving employee listening with anonymous campaigns, cohort thresholds and governed action themes.",
  "employee-relations": "Run highly restricted investigations from allegation and interview through evidence, findings, corrective action, appeal and closure inside a case wall.",
  "hr-service": "Provide a single employee service desk with identity-bound requests, queue routing, SLAs, private HR notes and complete request history.",
  policies: "Control policy drafting, versions, approvals, publication, acknowledgement evidence, review dates and exceptions in one register.",
  documents: "Operate a private, versioned HR document vault with classification, malware quarantine, legal hold, controlled access and built-in signature evidence.",
  "workforce-planning": "Model future workforce demand, FTE, roles, skills and cost in governed scenarios before changes reach the live organization.",
  analytics: "Deliver a shared metric layer with population thresholds, privacy suppression and explainable workforce measures.",
  "ai-assistant": "Provide policy-grounded HR assistance with minimal-retention telemetry, source references and explicit human decision ownership.",
  privacy: "Operate RoPA, lawful basis, retention, DSRs, DPIAs and cross-border transfer safeguards from the same HR data plane.",
  audit: "Review immutable security-relevant reads and business mutations across the employee lifecycle.",
  workflows: "Orchestrate event-driven HR processes with versioned definitions, approvals, tasks, SLAs, failure handling and immutable process history.",
  settings: "Configure tenant identity, provisioning, integrations, residency and security without storing connector secrets in application records."
};

async function renderLiveCore(slug: string, query: string, personId?: string, tab?: string) {
  try {
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug, query, personId, tab }) };
  } catch (error) {
    console.error(`[HRBP] Live ${slug} workspace failed. Falling back to the safe staging view.`, error);
    return { degraded: true, content: <CoreHRWorkspace slug={slug}/> };
  }
}

async function renderLiveGovernance(slug: string, query: string) {
  try {
    return { degraded: false, content: await GovernanceLiveWorkspace({ slug, query }) };
  } catch (error) {
    console.error(`[HRBP] Live governance ${slug} workspace failed. Falling back to the safe staging view.`, error);
    return { degraded: true, content: <CoreHRWorkspace slug={slug}/> };
  }
}

async function renderLiveCompensation() {
  try {
    return { degraded: false, content: await CompensationLiveWorkspace() };
  } catch (error) {
    console.error("[HRBP] Live compensation workspace failed. Falling back to the safe staging view.", error);
    return { degraded: true, content: <WorkPayWorkspace slug="compensation"/> };
  }
}

export async function ModuleLanding({ slug, query = "", personId, tab }: { slug: string; query?: string; personId?: string; tab?: string }) {
  const item = navigation.flatMap((group) => group.items).find((entry) => entry.slug === slug);
  const title = item?.label ?? slug.split("-").map((value) => `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`).join(" ");
  const Icon = item?.icon;
  const liveCore = liveCoreWorkspaceSlugs.has(slug);
  const liveGovernance = liveGovernanceWorkspaceSlugs.has(slug);
  const liveCompensation = slug === "compensation";
  const live = liveCore || liveGovernance || liveCompensation;
  const core = coreWorkspaceSlugs.has(slug);
  const recruit = recruitingWorkspaceSlugs.has(slug);
  const work = workPayWorkspaceSlugs.has(slug);
  const growth = growthWorkspaceSlugs.has(slug);
  const services = employeeServicesWorkspaceSlugs.has(slug);
  const gov = governancePlanningWorkspaceSlugs.has(slug);
  const admin = platformAdminWorkspaceSlugs.has(slug);
  const off = offboardingWorkspaceSlugs.has(slug);
  const liveState = liveCore
    ? await renderLiveCore(slug, query, personId, tab)
    : liveGovernance
      ? await renderLiveGovernance(slug, query)
      : liveCompensation
        ? await renderLiveCompensation()
        : { degraded: false, content: null };
  const createHref = slug === "people" ? "/module/people/new" : slug === "positions" ? "/module/positions/new" : null;
  const createLabel = slug === "people" ? "Add employee" : "New position";

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{descriptions[slug] ?? `Enterprise ${title.toLowerCase()} workspace connected to the HRBP One people graph.`}</p></div>
      {live ? <div className="module-heading-actions">
        {liveState.degraded
          ? <button className="secondary-button" disabled><CircleAlert size={16}/> Safe fallback</button>
          : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}
        {createHref ? <Link className="create-button" href={createHref}><Plus size={17}/> {createLabel}</Link> : null}
      </div> : <button className="create-button"><Plus size={17}/> New record</button>}
    </section>
    {live ? <>
      {liveState.degraded ? <section className="card" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10, borderColor: "#efd7aa", background: "#fff8ed" }}>
        <CircleAlert size={18} style={{ flex: "0 0 auto", marginTop: 1, color: "#9a6438" }}/>
        <div><strong style={{ display: "block", fontSize: 11, color: "#71481f" }}>Live governed data is temporarily unavailable</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "#8a663f" }}>The application shell stayed online and switched to the safe staging view. Protected mutations remain disabled while the live path is degraded.</p></div>
      </section> : null}
      {liveState.content}
    </> : core ? <CoreHRWorkspace slug={slug}/> : recruit ? <RecruitingWorkspace slug={slug}/> : off ? <OffboardingWorkspace/> : work ? <WorkPayWorkspace slug={slug}/> : growth ? <GrowthWorkspace slug={slug}/> : services ? <EmployeeServicesWorkspace slug={slug}/> : gov ? <GovernancePlanningWorkspace slug={slug}/> : admin ? <PlatformAdminWorkspace slug={slug}/> : <>
      <section className="module-hero card"><div className="module-icon">{Icon && <Icon size={25}/>}</div><div><div className="section-kicker">Connected module</div><h2>{title} is part of the unified employee lifecycle.</h2><p>Records created here inherit tenant isolation, effective dating, classification, retention, workflow and audit controls by default.</p></div><div className="module-health"><CircleCheckBig size={18}/><span>Governance active</span></div></section>
      <section className="module-toolbar"><div className="module-search"><Search size={16}/><input placeholder={`Search ${title.toLowerCase()}…`}/></div><button className="secondary-button"><SlidersHorizontal size={15}/> Filters</button></section>
      <section className="card module-table"><div className="empty-state"><div className="empty-visual"><span/><span/><span/></div><h3>{title} domain is queued for its vertical slice</h3><p>The remaining module is connected to the same tenant, identity, privacy and audit plane.</p><button className="secondary-button">View architecture <ChevronRight size={15}/></button></div></section>
    </>}
  </>;
}
