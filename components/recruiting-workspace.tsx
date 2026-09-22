import { BadgeCheck, BriefcaseBusiness, CalendarClock, CircleAlert, FileCheck2, LockKeyhole, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getOnboardingWorkspaceData, getRecruitingWorkspaceData } from "@/lib/recruiting-live-data";
import { onboardingPeople, onboardingTasks, pipeline, requisitions } from "@/lib/recruiting-demo";

function Metric({ label, value, note, icon: Icon }: { label:string; value:string; note:string; icon:React.ComponentType<{size?:number}> }) {
  return <div className="recruit-metric"><span><Icon size={16}/></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></div>;
}

function RestrictedNotice({ domain }: { domain: string }) {
  return <div className="card employee-restricted-card" style={{ marginBottom: 14 }}><LockKeyhole size={22}/><div><h3>{domain} data is protected</h3><p>The public staging experience uses synthetic records. Sign in with an authorized enterprise role to load restricted live records from PostgreSQL.</p></div></div>;
}

function DemoRecruiting() {
  return <>
    <RestrictedNotice domain="Recruiting"/>
    <div className="recruit-metrics"><Metric label="Open requisitions" value="12" note="Synthetic staging data" icon={BriefcaseBusiness}/><Metric label="Active candidates" value="86" note="Synthetic staging data" icon={UsersRound}/><Metric label="Interview pipeline" value="18" note="Synthetic staging data" icon={CalendarClock}/><Metric label="Offers" value="6" note="Synthetic staging data" icon={FileCheck2}/></div>
    <div className="recruit-grid"><section className="card pipeline-card"><div className="recruit-title"><div><h3>Candidate pipeline</h3><p>Synthetic preview — live candidate identities require recruiting:read.</p></div><span>Demo</span></div><div className="pipeline-board">{pipeline.map((column)=><div className="pipeline-column" key={column.stage}><header><strong>{column.stage}</strong><span>{column.count}</span></header>{column.people.map((person,i)=><article key={person}><div className="candidate-avatar">{person.split(" ").map(n=>n[0]).join("")}</div><div><strong>{person}</strong><small>{i === 0 ? "Senior profile" : "Candidate record"}</small></div><em>{i === 0 ? "2d" : "4d"}</em></article>)}<button disabled>Protected live records</button></div>)}</div></section>
    <section className="card requisition-card"><div className="recruit-title"><div><h3>Requisitions</h3><p>Synthetic position-backed hiring demand</p></div><button className="secondary-button" disabled>Approval queue</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Requisition</th><th>Org / location</th><th>Hiring manager</th><th>Recruiter</th><th>Candidates</th><th>Status</th><th>Target</th></tr></thead><tbody>{requisitions.map(r=><tr key={r.id}><td><strong className="cell-strong">{r.title}</strong><small className="cell-sub">{r.id}</small></td><td><strong className="cell-strong">{r.org}</strong><small className="cell-sub">{r.location}</small></td><td>{r.manager}</td><td>{r.recruiter}</td><td>{r.candidates}</td><td><em className={`pill ${r.status.toLowerCase()}`}>{r.status}</em></td><td>{r.target}</td></tr>)}</tbody></table></div></section></div>
  </>;
}

function DemoOnboarding() {
  return <>
    <RestrictedNotice domain="Onboarding"/>
    <div className="recruit-metrics"><Metric label="Preboarding" value="8" note="Synthetic staging data" icon={UserPlus}/><Metric label="Tasks complete" value="74%" note="Synthetic staging data" icon={BadgeCheck}/><Metric label="Blockers" value="3" note="Synthetic staging data" icon={CircleAlert}/><Metric label="Start readiness" value="91%" note="Synthetic staging data" icon={ShieldCheck}/></div>
    <div className="onboarding-grid"><section className="card"><div className="recruit-title"><div><h3>Onboarding journeys</h3><p>Synthetic hire-to-day-one orchestration preview.</p></div><button className="secondary-button" disabled>Journey templates</button></div><div className="journey-list">{onboardingPeople.map(p=><article key={p.name}><div className="journey-avatar">{p.initials}</div><div className="journey-person"><strong>{p.name}</strong><small>{p.role} · Starts {p.start}</small></div><div className="journey-owner"><small>Owner</small><strong>{p.owner}</strong></div><div className="journey-progress"><span><i style={{width:`${p.progress}%`}}/></span><small>{p.progress}% ready</small></div><em className={p.blockers ? "journey-blocked" : "journey-healthy"}>{p.blockers ? `${p.blockers} blocker${p.blockers>1?"s":""}` : "On track"}</em></article>)}</div></section><section className="card"><div className="recruit-title"><div><h3>Cross-functional controls</h3><p>Synthetic enterprise onboarding template</p></div></div><div className="task-control-list">{onboardingTasks.map(t=><div key={t.task}><span className={t.risk === "Healthy" ? "task-ok" : "task-watch"}/><div><strong>{t.task}</strong><small>{t.owner} · Due {t.due}</small></div><b>{t.completion}</b></div>)}</div></section></div>
  </>;
}

