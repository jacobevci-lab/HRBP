import { ChevronRight, CircleCheckBig, Plus, Search, SlidersHorizontal } from "lucide-react";
import { navigation } from "@/lib/navigation";

const descriptions: Record<string,string> = {
  people: "Manage the complete workforce record from a single privacy-aware system of record.",
  recruiting: "Plan requisitions, manage candidates, run interviews and convert hires directly into employees.",
  payroll: "Control payroll inputs, calculations, approvals, country packs and employee payslips.",
  "employee-relations": "Handle sensitive employee relations cases with strict case-wall access controls.",
  performance: "Run goals, continuous feedback, review cycles, calibration and improvement plans.",
  privacy: "Govern personal data, retention, legal basis, data-subject requests and privileged access.",
  analytics: "Turn workforce events into explainable, governed people intelligence.",
  workflows: "Automate employee lifecycle actions with auditable, event-driven workflows."
};

export function ModuleLanding({ slug }: { slug: string }) {
  const item = navigation.flatMap((g) => g.items).find((i) => i.slug === slug);
  const title = item?.label ?? slug.split("-").map((v) => v[0]?.toUpperCase() + v.slice(1)).join(" ");
  const Icon = item?.icon;
  return <>
    <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{descriptions[slug] ?? `Enterprise ${title.toLowerCase()} workspace connected to the HRBP One people graph.`}</p></div><button className="create-button"><Plus size={17}/> New record</button></section>
    <section className="module-hero card"><div className="module-icon">{Icon && <Icon size={25}/>}</div><div><div className="section-kicker">Connected module</div><h2>{title} is part of the unified employee lifecycle.</h2><p>Records created here inherit tenant isolation, effective dating, classification, retention, workflow and audit controls by default.</p></div><div className="module-health"><CircleCheckBig size={18}/><span>Governance active</span></div></section>
    <section className="module-toolbar"><div className="module-search"><Search size={16}/><input placeholder={`Search ${title.toLowerCase()}…`}/></div><button className="secondary-button"><SlidersHorizontal size={15}/> Filters</button></section>
    <section className="card module-table"><div className="empty-state"><div className="empty-visual"><span/><span/><span/></div><h3>{title} workspace foundation is ready</h3><p>The enterprise shell and security boundaries are in place. Domain workflows, tables and forms will be implemented module-by-module on this foundation.</p><button className="secondary-button">View architecture <ChevronRight size={15}/></button></div></section>
  </>;
}
