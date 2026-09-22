"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import styles from "@/components/access-scope-admin.module.css";

type UserOption = { id: string; displayName: string; email: string | null };
type EmploymentOption = {
  id: string;
  person: { employeeNumber: string | null; givenName: string; familyName: string };
  position: { title: string; orgUnit: { name: string } } | null;
};
type Grant = {
  id: string;
  userId: string;
  employmentId: string;
  validFrom: string;
  validTo: string | null;
  user: UserOption | null;
  employment: EmploymentOption | null;
};
type Payload = {
  data: Grant[];
  options: { users: UserOption[]; employments: EmploymentOption[] };
  permissions: { write: boolean };
};

function employmentLabel(employment: EmploymentOption) {
  const person = `${employment.person.givenName} ${employment.person.familyName}`;
  const number = employment.person.employeeNumber ? ` · ${employment.person.employeeNumber}` : "";
  const role = employment.position ? ` · ${employment.position.title} / ${employment.position.orgUnit.name}` : "";
  return `${person}${number}${role}`;
}

export function AccessScopeAdmin() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [userId, setUserId] = useState("");
  const [employmentId, setEmploymentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/access-grants", { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Access scope data could not be loaded.");
    }
    const body = await response.json() as Payload;
    setPayload(body);
    setUserId((current) => current || body.options.users[0]?.id || "");
    setEmploymentId((current) => current || body.options.employments[0]?.id || "");
  }, []);

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : "Access scope data could not be loaded."));
  }, [load]);

  const activeGrants = useMemo(() => {
    const now = Date.now();
    return payload?.data.filter((grant) => !grant.validTo || new Date(grant.validTo).getTime() >= now) ?? [];
  }, [payload]);

  async function addGrant() {
    if (!userId || !employmentId || !payload?.permissions.write) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/access-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, employmentId })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Population grant could not be saved.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Population grant could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(id: string) {
    if (!payload?.permissions.write) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/settings/access-grants/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Population grant could not be revoked.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Population grant could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  const canWrite = payload?.permissions.write ?? false;
  return <section className="card platform-panel">
    <div className="platform-head"><div><span className="section-kicker">Relationship-aware access</span><h3>HRBP population scope</h3><p className={styles.panelCopy}>Grant named HRBP users access to specific employment relationships. Self, direct-report, case-wall and tenant-wide scopes continue to be derived separately.</p></div><UserRoundCog size={19}/></div>
    {error ? <div className={styles.error}>{error}</div> : null}
    {canWrite ? <div className={styles.form}>
      <label className={styles.field}><span>HRBP user</span><select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy || !payload?.options.users.length}>{payload?.options.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}{user.email ? ` · ${user.email}` : ""}</option>)}</select></label>
      <label className={styles.field}><span>Employment population member</span><select value={employmentId} onChange={(event) => setEmploymentId(event.target.value)} disabled={busy || !payload?.options.employments.length}>{payload?.options.employments.map((employment) => <option key={employment.id} value={employment.id}>{employmentLabel(employment)}</option>)}</select></label>
      <button className={styles.grantButton} type="button" onClick={addGrant} disabled={busy || !userId || !employmentId}><ShieldCheck size={16}/>{busy ? "Saving…" : "Grant scope"}</button>
    </div> : <p className={styles.panelCopy}>Read-only view. Population mutations require settings:write.</p>}
    <div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>HRBP</th><th>Population member</th><th>Valid from</th><th>Valid to</th><th>Action</th></tr></thead><tbody>{activeGrants.length ? activeGrants.map((grant) => <tr key={grant.id}><td>{grant.user?.displayName ?? grant.userId}</td><td>{grant.employment ? employmentLabel(grant.employment) : grant.employmentId}</td><td>{new Date(grant.validFrom).toLocaleDateString()}</td><td>{grant.validTo ? new Date(grant.validTo).toLocaleDateString() : "Open-ended"}</td><td>{canWrite ? <button className={styles.revokeButton} type="button" onClick={() => revokeGrant(grant.id)} disabled={busy}><Trash2 size={15}/>Revoke</button> : "Read-only"}</td></tr>) : <tr><td className={styles.empty} colSpan={5}>No active HRBP population grants.</td></tr>}</tbody></table></div>
  </section>;
}
