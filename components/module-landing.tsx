import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, CircleCheckBig, Plus, Search, SlidersHorizontal } from "lucide-react";
import { navigation } from "@/lib/navigation";

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

const liveCoreWorkspaceSlugs = new Set(["people", "organization", "positions", "employee-360"]);
const liveGovernanceWorkspaceSlugs = new Set(["documents", "audit"]);
const coreWorkspaceSlugs = new Set(["people", "organization", "positions", "employee-360", "documents", "privacy", "audit"]);
const recruitingWorkspaceSlugs = new Set(["recruiting", "onboarding"]);
const workPayWorkspaceSlugs = new Set(["time-attendance", "leave", "compensation", "payroll"]);
const growthWorkspaceSlugs = new Set(["benefits", "performance", "talent", "succession", "learning"]);
const employeeServicesWorkspaceSlugs = new Set(["employee-relations", "hr-service", "policies", "workflows"]);
const governancePlanningWorkspaceSlugs = new Set(["engagement", "workforce-planning", "analytics", "ai-assistant", "privacy", "audit"]);
const platformAdminWorkspaceSlugs = new Set(["documents", "settings"]);
const offboardingWorkspaceSlugs = new Set(["offboarding"]);

type WorkspaceState = { degraded: boolean; content: ReactNode };

function ProtectedFallback({ slug, message }: { slug: string; message?: string }) {
  const title = slug.split("-").map((value) => `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`).join(" ");
  return <section className="card module-table"><div className="empty-state"><div className="empty-visual"><span/><span/><span/></div><h3>{title} is running in protected fallback mode</h3><p>{message ?? "The live data dependency is unavailable. Navigation remains online and protected mutations stay disabled until the data plane recovers."}</p><Link className="secondary-button" href="/">Return to Command Center <ChevronRight size={15}/></Link></div></section>;
}

async function renderCoreFallback(slug: string): Promise<WorkspaceState> {
  try {
    const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
    return { degraded: true, content: <CoreHRWorkspace slug={slug}/> };
  } catch (fallbackError) {
    console.error(`[HRBP] Safe ${slug} staging workspace could not initialize.`, fallbackError);
    return { degraded: true, content: <ProtectedFallback slug={slug}/> };
  }
}

async function renderLiveCore(slug: string, query: string, personId?: string, tab?: string): Promise<WorkspaceState> {
  try {
    // Keep Prisma/pg/Cloudflare bindings out of module evaluation. This mirrors
    // the Command Center isolation pattern and lets a broken data plane degrade
    // one workspace instead of tripping the route-level error boundary.
    const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug, query, personId, tab }) };
  } catch (error) {
    console.error(`[HRBP] Live ${slug} workspace failed. Falling back to the safe staging view.`, error);
    return renderCoreFallback(slug);
  }
}

async function renderLiveGovernance(slug: string, query: string): Promise<WorkspaceState> {
  try {
    const { GovernanceLiveWorkspace } = await import("@/components/governance-live-workspace");
    return { degraded: false, content: await GovernanceLiveWorkspace({ slug, query }) };
  } catch (error) {
    console.error(`[HRBP] Live governance ${slug} workspace failed. Falling back to the safe staging view.`, error);
    return renderCoreFallback(slug);
  }
}

async function renderLiveCompensation(): Promise<WorkspaceState> {
  try {
    const { CompensationLiveWorkspace } = await import("@/components/compensation-live-workspace");
    return { degraded: false, content: await CompensationLiveWorkspace() };
  } catch (error) {
    console.error("[HRBP] Live compensation workspace failed. Falling back to the safe staging view.", error);
    try {
      const { WorkPayWorkspace } = await import("@/components/work-pay-workspace");
      return { degraded: true, content: <WorkPayWorkspace slug="compensation"/> };
    } catch (fallbackError) {
      console.error("[HRBP] Compensation staging workspace could not initialize.", fallbackError);
      return { degraded: true, content: <ProtectedFallback slug="compensation"/> };
    }
  }
}

async function renderRecruiting(slug: string): Promise<WorkspaceState> {
  try {
    const { RecruitingWorkspace } = await import("@/components/recruiting-workspace");
    return { degraded: false, content: await RecruitingWorkspace({ slug }) };
  } catch (error) {
    console.error(`[HRBP] ${slug} workspace could not initialize.`, error);
    return { degraded: true, content: <ProtectedFallback slug={slug} message="Recruiting data services are unavailable. The shell remains available while candidate and onboarding mutations stay protected."/> };
  }
}

