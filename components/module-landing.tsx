import { ChevronRight, CircleCheckBig, Plus, Search, SlidersHorizontal } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { CoreHRWorkspace, coreWorkspaceSlugs } from "@/components/core-hr-workspace";
import { RecruitingWorkspace, recruitingWorkspaceSlugs } from "@/components/recruiting-workspace";
import { WorkPayWorkspace, workPayWorkspaceSlugs } from "@/components/work-pay-workspace";

const descriptions: Record<string,string> = {
  people: "The employee golden record: identity, employment, position, organization and lifecycle history in one governed workspace.",
  organization: "Model legal entities, business units, departments, teams, cost centers and effective-dated hierarchy changes.",
  "employee-360": "A policy-aware view of the complete employee relationship without collapsing restricted security boundaries.",
  positions: "Manage budgeted seats independently from incumbents, with status, grade, location, criticality and history.",
  recruiting: "Plan position-backed requisitions, govern candidate data, manage selection and convert accepted offers directly into employee records.",
  onboarding: "Orchestrate the controlled transition from accepted offer to ready employee across HR, IT and the hiring manager.",
  "time-attendance": "Govern schedules, attendance, overtime, exceptions, approvals and payroll-ready locked time from one effective-dated work model.",
  leave: "Manage leave policy, balances, accrual, approvals, coverage and absence history without disconnecting it from employment.",
  compensation: "Run effective-dated salary changes, review cycles, budget controls and restricted compensation approvals.",
  payroll: "Control country packs, payroll periods, validation, calculations, approvals, restricted results and employee payslip data.",
  documents: "Store HR records in a private document vault with classification, retention, legal hold and access evidence.",
  "employee-relations": "Handle sensitive employee relations cases with strict case-wall access controls.",
  performance: "Run goals, continuous feedback, review cycles, calibration and improvement plans.",
  privacy: "Govern processing purpose, legal basis, classification, retention, DSRs and privileged access.",
  audit: "Review immutable security-relevant reads and business mutations across the employee lifecycle.",
  analytics: "Turn workforce events into explainable, governed people intelligence.",
  workflows: "Automate employee lifecycle actions with auditable, event-driven workflows."
};

export function ModuleLanding({ slug }: { slug: string }) {
  const item = navigation.flatMap((g) => g.items).find((i) => i.slug === slug);
  const title = item?.label ?? slug.split("-").map((v) => v[0]?.toUpperCase() + v.slice(1)).join(" ");
  const Icon = item?.icon;
  const specializedCore = coreWorkspaceSlugs.has(slug);
  const specializedRecruiting = recruitingWorkspaceSlugs.has(slug);
  const specializedWorkPay = workPayWorkspaceSlugs.has(slug);
  return <>
    <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{descriptions[slug] ?? `Enterprise ${title.toLowerCase()} workspace connected to the HRBP One people graph.`}</p></div><button className="create-button"><Plus size={17}/> New record</button></section>
    {specializedCore ? <CoreHRWorkspace slug={slug}/> : specializedRecruiting ? <RecruitingWorkspace slug={slug}/> : specializedWorkPay ? <WorkPayWorkspace slug={slug}/> : <>
      <section className="module-hero card"><div className="module-icon">{Icon && <Icon size={25}/>}</div><div><div className="section-kicker">Connected module</div><h2>{title} is part of the unified employee lifecycle.</h2><p>Records created here inherit tenant isolation, effective dating, classification, retention, workflow and audit controls by default.</p></div><div className="module-health"><CircleCheckBig size={18}/><span>Governance active</span></div></section>
      <section className="module-toolbar"><div className="module-search"><Search size={16}/><input placeholder={`Search ${title.toLowerCase()}…`}/></div><button className="secondary-button"><SlidersHorizontal size={15}/> Filters</button></section>
      <section className="card module-table"><div className="empty-state"><div className="empty-visual"><span/><span/><span/></div><h3>{title} domain is queued for its vertical slice</h3><p>Core HR, organization, position management, Employee 360, recruiting, onboarding, work & pay, the document vault, privacy and audit now share the same data and policy plane.</p><button className="secondary-button">View architecture <ChevronRight size={15}/></button></div></section>
    </>}
  </>;
}