export async function RecruitingWorkspace({ slug }: { slug:string }) {
  const ctx = await getServerRequestContext();

  if (slug === "recruiting") {
    if (!ctx || !can(ctx, "recruiting:read")) return <DemoRecruiting/>;
    try {
      const data = await getRecruitingWorkspaceData(ctx.tenantId);
      return <>
        <div className="recruit-metrics"><Metric label="Open requisitions" value={String(data.openRequisitions)} note={`${data.approvalRequisitions} awaiting approval`} icon={BriefcaseBusiness}/><Metric label="Active candidates" value={String(data.activeCandidates)} note="Across active pipeline stages" icon={UsersRound}/><Metric label="Interview pipeline" value={String(data.interviewPipeline)} note="Interview + assessment" icon={CalendarClock}/><Metric label="Offers" value={String(data.activeOffers)} note={`${data.awaitingSignature} awaiting response`} icon={FileCheck2}/></div>
        <div className="recruit-grid"><section className="card pipeline-card"><div className="recruit-title"><div><h3>Candidate pipeline</h3><p>Restricted candidate records linked to approved requisitions.</p></div><span>Live PostgreSQL</span></div><div className="pipeline-board">{data.pipeline.map((column)=><div className="pipeline-column" key={column.rawStage}><header><strong>{column.stage}</strong><span>{column.count}</span></header>{column.people.length ? column.people.map((person)=><article key={person.id}><div className="candidate-avatar">{person.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div><div><strong>{person.name}</strong><small>{person.requisition}</small></div><em>{person.appliedAt}</em></article>) : <article><div><strong>No records</strong><small>Stage is currently empty</small></div></article>}<button disabled>{column.count} total records</button></div>)}</div></section>
        <section className="card requisition-card"><div className="recruit-title"><div><h3>Requisitions</h3><p>Live position-backed hiring demand</p></div><button className="secondary-button" disabled>Approval queue</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Requisition</th><th>Org / location</th><th>Hiring manager</th><th>Recruiter</th><th>Candidates</th><th>Status</th><th>Target</th></tr></thead><tbody>{data.requisitions.length ? data.requisitions.map(r=><tr key={r.id}><td><strong className="cell-strong">{r.title}</strong><small className="cell-sub">{r.id}</small></td><td><strong className="cell-strong">{r.org}</strong><small className="cell-sub">{r.location}</small></td><td>{r.hiringManager}</td><td>{r.recruiter}</td><td>{r.candidates}</td><td><em className={`pill ${r.status.toLowerCase().replaceAll(" ", "-")}`}>{r.status}</em></td><td>{r.target}</td></tr>) : <tr><td colSpan={7} style={{ textAlign:"center", padding:28 }}>No requisitions created yet.</td></tr>}</tbody></table></div></section></div>
        <div className="privacy-strip"><ShieldCheck size={17}/><div><strong>Recruiting privacy boundary</strong><p>Candidate records remain Restricted and only become employee history through a controlled Hire transition.</p></div><span>Policy enforced</span></div>
      </>;
    } catch (error) {
      console.error("[HRBP] Recruiting live data failed", error);
      return <DemoRecruiting/>;
    }
  }

  if (slug === "onboarding") {
    if (!ctx || !can(ctx, "onboarding:read")) return <DemoOnboarding/>;
    try {
      const data = await getOnboardingWorkspaceData(ctx.tenantId);
      return <>
        <div className="recruit-metrics"><Metric label="Active journeys" value={String(data.preboarding)} note="Open onboarding plans" icon={UserPlus}/><Metric label="Tasks complete" value={`${data.taskCompletion}%`} note="Across active plans" icon={BadgeCheck}/><Metric label="Blockers" value={String(data.blockers)} note="Blocked onboarding tasks" icon={CircleAlert}/><Metric label="Start readiness" value={`${data.readiness}%`} note="Average journey readiness" icon={ShieldCheck}/></div>
        <div className="onboarding-grid"><section className="card"><div className="recruit-title"><div><h3>Onboarding journeys</h3><p>Live hire-to-day-one orchestration across People, IT and managers.</p></div><button className="secondary-button" disabled>Journey templates</button></div><div className="journey-list">{data.journeys.length ? data.journeys.map(p=><article key={p.id}><div className="journey-avatar">{p.initials}</div><div className="journey-person"><strong>{p.name}</strong><small>{p.role} · Starts {p.start}</small></div><div className="journey-owner"><small>Owner</small><strong>{p.owner}</strong></div><div className="journey-progress"><span><i style={{width:`${p.progress}%`}}/></span><small>{p.progress}% ready</small></div><em className={p.blockers ? "journey-blocked" : "journey-healthy"}>{p.blockers ? `${p.blockers} blocker${p.blockers>1?"s":""}` : p.status}</em></article>) : <div style={{ padding:24 }}>No active onboarding journeys.</div>}</div></section><section className="card"><div className="recruit-title"><div><h3>Cross-functional controls</h3><p>Grouped from live onboarding tasks</p></div></div><div className="task-control-list">{data.controls.length ? data.controls.map(t=><div key={t.title}><span className={t.risk === "Healthy" ? "task-ok" : "task-watch"}/><div><strong>{t.title}</strong><small>{t.owner} · Due {t.due}</small></div><b>{t.completion}</b></div>) : <div style={{ padding:20 }}>No task controls configured.</div>}</div><div className="onboarding-policy"><ShieldCheck size={17}/><p>Sensitive identity documents remain in the restricted vault. IT receives provisioning attributes, not identity-document contents.</p></div></section></div>
      </>;
    } catch (error) {
      console.error("[HRBP] Onboarding live data failed", error);
      return <DemoOnboarding/>;
    }
  }
  return null;
}

export const recruitingWorkspaceSlugs = new Set(["recruiting","onboarding"]);