async function renderStandardWorkspace(slug: string): Promise<WorkspaceState> {
  try {
    if (coreWorkspaceSlugs.has(slug)) {
      const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
      return { degraded: false, content: <CoreHRWorkspace slug={slug}/> };
    }
    if (offboardingWorkspaceSlugs.has(slug)) {
      const { OffboardingWorkspace } = await import("@/components/offboarding-workspace");
      return { degraded: false, content: <OffboardingWorkspace/> };
    }
    if (workPayWorkspaceSlugs.has(slug)) {
      const { WorkPayWorkspace } = await import("@/components/work-pay-workspace");
      return { degraded: false, content: <WorkPayWorkspace slug={slug}/> };
    }
    if (growthWorkspaceSlugs.has(slug)) {
      const { GrowthWorkspace } = await import("@/components/growth-workspace");
      return { degraded: false, content: <GrowthWorkspace slug={slug}/> };
    }
    if (employeeServicesWorkspaceSlugs.has(slug)) {
      const { EmployeeServicesWorkspace } = await import("@/components/employee-services-workspace");
      return { degraded: false, content: <EmployeeServicesWorkspace slug={slug}/> };
    }
    if (governancePlanningWorkspaceSlugs.has(slug)) {
      const { GovernancePlanningWorkspace } = await import("@/components/governance-planning-workspace");
      return { degraded: false, content: <GovernancePlanningWorkspace slug={slug}/> };
    }
    if (platformAdminWorkspaceSlugs.has(slug)) {
      const { PlatformAdminWorkspace } = await import("@/components/platform-admin-workspace");
      return { degraded: false, content: <PlatformAdminWorkspace slug={slug}/> };
    }
  } catch (error) {
    console.error(`[HRBP] Standard ${slug} workspace failed to initialize.`, error);
    return { degraded: true, content: <ProtectedFallback slug={slug}/> };
  }
  return { degraded: false, content: null };
}

export async function ModuleLanding({ slug, query = "", personId, tab }: { slug: string; query?: string; personId?: string; tab?: string }) {
  const item = navigation.flatMap((group) => group.items).find((entry) => entry.slug === slug);
  const title = item?.label ?? slug.split("-").map((value) => `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`).join(" ");
  const Icon = item?.icon;
  const liveCore = liveCoreWorkspaceSlugs.has(slug);
  const liveGovernance = liveGovernanceWorkspaceSlugs.has(slug);
  const liveCompensation = slug === "compensation";
  const live = liveCore || liveGovernance || liveCompensation;
  const recruit = recruitingWorkspaceSlugs.has(slug);

  const workspaceState = liveCore
    ? await renderLiveCore(slug, query, personId, tab)
    : liveGovernance
      ? await renderLiveGovernance(slug, query)
      : liveCompensation
        ? await renderLiveCompensation()
        : recruit
          ? await renderRecruiting(slug)
          : await renderStandardWorkspace(slug);

  const createHref = slug === "people" ? "/module/people/new" : slug === "positions" ? "/module/positions/new" : null;
  const createLabel = slug === "people" ? "Add employee" : "New position";
  const governedWorkspace = live || recruit;

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{descriptions[slug] ?? `Enterprise ${title.toLowerCase()} workspace connected to the HRBP One people graph.`}</p></div>
      {governedWorkspace ? <div className="module-heading-actions">
        {workspaceState.degraded
          ? <button className="secondary-button" disabled><CircleAlert size={16}/> Safe fallback</button>
          : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}
        {createHref ? <Link className="create-button" href={createHref}><Plus size={17}/> {createLabel}</Link> : null}
      </div> : <button className="create-button"><Plus size={17}/> New record</button>}
    </section>

    {workspaceState.degraded ? <section className="card" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10, borderColor: "#efd7aa", background: "#fff8ed" }}>
      <CircleAlert size={18} style={{ flex: "0 0 auto", marginTop: 1, color: "#9a6438" }}/>
      <div><strong style={{ display: "block", fontSize: 11, color: "#71481f" }}>Live governed data is temporarily unavailable</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "#8a663f" }}>The application shell stayed online and switched to a protected fallback. Protected mutations remain disabled while the live path is degraded.</p></div>
    </section> : null}

    {workspaceState.content ?? <>
      <section className="module-hero card"><div className="module-icon">{Icon && <Icon size={25}/>}</div><div><div className="section-kicker">Connected module</div><h2>{title} is part of the unified employee lifecycle.</h2><p>Records created here inherit tenant isolation, effective dating, classification, retention, workflow and audit controls by default.</p></div><div className="module-health"><CircleCheckBig size={18}/><span>Governance active</span></div></section>
      <section className="module-toolbar"><div className="module-search"><Search size={16}/><input placeholder={`Search ${title.toLowerCase()}…`}/></div><button className="secondary-button"><SlidersHorizontal size={15}/> Filters</button></section>
      <section className="card module-table"><div className="empty-state"><div className="empty-visual"><span/><span/><span/></div><h3>{title} domain is queued for its vertical slice</h3><p>The remaining module is connected to the same tenant, identity, privacy and audit plane.</p><button className="secondary-button">View architecture <ChevronRight size={15}/></button></div></section>
    </>}
  </>;
}
