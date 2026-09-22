import Link from "next/link";
import { BadgeDollarSign, Clock3, LockKeyhole, ShieldCheck, TrendingUp } from "lucide-react";
import { can } from "@/lib/authorization";
import { getCompensationWorkspaceData } from "@/lib/compensation-live-data";
import { getServerRequestContext } from "@/lib/server-session";
import { CompensationDecisionButtons } from "@/components/compensation-decision-buttons";

function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: React.ComponentType<{ size?: number }> }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function money(currency: string, amount: string | number) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
}

function Restricted({ detail }: { detail: string }) {
  return <div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>Compensation is a restricted domain</h3><p>{detail}</p><Link className="secondary-button" style={{ marginTop: 12 }} href={`/auth/sign-in?returnTo=${encodeURIComponent("/module/compensation")}`}>Sign in with enterprise SSO</Link></div></div>;
}

export async function CompensationLiveWorkspace() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <Restricted detail="Salary, compensation history and approval queues are never exposed through the public staging surface."/>;
  if (!can(ctx, "compensation:read")) return <Restricted detail="Your current role does not include compensation:read. Tenant administration alone does not grant salary access."/>;

  const data = await getCompensationWorkspaceData(ctx.tenantId);
  const canWrite = can(ctx, "compensation:write");
  const totalSummary = data.currencies.length
    ? data.currencies.slice(0, 2).map((entry) => `${entry.currency} ${money(entry.currency, entry.total)}`).join(" · ")
    : "No active base salary records";

  return <>
    <div className="enterprise-stats"><Stat label="Current salary records" value={String(data.currentRecords)} meta={totalSummary} icon={BadgeDollarSign}/><Stat label="Awaiting approval" value={String(data.pending)} meta="Four-eyes decision required" icon={Clock3}/><Stat label="Approved / scheduled" value={String(data.approved)} meta="Ready for effective-dated apply" icon={TrendingUp}/><Stat label="Applied changes" value={String(data.applied)} meta="Historical records preserved" icon={ShieldCheck}/></div>
    <section className="card compensation-governance-note"><ShieldCheck size={20}/><div><strong>Restricted approval boundary</strong><p>Requesters cannot approve or apply their own compensation changes. Approved values create a new effective-dated salary record; prior history is closed, never overwritten.</p></div></section>
    <div className="card enterprise-table-card"><div className="table-title"><div><h3>Compensation change queue</h3><p>Live tenant-scoped requests from PostgreSQL with restricted authorization and audit evidence.</p></div><span>{data.rows.length} records</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Employee</th><th>Current → proposed</th><th>Effective</th><th>Status</th><th>Reason</th><th>Requester / approver</th>{canWrite ? <th>Decision</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position} · {row.organization}</small></td><td>{row.currentAnnualBase ? <><span>{money(row.currency, row.currentAnnualBase)}</span><small className="cell-sub">→ {money(row.currency, row.proposedAnnualBase)}</small></> : <strong className="cell-strong">{money(row.currency, row.proposedAnnualBase)}</strong>}</td><td>{row.effectiveAt}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</em></td><td>{row.reason}</td><td><code>{row.requestedById}</code>{row.approvedById ? <small className="cell-sub">Approved: {row.approvedById}</small> : null}</td>{canWrite ? <td><CompensationDecisionButtons changeId={row.id} status={row.rawStatus}/></td> : null}</tr>) : <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", padding: 28 }}>No compensation change requests are recorded.</td></tr>}</tbody></table></div></div>
  </>;
}
