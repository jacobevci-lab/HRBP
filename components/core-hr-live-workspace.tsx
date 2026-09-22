import Link from "next/link";
import type { ComponentType } from "react";
import { BadgeCheck, BadgeDollarSign, BriefcaseBusiness, Building2, ChevronRight, CircleAlert, Clock3, FileText, History, LockKeyhole, Network, Search, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { getEmployee360Data, getOrganizationWorkspaceData, getPeopleWorkspaceData, getPositionsWorkspaceData } from "@/lib/core-hr-live-data";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { CompensationRequestForm, ManagerAssignmentForm } from "@/components/employee-360-actions";

function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: ComponentType<{ size?: number }> }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function EmptyRow({ message, colSpan }: { message: string; colSpan: number }) {
  return <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: "28px" }}>{message}</td></tr>;
}

function AccessDenied({ title, detail }: { title: string; detail: string }) {
  return <div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

function PeopleSearch({ query }: { query: string }) {
  return <form className="enterprise-toolbar" action="/module/people" method="get"><div className="enterprise-search"><Search size={16}/><input name="q" defaultValue={query} placeholder="Search name, employee ID or work email…"/></div><div style={{ display: "flex", gap: 8 }}><button className="secondary-button" type="submit">Search</button>{query ? <Link className="secondary-button" href="/module/people">Clear</Link> : null}</div></form>;
}

function formatMoney(currency: string, amount: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

const employeeTabs = new Set(["overview", "employment", "compensation", "documents", "history"]);

export async function CoreHRLiveWorkspace({ slug, query = "", personId, tab }: { slug: string; query?: string; personId?: string; tab?: string }) {
  const ctx = await getServerRequestContext();
  const tenantId = ctx?.tenantId;

  if (slug === "people") {
    if (ctx && !can(ctx, "people:read")) return <AccessDenied title="People directory restricted" detail="Your current role does not include people:read access."/>;
    const data = await getPeopleWorkspaceData(query, tenantId);
    return <>
      <div className="enterprise-stats"><Stat label="Active workers" value={String(data.active)} meta="Current employment records" icon={UsersRound}/><Stat label="Preboarding" value={String(data.preboarding)} meta="Accepted future starters" icon={UserCheck}/><Stat label="On leave" value={String(data.onLeave)} meta="Current leave status" icon={Clock3}/><Stat label="Data quality" value={`${data.dataQuality.toFixed(1)}%`} meta={`${data.needsReview} records need review`} icon={BadgeCheck}/></div>
      <PeopleSearch query={query}/>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>People directory</h3><p>Live golden employee records from PostgreSQL with current effective-dated assignment.</p></div><span>{data.people.length} shown</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Location</th><th>Status</th><th>Start date</th><th/></tr></thead><tbody>{data.people.length ? data.people.map((person) => <tr key={person.id}><td><div className="enterprise-person"><span>{person.initials}</span><div><strong>{person.name}</strong><small>{person.employeeNumber} · {person.workEmail}</small></div></div></td><td><strong className="cell-strong">{person.position}</strong><small className="cell-sub">{person.positionCode}</small></td><td>{person.department}</td><td>{person.location}</td><td><em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{person.status}</em></td><td>{person.startDate}</td><td><Link className="row-action" href={`/module/employee-360?person=${encodeURIComponent(person.id)}`} aria-label={`Open ${person.name}`}><ChevronRight size={15}/></Link></td></tr>) : <EmptyRow message="No people match this search." colSpan={7}/>}</tbody></table></div></div>
    </>;
  }

  if (slug === "organization") {
    if (ctx && !can(ctx, "organization:read")) return <AccessDenied title="Organization restricted" detail="Your current role does not include organization:read access."/>;
    const data = await getOrganizationWorkspaceData(tenantId);
    return <>
      <div className="enterprise-stats"><Stat label="Legal entities" value={String(data.legalEntities)} meta="Current effective records" icon={Building2}/><Stat label="Organization units" value={String(data.organizationUnits)} meta="Effective-dated hierarchy" icon={Network}/><Stat label="Filled positions" value={String(data.filledPositions)} meta="Budgeted seats occupied" icon={UsersRound}/><Stat label="Vacant positions" value={String(data.vacantPositions)} meta="Available for hiring" icon={CircleAlert}/></div>
      <div className="org-layout"><div className="card org-tree"><div className="table-title"><div><h3>Organization model</h3><p>Live hierarchy from the system of record.</p></div><button className="secondary-button" disabled>Scenario view</button></div><div className="org-nodes">{data.units.map((unit) => <div className={`org-node level-${Math.min(unit.depth, 2)}`} key={unit.id}><div className="org-node-icon"><Building2 size={16}/></div><div><strong>{unit.name}</strong><small>{unit.type} · {unit.code}</small></div><div className="org-node-count"><strong>{unit.people}</strong><small>{unit.people === 1 ? "person" : "people"} · {unit.positions} positions</small></div></div>)}</div></div><div className="card org-insight"><div className="table-title"><div><h3>Structure health</h3><p>Governed organization signals</p></div></div><div className="health-list"><div><span>Effective-dated units</span><strong>{data.organizationUnits}</strong></div><div><span>Filled positions</span><strong>{data.filledPositions}</strong></div><div><span>Vacant positions</span><strong>{data.vacantPositions}</strong></div><div><span>Hierarchy source</span><strong>PostgreSQL</strong></div></div><div className="governance-note"><ShieldCheck size={17}/><p>Organization changes preserve historical truth. Approved changes create new effective-dated records instead of overwriting previous organizational state.</p></div></div></div>
    </>;
  }

  if (slug === "positions") {
    if (ctx && !can(ctx, "positions:read")) return <AccessDenied title="Positions restricted" detail="Your current role does not include positions:read access."/>;
    const data = await getPositionsWorkspaceData(tenantId);
    return <>
      <div className="enterprise-stats"><Stat label="Positions" value={String(data.positions)} meta={`${data.filled} filled`} icon={BriefcaseBusiness}/><Stat label="Open" value={String(data.open)} meta="Available for recruiting" icon={CircleAlert}/><Stat label="Planned" value={String(data.planned)} meta="Future workforce plan" icon={Clock3}/><Stat label="Critical roles" value={String(data.critical)} meta="Business continuity scoped" icon={ShieldCheck}/></div>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>Position register</h3><p>Live budgeted seats exist independently from incumbents.</p></div><button className="secondary-button" disabled>Position controls</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Position</th><th>Organization</th><th>Grade</th><th>Location</th><th>Incumbent</th><th>Status</th><th>Critical</th></tr></thead><tbody>{data.rows.length ? data.rows.map((position) => <tr key={position.id}><td><strong className="cell-strong">{position.title}</strong><small className="cell-sub">{position.code}</small></td><td>{position.org}</td><td>{position.grade}</td><td>{position.location}</td><td>{position.incumbent}</td><td><em className={`pill ${position.status.toLowerCase().replaceAll(" ", "-")}`}>{position.status}</em></td><td>{position.critical ? <span className="critical-badge"><ShieldCheck size={13}/> Yes</span> : "—"}</td></tr>) : <EmptyRow message="No positions are configured." colSpan={7}/>}</tbody></table></div></div>
    </>;
  }

  if (slug === "employee-360") {
    if (ctx && !can(ctx, "people:read")) return <AccessDenied title="Employee 360 restricted" detail="Your current role does not include people:read access."/>;

    const canReadCompensation = !!ctx && can(ctx, "compensation:read");
    const canWriteCompensation = !!ctx && can(ctx, "compensation:write");
    const canReadDocuments = !!ctx && can(ctx, "documents:read");
    const canWritePeople = !!ctx && can(ctx, "people:write");
    const person = await getEmployee360Data(personId, {
      tenantId,
      includeCompensation: canReadCompensation,
      includeDocuments: canReadDocuments,
      includeManagerOptions: canWritePeople
    });
    if (!person) return <div className="card"><div className="empty-state"><h3>No employee record found</h3><p>Select a person from the People directory.</p><Link className="secondary-button" href="/module/people">Open People</Link></div></div>;

    const activeTab = tab && employeeTabs.has(tab) ? tab : "overview";
    const tabHref = (value: string) => `/module/employee-360?person=${encodeURIComponent(person.id)}&tab=${value}`;
    const currentCompensation = person.compensationHistory[0];

    return <>
      <div className="employee-hero card"><div className="employee-avatar">{person.initials}</div><div className="employee-identity"><div className="identity-top"><h2>{person.name}</h2><em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{person.status}</em></div><p>{person.position} · {person.department}</p><div className="identity-meta"><span>{person.employeeNumber}</span><span>{person.positionCode}</span><span>{person.location}</span><span>Manager: {person.manager}</span><span>{person.workEmail}</span>{person.criticalPosition ? <span>Critical position</span> : null}</div></div><Link className="secondary-button" href="/module/people">Back to people</Link></div>
      <div className="profile-tabs">{[["overview","Overview"],["employment","Employment"],["compensation","Compensation"],["documents","Documents"],["history","History"]].map(([value,label]) => <Link key={value} className={activeTab === value ? "active" : ""} href={tabHref(value)}>{label}</Link>)}</div>

      {activeTab === "overview" ? <div className="profile-grid"><div className="card profile-card"><div className="table-title"><div><h3>Employment</h3><p>Current effective record</p></div></div><dl><div><dt>Position</dt><dd>{person.position}</dd></div><div><dt>Department</dt><dd>{person.department}</dd></div><div><dt>Job family</dt><dd>{person.jobFamily}</dd></div><div><dt>Grade</dt><dd>{person.grade}</dd></div><div><dt>Start date</dt><dd>{person.startDate}</dd></div><div><dt>Manager</dt><dd>{person.manager}</dd></div><div><dt>Direct reports</dt><dd>{person.directReports}</dd></div></dl></div><div className="card profile-card"><div className="table-title"><div><h3>Lifecycle</h3><p>Immutable effective-dated business history</p></div></div><div className="profile-timeline">{person.lifecycle.slice(0, 7).map((event) => <div key={event.id}><i/><span><strong>{event.type}{event.scheduled ? " · Scheduled" : ""}</strong><small>{event.summary} · {event.date}</small></span></div>)}</div></div><div className="card profile-card security-card"><div className="table-title"><div><h3>Data access</h3><p>Classification & policy context</p></div></div><div className="security-status"><ShieldCheck size={20}/><div><strong>{person.classification}</strong><small>Golden employee record</small></div></div><div className="mini-policy"><span>Compensation</span><strong>{canReadCompensation ? "Authorized" : "Restricted"}</strong></div><div className="mini-policy"><span>Documents</span><strong>{canReadDocuments ? "Authorized" : "Restricted"}</strong></div><div className="mini-policy"><span>ER cases</span><strong>Case wall</strong></div><div className="mini-policy"><span>Audit logging</span><strong>Enabled</strong></div></div></div> : null}

      {activeTab === "employment" ? <div className="employee-detail-stack"><div className="profile-grid two-column"><div className="card profile-card"><div className="table-title"><div><h3>Current employment</h3><p>Effective relationship and job architecture</p></div></div><dl><div><dt>Employment ID</dt><dd>{person.employmentId ?? "—"}</dd></div><div><dt>Status</dt><dd>{person.status}</dd></div><div><dt>Start / end</dt><dd>{person.startDate} → {person.endDate}</dd></div><div><dt>Position</dt><dd>{person.position} · {person.positionCode}</dd></div><div><dt>Job family / grade</dt><dd>{person.jobFamily} · {person.grade}</dd></div><div><dt>Organization</dt><dd>{person.department} · {person.organizationType}</dd></div><div><dt>Manager</dt><dd>{person.manager}</dd></div></dl></div><div className="card profile-card"><div className="table-title"><div><h3>Work pattern</h3><p>Effective work schedule</p></div></div><dl>{person.workSchedule ? <><div><dt>Schedule</dt><dd>{person.workSchedule.name} · {person.workSchedule.code}</dd></div><div><dt>Weekly hours</dt><dd>{person.workSchedule.weeklyHours}</dd></div><div><dt>Timezone</dt><dd>{person.workSchedule.timezone}</dd></div></> : <div><dt>Schedule</dt><dd>Not assigned</dd></div>}<div><dt>Direct reports</dt><dd>{person.directReports}</dd></div><div><dt>Record created</dt><dd>{person.createdAt}</dd></div><div><dt>Last updated</dt><dd>{person.updatedAt}</dd></div></dl></div></div>{canWritePeople ? <ManagerAssignmentForm personId={person.id} currentManagerEmploymentId={person.currentManagerEmploymentId} managers={person.managerOptions}/> : null}<div className="card enterprise-table-card"><div className="table-title"><div><h3>Employment history</h3><p>Previous employments are preserved rather than overwritten.</p></div><span>{person.employmentHistory.length} records</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Position</th><th>Department</th><th>Manager</th><th>Status</th><th>Start</th><th>End</th></tr></thead><tbody>{person.employmentHistory.length ? person.employmentHistory.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.position}</strong><small className="cell-sub">{row.positionCode}</small></td><td>{row.department}</td><td>{row.manager}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</em></td><td>{row.startDate}</td><td>{row.endDate}</td></tr>) : <EmptyRow message="No employment history recorded." colSpan={6}/>}</tbody></table></div></div></div> : null}

      {activeTab === "compensation" ? canReadCompensation ? <div className="employee-detail-stack"><div className="enterprise-stats"><Stat label="Current base" value={currentCompensation ? formatMoney(currentCompensation.currency, currentCompensation.annualBase) : "—"} meta="Restricted compensation data" icon={BadgeDollarSign}/><Stat label="History records" value={String(person.compensationHistory.length)} meta="Effective-dated values" icon={History}/><Stat label="Change requests" value={String(person.compensationRequests.length)} meta="Approval-bound workflow" icon={Clock3}/><Stat label="Access" value="Granted" meta="RBAC compensation:read" icon={ShieldCheck}/></div><div className="card enterprise-table-card"><div className="table-title"><div><h3>Compensation history</h3><p>Restricted effective-dated salary records.</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Annual base</th><th>Currency</th><th>Effective from</th><th>Effective to</th></tr></thead><tbody>{person.compensationHistory.length ? person.compensationHistory.map((row) => <tr key={row.id}><td><strong className="cell-strong">{formatMoney(row.currency, row.annualBase)}</strong></td><td>{row.currency}</td><td>{row.effectiveFrom}</td><td>{row.effectiveTo}</td></tr>) : <EmptyRow message="No compensation history is recorded." colSpan={4}/>}</tbody></table></div></div><div className="card enterprise-table-card"><div className="table-title"><div><h3>Change requests</h3><p>Proposals stay separate from salary history until approved and applied.</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Proposed base</th><th>Effective</th><th>Status</th><th>Reason</th><th>Requested</th></tr></thead><tbody>{person.compensationRequests.length ? person.compensationRequests.map((row) => <tr key={row.id}><td><strong className="cell-strong">{formatMoney(row.currency, row.proposedAnnualBase)}</strong>{row.currentAnnualBase ? <small className="cell-sub">From {formatMoney(row.currency, row.currentAnnualBase)}</small> : null}</td><td>{row.effectiveAt}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</em></td><td>{row.reason}</td><td>{row.createdAt}</td></tr>) : <EmptyRow message="No compensation changes are waiting or recorded." colSpan={5}/>}</tbody></table></div></div>{canWriteCompensation ? <CompensationRequestForm personId={person.id} currency={currentCompensation?.currency ?? "EUR"}/> : null}</div> : <AccessDenied title="Compensation is restricted" detail="Salary and compensation history require an authenticated role with compensation:read permission. Tenant administration alone does not grant salary access."/> : null}

      {activeTab === "documents" ? canReadDocuments ? <div className="card enterprise-table-card"><div className="table-title"><div><h3>Employee documents</h3><p>Metadata only. Object access remains separately policy-controlled.</p></div><span>{person.documents.length} objects</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Document</th><th>Purpose</th><th>Classification</th><th>Status</th><th>Created</th><th>Retention / expiry</th></tr></thead><tbody>{person.documents.length ? person.documents.map((document) => <tr key={document.id}><td><span className="document-name"><FileText size={15}/><strong>{document.fileName}</strong></span><small className="cell-sub">{document.contentType}</small></td><td>{document.purpose}</td><td><em className={`classification ${document.classification.toLowerCase().replaceAll(" ", "-")}`}>{document.classification}</em></td><td>{document.status}</td><td>{document.createdAt}</td><td>{document.retentionUntil}<small className="cell-sub">Expires: {document.expiresAt}</small></td></tr>) : <EmptyRow message="No employee documents are stored." colSpan={6}/>}</tbody></table></div></div> : <AccessDenied title="Documents are restricted" detail="Employee document metadata requires an authenticated role with documents:read permission. Object download remains a separate authorization decision."/> : null}

      {activeTab === "history" ? <div className="card profile-card employee-history-card"><div className="table-title"><div><h3>Employee lifecycle ledger</h3><p>Effective-dated events provide a durable career timeline.</p></div><span>{person.lifecycle.length} events</span></div><div className="profile-timeline">{person.lifecycle.length ? person.lifecycle.map((event) => <div key={event.id}><i/><span><strong>{event.type}{event.scheduled ? " · Scheduled" : ""}</strong><small>{event.summary} · {event.date}</small></span></div>) : <p className="employee-empty-copy">No lifecycle events recorded yet.</p>}</div></div> : null}
    </>;
  }

  return null;
}

export const liveCoreWorkspaceSlugs = new Set(["people", "organization", "positions", "employee-360"]);
