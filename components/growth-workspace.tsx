import { Activity, Award, BookOpenCheck, BrainCircuit, BriefcaseBusiness, CheckCircle2, GraduationCap, HeartHandshake, MoreHorizontal, ShieldCheck, Sparkles, Target, TrendingUp, UsersRound } from "lucide-react";

export const growthWorkspaceSlugs = new Set(["benefits", "performance", "talent", "succession", "learning"]);

const benefitRows = [
  ["Private health", "Health", "487", "94%", "₺1.84M", "Active"],
  ["Meal allowance", "Flexible", "512", "99%", "₺842K", "Active"],
  ["Life insurance", "Life", "501", "97%", "₺226K", "Active"],
  ["Pension match", "Retirement", "318", "62%", "₺611K", "Review"]
];

const performanceRows = [
  ["Engineering", "184", "92%", "14", "6", "Calibration"],
  ["Sales", "128", "88%", "18", "9", "Manager review"],
  ["Security", "29", "96%", "3", "2", "Calibration"],
  ["Finance", "48", "94%", "4", "1", "Ready"]
];

const successionRows = [
  ["Head of Platform", "Engineering", "Critical", "2", "1", "Covered"],
  ["Security Architect", "Security", "Critical", "3", "1", "Covered"],
  ["Finance Director", "Finance", "Critical", "1", "0", "Gap"],
  ["Regional Sales Lead", "Sales", "High", "2", "1", "Covered"]
];

const learningRows = [
  ["Secure SDLC", "Security", "Mandatory", "482 / 512", "30 Sep", "94.1%"],
  ["Manager Essentials", "Leadership", "Required", "74 / 81", "15 Oct", "91.4%"],
  ["Privacy & Data Handling", "Compliance", "Mandatory", "501 / 512", "30 Sep", "97.9%"],
  ["Cloud Architecture", "Engineering", "Optional", "66 / 104", "—", "63.5%"]
];

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="growth-metric card"><div className="growth-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Pill({ value }: { value: string }) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return <em className={`growth-pill ${key}`}>{value}</em>;
}

