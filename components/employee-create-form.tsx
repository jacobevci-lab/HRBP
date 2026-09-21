"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export type EmployeePositionOption = {
  id: string;
  code: string;
  title: string;
  org: string;
  location: string;
};

export function EmployeeCreateForm({ positions }: { positions: EmployeePositionOption[] }) {
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
      employeeNumber: String(form.get("employeeNumber") ?? ""),
      givenName: String(form.get("givenName") ?? ""),
      familyName: String(form.get("familyName") ?? ""),
      workEmail: String(form.get("workEmail") ?? ""),
      startDate: String(form.get("startDate") ?? ""),
      positionId: String(form.get("positionId") ?? "")
    };

    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Employee administration" },
        body: JSON.stringify(payload)
      });
      const value = await response.json() as { data?: { person?: { id?: string } }; error?: string };
      if (!response.ok) {
        if (response.status === 401) setRequiresAuth(true);
        setError(value.error || "Employee record could not be created.");
        return;
      }

      const personId = value.data?.person?.id;
      router.push(personId ? `/module/employee-360?person=${encodeURIComponent(personId)}` : "/module/people");
      router.refresh();
    } catch {
      setError("The request could not reach HRBP. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="card record-form-card">
    <div className="record-form-header"><h2>Employee golden record</h2><p>Create identity and employment together, assign a governed position and start the lifecycle ledger in one transaction.</p></div>
    <form className="record-form" onSubmit={submit}>
      <div className="form-field"><label htmlFor="employeeNumber">Employee number</label><input id="employeeNumber" name="employeeNumber" required autoComplete="off" placeholder="E0013"/><span className="form-hint">Unique inside the tenant.</span></div>
      <div className="form-field"><label htmlFor="startDate">Start date</label><input id="startDate" name="startDate" required type="date"/><span className="form-hint">Future dates create a preboarding employment and onboarding plan.</span></div>
      <div className="form-field"><label htmlFor="givenName">Given name</label><input id="givenName" name="givenName" required autoComplete="given-name"/></div>
      <div className="form-field"><label htmlFor="familyName">Family name</label><input id="familyName" name="familyName" required autoComplete="family-name"/></div>
      <div className="form-field full"><label htmlFor="workEmail">Work email</label><input id="workEmail" name="workEmail" required type="email" autoComplete="email" placeholder="employee@company.com"/></div>
      <div className="form-field full"><label htmlFor="positionId">Position</label><select id="positionId" name="positionId" required defaultValue=""><option value="" disabled>Select an available position</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title} · {position.org} · {position.location}</option>)}</select><span className="form-hint">Position and employee remain separate records; assignment fills the selected seat.</span></div>

      {positions.length === 0 ? <div className="form-error">There are no OPEN positions. Create a position before hiring an employee.</div> : null}
      {error ? <div className="form-error">{error}{requiresAuth ? <> <Link href="/auth/sign-in?returnTo=%2Fmodule%2Fpeople%2Fnew">Sign in with enterprise SSO.</Link></> : null}</div> : null}

      <div className="form-actions"><Link className="secondary-button" href="/module/people">Cancel</Link><button className="create-button" type="submit" disabled={submitting || positions.length === 0}><Save size={15}/>{submitting ? "Creating…" : "Create employee"}</button></div>
    </form>
    <div className="governance-note" style={{ margin: "0 20px 20px" }}><ShieldCheck size={17}/><p>The API requires a signed enterprise session, tenant-scoped write permission, same-origin mutation and writes lifecycle + audit evidence atomically with the employee record.</p></div>
  </div>;
}
