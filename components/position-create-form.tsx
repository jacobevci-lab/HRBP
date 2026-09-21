"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Save } from "lucide-react";
import { FormEvent, useState } from "react";

export type OrganizationOption = { id: string; code: string; name: string; type: string };

export function PositionCreateForm({ organizations }: { organizations: OrganizationOption[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setRequiresAuth(false);

    const form = new FormData(event.currentTarget);
    const payload = {
      positionCode: String(form.get("positionCode") ?? ""),
      title: String(form.get("title") ?? ""),
      orgUnitId: String(form.get("orgUnitId") ?? ""),
      jobFamily: String(form.get("jobFamily") ?? ""),
      grade: String(form.get("grade") ?? ""),
      location: String(form.get("location") ?? ""),
      status: String(form.get("status") ?? "OPEN"),
      critical: form.get("critical") === "on"
    };

    try {
      const response = await fetch("/api/positions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Workforce management" },
        body: JSON.stringify(payload)
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 401) setRequiresAuth(true);
        setError(value.error || "Position could not be created.");
        return;
      }
      router.push("/module/positions");
      router.refresh();
    } catch {
      setError("The request could not reach HRBP. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="card record-form-card">
    <div className="record-form-header"><h2>Position record</h2><p>Create a budgeted organizational seat independently from an incumbent. Hiring will assign an employee to this record later.</p></div>
    <form className="record-form" onSubmit={submit}>
      <div className="form-field"><label htmlFor="positionCode">Position code</label><input id="positionCode" name="positionCode" required autoComplete="off" placeholder="SEC-004"/></div>
      <div className="form-field"><label htmlFor="status">Initial status</label><select id="status" name="status" defaultValue="OPEN"><option value="OPEN">Open</option><option value="PLANNED">Planned</option></select></div>
      <div className="form-field full"><label htmlFor="title">Position title</label><input id="title" name="title" required placeholder="Senior Security Engineer"/></div>
      <div className="form-field full"><label htmlFor="orgUnitId">Organization unit</label><select id="orgUnitId" name="orgUnitId" required defaultValue=""><option value="" disabled>Select organization unit</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.code} · {org.name} · {org.type}</option>)}</select></div>
      <div className="form-field"><label htmlFor="jobFamily">Job family</label><input id="jobFamily" name="jobFamily" placeholder="Security"/></div>
      <div className="form-field"><label htmlFor="grade">Grade / level</label><input id="grade" name="grade" placeholder="IC4"/></div>
      <div className="form-field full"><label htmlFor="location">Location</label><input id="location" name="location" placeholder="Istanbul / Remote EU"/></div>
      <div className="form-field full"><label className="form-check"><input type="checkbox" name="critical"/> <span><strong>Critical position</strong><small>Include this seat in business-continuity and succession coverage signals.</small></span></label></div>

      {error ? <div className="form-error">{error}{requiresAuth ? <> <Link href="/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew">Sign in with enterprise SSO.</Link></> : null}</div> : null}
      <div className="form-actions"><Link className="secondary-button" href="/module/positions">Cancel</Link><button className="create-button" type="submit" disabled={submitting || organizations.length === 0}><Save size={15}/>{submitting ? "Creating…" : "Create position"}</button></div>
    </form>
    <div className="governance-note" style={{ margin: "0 20px 20px" }}><BriefcaseBusiness size={17}/><p>Current position codes are tenant-scoped, organization ownership is verified server-side and every position creation is added to the audit ledger.</p></div>
  </div>;
}