function BenefitsWorkspace() {
  return <>
    <section className="growth-metrics">
      <Metric icon={<HeartHandshake size={18}/>} label="Eligible employees" value="512" meta="Across 9 active benefit plans"/>
      <Metric icon={<CheckCircle2 size={18}/>} label="Enrollment complete" value="94.7%" meta="27 actions still open"/>
      <Metric icon={<TrendingUp size={18}/>} label="Employer monthly cost" value="₺3.52M" meta="+2.1% vs approved envelope"/>
      <Metric icon={<ShieldCheck size={18}/>} label="Coverage exceptions" value="6" meta="Need HR Operations review"/>
    </section>
    <section className="growth-split">
      <div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Benefits administration</span><h3>Plan coverage & enrollment</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Plan</th><th>Type</th><th>Enrolled</th><th>Coverage</th><th>Monthly cost</th><th>Status</th></tr></thead><tbody>{benefitRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Effective-dated coverage</span><h3>Governance controls</h3></div></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>Eligibility rules</strong><small>Employment, country and plan dates remain authoritative.</small></span></div><div><CheckCircle2 size={17}/><span><strong>Payroll handoff</strong><small>Only active, effective enrollments create payroll inputs.</small></span></div><div><Activity size={17}/><span><strong>History preserved</strong><small>Coverage changes never overwrite prior elections.</small></span></div></div></aside>
    </section>
  </>;
}

function PerformanceWorkspace() {
  return <>
    <section className="growth-metrics">
      <Metric icon={<Target size={18}/>} label="Cycle completion" value="91.8%" meta="2026 annual performance cycle"/>
      <Metric icon={<Activity size={18}/>} label="Goals at risk" value="39" meta="Across 31 employees"/>
      <Metric icon={<UsersRound size={18}/>} label="Calibration queue" value="41" meta="7 manager groups remaining"/>
      <Metric icon={<CheckCircle2 size={18}/>} label="Reviews finalized" value="438" meta="74 still in workflow"/>
    </section>
    <section className="growth-split">
      <div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Performance cycle</span><h3>Review operating view</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Organization</th><th>People</th><th>Complete</th><th>At-risk goals</th><th>Calibration</th><th>Stage</th></tr></thead><tbody>{performanceRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card growth-side decision-side"><div className="growth-panel-head"><div><span className="section-kicker">Decision integrity</span><h3>Human-owned ratings</h3></div><BrainCircuit size={18}/></div><p>AI can summarize evidence, highlight missing inputs and surface inconsistencies. Final performance ratings remain assigned and calibrated by authorized people.</p><div className="growth-rule"><span>Automatic rating</span><strong>Disabled</strong></div><div className="growth-rule"><span>Evidence trace</span><strong>Required</strong></div><div className="growth-rule"><span>Calibration audit</span><strong>Enabled</strong></div></aside>
    </section>
  </>;
}

const talentBoxes = [
  ["High potential", "Emerging leaders", "Accelerate", "16", "9", "7"],
  ["Moderate potential", "Core contributors", "Expand", "38", "112", "21"],
  ["Focused growth", "Build consistency", "Develop", "6", "26", "4"]
];

function TalentWorkspace() {
  return <>
    <section className="growth-metrics">
      <Metric icon={<UsersRound size={18}/>} label="People reviewed" value="486" meta="94.9% cycle coverage"/>
      <Metric icon={<Sparkles size={18}/>} label="High potential" value="32" meta="Human-reviewed designation"/>
      <Metric icon={<Award size={18}/>} label="Critical talent" value="27" meta="19 with active development plan"/>
      <Metric icon={<Activity size={18}/>} label="Calibration actions" value="14" meta="Due before cycle close"/>
    </section>
    <section className="growth-grid">
      <div className="card talent-matrix"><div className="growth-panel-head"><div><span className="section-kicker">Human-reviewed talent matrix</span><h3>Performance × potential</h3></div><span className="matrix-note">Not AI-scored</span></div><div className="matrix-body">{talentBoxes.map((row)=><div className="matrix-row" key={row[0]}><div className="matrix-label"><strong>{row[0]}</strong><small>{row[1]}</small></div>{row.slice(3).map((value,i)=><div className={`matrix-cell m${i}`} key={i}><strong>{value}</strong><small>{i===0?"Develop":i===1?"Sustain":"Accelerate"}</small></div>)}</div>)}</div><div className="matrix-axis"><span>Performance →</span><span>Needs focus</span><span>Meets</span><span>Exceeds</span></div></div>
      <aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Governance</span><h3>Talent decision controls</h3></div></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>No hidden employee score</strong><small>Assessments retain the human assessor and review cycle.</small></span></div><div><BrainCircuit size={17}/><span><strong>AI supports evidence</strong><small>No automatic promotion, termination or high-potential decision.</small></span></div><div><Activity size={17}/><span><strong>Calibration required</strong><small>Changes remain auditable and purpose-bound.</small></span></div></div></aside>
    </section>
  </>;
}

function SuccessionWorkspace() {
  return <>
    <section className="growth-metrics">
      <Metric icon={<BriefcaseBusiness size={18}/>} label="Critical positions" value="37" meta="Enterprise critical-role register"/>
      <Metric icon={<CheckCircle2 size={18}/>} label="Covered" value="28" meta="At least one successor identified"/>
      <Metric icon={<Award size={18}/>} label="Ready now" value="17" meta="Across 14 critical positions"/>
      <Metric icon={<Activity size={18}/>} label="Coverage gaps" value="9" meta="3 executive · 6 specialist roles"/>
    </section>
    <section className="growth-split">
      <div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Critical role continuity</span><h3>Succession coverage</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Position</th><th>Organization</th><th>Criticality</th><th>Candidates</th><th>Ready now</th><th>Coverage</th></tr></thead><tbody>{successionRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Pill value={r[5]}/></td></tr>)}</tbody></table></div></div>
      <aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Readiness</span><h3>Pipeline distribution</h3></div></div><div className="readiness-list"><div><span>Ready now</span><strong>17</strong><i style={{width:"78%"}}/></div><div><span>&lt; 1 year</span><strong>24</strong><i style={{width:"92%"}}/></div><div><span>1–2 years</span><strong>31</strong><i style={{width:"100%"}}/></div><div><span>2+ years</span><strong>18</strong><i style={{width:"62%"}}/></div></div></aside>
    </section>
  </>;
}

function LearningWorkspace() {
  return <>
    <section className="growth-metrics">
      <Metric icon={<BookOpenCheck size={18}/>} label="Mandatory compliance" value="94.8%" meta="Across active assignments"/>
      <Metric icon={<GraduationCap size={18}/>} label="Skills catalog" value="126" meta="18 marked business-critical"/>
      <Metric icon={<Activity size={18}/>} label="Critical skill gaps" value="18" meta="Across 11 roles"/>
      <Metric icon={<Target size={18}/>} label="Due in 30 days" value="42" meta="7 already escalated"/>
    </section>
    <section className="growth-split">
      <div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">Learning compliance</span><h3>Assigned learning</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Course</th><th>Domain</th><th>Requirement</th><th>Completed</th><th>Due</th><th>Rate</th></tr></thead><tbody>{learningRows.map((r)=><tr key={r[0]}>{r.map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table></div></div>
      <aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">Skills intelligence</span><h3>Critical capability gaps</h3></div></div><div className="skill-list"><div><span>Cloud security architecture</span><strong>8 gaps</strong></div><div><span>AI governance</span><strong>5 gaps</strong></div><div><span>People leadership</span><strong>3 gaps</strong></div><div><span>Data privacy engineering</span><strong>2 gaps</strong></div></div></aside>
    </section>
  </>;
}

export function GrowthWorkspace({ slug }: { slug: string }) {
  return <div className="growth-shell">{slug === "benefits" ? <BenefitsWorkspace/> : slug === "performance" ? <PerformanceWorkspace/> : slug === "talent" ? <TalentWorkspace/> : slug === "succession" ? <SuccessionWorkspace/> : <LearningWorkspace/>}</div>;
}
