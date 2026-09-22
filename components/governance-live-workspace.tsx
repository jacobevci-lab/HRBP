import Link from "next/link";
import { Archive, BadgeCheck, FileText, History, KeyRound, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import { DataClassification } from "@prisma/client";
import { can, canReadClassification } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getAuditWorkspaceData, getDocumentWorkspaceData } from "@/lib/governance-live-data";
import { AuditChainButton } from "@/components/audit-chain-button";

function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: React.ComponentType<{ size?: number }> }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Restricted({ title, detail, returnTo }: { title: string; detail: string; returnTo: string }) {
  return <div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>{title}</h3><p>{detail}</p><Link className="secondary-button" style={{ marginTop: 12 }} href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with enterprise SSO</Link></div></div>;
}

function SearchBar({ action, query, placeholder }: { action: string; query: string; placeholder: string }) {
  return <form className="enterprise-toolbar" action={action} method="get"><div className="enterprise-search"><Search size={16}/><input name="q" defaultValue={query} placeholder={placeholder}/></div><div style={{ display: "flex", gap: 8 }}><button className="secondary-button" type="submit">Search</button>{query ? <Link className="secondary-button" href={action}>Clear</Link> : null}</div></form>;
}

export async function GovernanceLiveWorkspace({ slug, query = "" }: { slug: string; query?: string }) {
  const ctx = await getServerRequestContext();

  if (slug === "documents") {
    if (!ctx) return <Restricted title="Employee document vault requires authentication" detail="Document metadata and object access are never exposed through the public staging surface." returnTo="/module/documents"/>;
    if (!can(ctx, "documents:read")) return <Restricted title="Document vault restricted" detail="Your current role does not include documents:read permission." returnTo="/module/documents"/>;
    const includeHighlyRestricted = canReadClassification(ctx, DataClassification.HIGHLY_RESTRICTED);
    const data = await getDocumentWorkspaceData(ctx.tenantId, includeHighlyRestricted, query);

    return <>
      <div className="enterprise-stats"><Stat label="Vault objects" value={String(data.total)} meta="Visible to current policy scope" icon={FileText}/><Stat label="Restricted" value={String(data.restricted)} meta={includeHighlyRestricted ? "Restricted + highly restricted" : "Highly restricted excluded"} icon={LockKeyhole}/><Stat label="Expiring soon" value={String(data.expiring)} meta="Next 30 days" icon={History}/><Stat label="Legal hold" value={String(data.legalHold)} meta="Deletion blocked" icon={Archive}/></div>
      <SearchBar action="/module/documents" query={query} placeholder="Search document name, purpose or employee…"/>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>Employee document vault</h3><p>Live metadata from PostgreSQL. File-object authorization remains separate from list visibility.</p></div><span>{data.rows.length} shown</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Document</th><th>Owner</th><th>Purpose</th><th>Classification</th><th>Status</th><th>Retention</th><th>Created</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><span className="document-name"><FileText size={15}/><strong>{row.fileName}</strong></span>{row.legalHold ? <small className="cell-sub">Legal hold active</small> : null}</td><td>{row.owner}</td><td>{row.purpose}</td><td><em className={`classification ${row.classification.toLowerCase().replaceAll(" ", "-")}`}>{row.classification}</em></td><td>{row.status}</td><td>{row.retention}<small className="cell-sub">Expires: {row.expires}</small></td><td>{row.created}</td></tr>) : <tr><td colSpan={7} style={{ textAlign: "center", padding: 28 }}>No documents match this policy scope.</td></tr>}</tbody></table></div></div>
    </>;
  }

  if (slug === "audit") {
    if (!ctx) return <Restricted title="Audit ledger requires authentication" detail="Security-relevant audit events are not exposed on the public staging surface." returnTo="/module/audit"/>;
    if (!can(ctx, "audit:read")) return <Restricted title="Audit ledger restricted" detail="Your current role does not include audit:read permission." returnTo="/module/audit"/>;
    const data = await getAuditWorkspaceData(ctx.tenantId, query);

    return <>
      <div className="enterprise-stats"><Stat label="Events today" value={String(data.today)} meta="Append-only business/security events" icon={History}/><Stat label="Privileged reads" value={String(data.privilegedReads)} meta="Restricted views today" icon={KeyRound}/><Stat label="Ledger events" value={String(data.total)} meta="Tenant hash chain" icon={ShieldCheck}/><Stat label="Integrity" value="Verifiable" meta="SHA-256 chained evidence" icon={BadgeCheck}/></div>
      <SearchBar action="/module/audit" query={query} placeholder="Search actor, action, resource or purpose…"/>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>Audit ledger</h3><p>Live tenant-scoped security and business mutation evidence.</p></div><AuditChainButton/></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Actor</th><th>Action</th><th>Resource</th><th>Declared purpose</th><th>Classification</th><th>IP</th><th>Time</th></tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.actorId}</strong></td><td>{row.action}</td><td><code>{row.resourceType}:{row.resourceId}</code></td><td>{row.purpose}</td><td><em className={`classification ${row.classification.toLowerCase().replaceAll(" ", "-")}`}>{row.classification}</em></td><td>{row.ipAddress}</td><td>{row.occurredAt}</td></tr>) : <tr><td colSpan={7} style={{ textAlign: "center", padding: 28 }}>No audit events match this search.</td></tr>}</tbody></table></div></div>
    </>;
  }

  return null;
}

export const liveGovernanceWorkspaceSlugs = new Set(["documents", "audit"]);
