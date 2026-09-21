import Link from "next/link";
import type { ComponentType } from "react";
import { BadgeCheck, BriefcaseBusiness, Building2, ChevronRight, CircleAlert, Clock3, Network, Search, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { getEmployee360Data, getOrganizationWorkspaceData, getPeopleWorkspaceData, getPositionsWorkspaceData } from "@/lib/core-hr-live-data";

function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: ComponentType<{ size?: number }> }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function EmptyRow({ message, colSpan }: { message: string; colSpan: number }) {
  return <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: "28px" }}>{message}</td></tr>;
}

function PeopleSearch({ query }: { query: string }) {
  return <form className="enterprise-toolbar" action="/module/people" method="get"><div className="enterprise-search"><Search size={16}/><input name="q" defaultValue={query} placeholder="Search name, employee ID or work email…"/></div><div style={{ display: "flex", gap: 8 }}><button className="secondary-button" type="submit">Search</button>{query ? <Link className="secondary-button" href="/module/people">Clear</Link> : null}</div></form>;
}

export async function CoreHRLiveWorkspace({ slug, query = "", personId }: { slug: string; query?: string; personId?: string }) {
  if (slug === "people") {
    const data = await getPeopleWorkspaceData(query);
    return <>
      <div className="enterprise-stats"><Stat label="Active workers" value={String(data.active)} meta="Current employment records" icon={UsersRound}/><Stat label="Preboarding" value={String(data.preboarding)} meta="Accepted future starters" icon={UserCheck}/><Stat label="On leave" value={String(data.onLeave)} meta="Current leave status" icon={Clock3}/><Stat label="Data quality" value={`${data.dataQuality.toFixed(1)}%`} meta={`${data.needsReview} records need review`} icon={BadgeCheck}/></div>
      <PeopleSearch query={query}/>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>People directory</h3><p>Live golden employee records from PostgreSQL with current effective-dated assignment.</p></div><span>{data.people.length} shown</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Location</th><th>Status</th><th>Start date</th><th/></tr></thead><tbody>{data.people.length ? data.people.map((person) => <tr key={person.id}><td><div className="enterprise-person"><span>{person.initials}</span><div><strong>{person.name}</strong><small>{person.employeeNumber} · {person.workEmail}</small></div></div></td><td><strong className="cell-strong">{person.position}</strong><small className="cell-sub">{person.positionCode}</small></td><td>{person.department}</td><td>{person.location}</td><td><em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{person.status}</em></td><td>{person.startDate}</td><td><Link className="row-action" href={`/module/employee-360?person=${encodeURIComponent(person.id)}`} aria-label={`Open ${person.name}`}><ChevronRight size={15}/></Link></td></tr>) : <EmptyRow message="No people match this search." colSpan={7}/>}</tbody></table></div></div>
    </>;
  }

  if (slug === "organization") {
    const data = await getOrganizationWorkspaceData();
    return <>
      <div className="enterprise-stats"><Stat label="Legal entities" value={String(data.legalEntities)} meta="Current effective records" icon={Building2}/><Stat label="Organization units" value={String(data.organizationUnits)} meta="Effective-dated hierarchy" icon={Network}/><Stat label="Filled positions" value={String(data.filledPositions)} meta="Budgeted seats occupied" icon={UsersRound}/><Stat label="Vacant positions" value={String(data.vacantPositions)} meta="Available for hiring" icon={CircleAlert}/></div>
      <div className="org-layout"><div className="card org-tree"><div className="table-title"><div><h3>Organization model</h3><p>Live hierarchy from the system of record.</p></div><button className="secondary-button" disabled>Scenario view</button></div><div className="org-nodes">{data.units.map((unit) => <div className={`org-node level-${Math.min(unit.depth, 2)}`} key={unit.id}><div className="org-node-icon"><Building2 size={16}/></div><div><strong>{unit.name}</strong><small>{unit.type} · {unit.code}</small></div><div className="org-node-count"><strong>{unit.people}</strong><small>{unit.people === 1 ? "person" : "people"} · {unit.positions} positions</small></div></div>)}</div></div><div className="card org-insight"><div className="table-title"><div><h3>Structure health</h3><p>Governed organization signals</p></div></div><div className="health-list"><div><span>Effective-dated units</span><strong>{data.organizationUnits}</strong></div><div><span>Filled positions</span><strong>{data.filledPositions}</strong></div><div><span>Vacant positions</span><strong>{data.vacantPositions}</strong></div><div><span>Hierarchy source</span><strong>PostgreSQL</strong></div></div><div className="governance-note"><ShieldCheck size={17}/><p>Organization changes preserve historical truth. Approved changes create new effective-dated records instead of overwriting previous organizational state.</p></div></div></div>
    </>;
  }

  if (slug === "positions") {
    const data = await getPositionsWorkspaceData();
    return <>
      <div className="enterprise-stats"><Stat label="Positions" value={String(data.positions)} meta={`${data.filled} filled`} icon={BriefcaseBusiness}/><Stat label="Open" value={String(data.open)} meta="Available for recruiting" icon={CircleAlert}/><Stat label="Planned" value={String(data.planned)} meta="Future workforce plan" icon={Clock3}/><Stat label="Critical roles" value={String(data.critical)} meta="Business continuity scoped" icon={ShieldCheck}/></div>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>Position register</h3><p>Live budgeted seats exist independently from incumbents.</p></div><button className="secondary-button" disabled>Position controls</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Position</th><th>Organization</th><th>Grade</th><th>Location</th><th>Incumbent</th><th>Status</th><th>Critical</th></tr></thead><tbody>{data.rows.length ? data.rows.map((position) => <tr key={position.id}><td><strong className="cell-strong">{position.title}</strong><small className="cell-sub">{position.code}</small></td><td>{position.org}</td><td>{position.grade}</td><td>{position.location}</td><td>{position.incumbent}</td><td><em className={`pill ${position.status.toLowerCase().replaceAll(" ", "-")}`}>{position.status}</em></td><td>{position.critical ? <span className="critical-badge"><ShieldCheck size={13}/> Yes</span> : "—"}</td></tr>) : <EmptyRow message="No positions are configured." colSpan={7}/>}</tbody></table></div></div>
    </>;
  }

  if (slug === "employee-360") {
    const person = await getEmployee360Data(personId);
    if (!person) return <div className="card"><div className="empty-state"><h3>No employee record found</h3><p>Select a person from the People directory.</p><Link className="secondary-button" href="/module/people">Open People</Link></div></div>;

    return <>
      <div className="employee-hero card"><div className="employee-avatar">{person.initials}</div><div className="employee-identity"><div className="identity-top"><h2>{person.name}</h2><em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{person.status}</em></div><p>{person.position} · {person.department}</p><div className="identity-meta"><span>{person.employeeNumber}</span><span>{person.positionCode}</span><span>{person.location}</span><span>Manager: {person.manager}</span><span>{person.workEmail}</span></div></div><Link className="secondary-button" href="/module/people">Back to people</Link></div>
      <div className="profile-tabs"><button className="active">Overview</button><button>Employment</button><button>Compensation</button><button>Performance</button><button>Talent</button><button>Documents</button><button>History</button></div>
      <div className="profile-grid"><div className="card profile-card"><div className="table-title"><div><h3>Employment</h3><p>Current effective record</p></div></div><dl><div><dt>Position</dt><dd>{person.position}</dd></div><div><dt>Department</dt><dd>{person.department}</dd></div><div><dt>Grade</dt><dd>{person.grade}</dd></div><div><dt>Location</dt><dd>{person.location}</dd></div><div><dt>Start date</dt><dd>{person.startDate}</dd></div><div><dt>Manager</dt><dd>{person.manager}</dd></div></dl></div><div className="card profile-card"><div className="table-title"><div><h3>Lifecycle</h3><p>Immutable effective-dated business history</p></div></div><div className="profile-timeline">{person.lifecycle.length ? person.lifecycle.map((event) => <div key={event.id}><i/><span><strong>{event.type}{event.scheduled ? " · Scheduled" : ""}</strong><small>{event.summary} · {event.date}</small></span></div>) : <p style={{ padding: "12px 16px", fontSize: 10, color: "#89928f" }}>No lifecycle events recorded yet.</p>}</div></div><div className="card profile-card security-card"><div className="table-title"><div><h3>Data access</h3><p>Classification & policy context</p></div></div><div className="security-status"><ShieldCheck size={20}/><div><strong>{person.classification}</strong><small>Golden employee record</small></div></div><div className="mini-policy"><span>Identity data</span><strong>Restricted boundary</strong></div><div className="mini-policy"><span>ER cases</span><strong>Case wall</strong></div><div className="mini-policy"><span>Audit logging</span><strong>Enabled</strong></div></div></div>
    </>;
  }

  return null;
}

export const liveCoreWorkspaceSlugs = new Set(["people", "organization", "positions", "employee-360"]);
