"use client";

import { useRouter } from "next/navigation";
import { BadgeDollarSign, Save, UserCog } from "lucide-react";
import { FormEvent, useState } from "react";

export type ManagerOption = {
  employmentId: string;
  name: string;
  position: string;
};

function Feedback({ state }: { state: { type: "success" | "error"; message: string } | null }) {
  if (!state) return null;
  return <div className={state.type === "success" ? "employee-action-success" : "form-error"}>{state.message}</div>;
}

export function ManagerAssignmentForm({ personId, currentManagerEmploymentId, managers }: { personId: string; currentManagerEmploymentId?: string; managers: ManagerOption[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    const managerEmploymentId = String(form.get("managerEmploymentId") ?? "");

    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/manager`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Manager relationship administration" },
        body: JSON.stringify({ managerEmploymentId: managerEmploymentId || null })
      });
      const value = await response.json() as { error?: string; data?: { managerName?: string | null } };
      if (!response.ok) {
        setFeedback({ type: "error", message: value.error || "Manager assignment could not be changed." });
        return;
      }
      setFeedback({ type: "success", message: value.data?.managerName ? `Manager changed to ${value.data.managerName}.` : "Manager assignment cleared." });
      router.refresh();
    } catch {
      setFeedback({ type: "error", message: "The request could not reach HRBP." });
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="card employee-action-card">
    <div className="table-title"><div><h3>Manager relationship</h3><p>Change the effective reporting relationship with cycle prevention and audit evidence.</p></div><UserCog size={18}/></div>
    <form className="employee-action-form" onSubmit={submit}>
      <div className="form-field full"><label htmlFor="managerEmploymentId">Manager</label><select id="managerEmploymentId" name="managerEmploymentId" defaultValue={currentManagerEmploymentId ?? ""}><option value="">No manager</option>{managers.map((manager) => <option key={manager.employmentId} value={manager.employmentId}>{manager.name} · {manager.position}</option>)}</select></div>
      <Feedback state={feedback}/>
      <div className="form-actions"><button className="create-button" type="submit" disabled={submitting}><Save size={15}/>{submitting ? "Saving…" : "Update manager"}</button></div>
    </form>
  </div>;
}

export function CompensationRequestForm({ personId, currency = "EUR" }: { personId: string; currency?: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      currency: String(form.get("currency") ?? "").trim().toUpperCase(),
      proposedAnnualBase: String(form.get("proposedAnnualBase") ?? "").trim(),
      effectiveDate: String(form.get("effectiveDate") ?? "").trim(),
      reason: String(form.get("reason") ?? "").trim()
    };

    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/compensation`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Compensation review" },
        body: JSON.stringify(payload)
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: value.error || "Compensation request could not be created." });
        return;
      }
      setFeedback({ type: "success", message: "Compensation change request created and routed to approval." });
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setFeedback({ type: "error", message: "The request could not reach HRBP." });
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="card employee-action-card">
    <div className="table-title"><div><h3>Request compensation change</h3><p>Create a restricted, approval-bound change request. Salary history is not overwritten.</p></div><BadgeDollarSign size={18}/></div>
    <form className="employee-action-form" onSubmit={submit}>
      <div className="form-field"><label htmlFor="currency">Currency</label><input id="currency" name="currency" defaultValue={currency} maxLength={3} required/></div>
      <div className="form-field"><label htmlFor="effectiveDate">Effective date</label><input id="effectiveDate" name="effectiveDate" type="date" required/></div>
      <div className="form-field full"><label htmlFor="proposedAnnualBase">Proposed annual base</label><input id="proposedAnnualBase" name="proposedAnnualBase" type="number" min="0.01" step="0.01" required placeholder="75000"/></div>
      <div className="form-field full"><label htmlFor="reason">Business reason</label><textarea id="reason" name="reason" rows={3} maxLength={500} placeholder="Annual review, promotion, market adjustment…"/></div>
      <Feedback state={feedback}/>
      <div className="form-actions"><button className="create-button" type="submit" disabled={submitting}><Save size={15}/>{submitting ? "Submitting…" : "Submit for approval"}</button></div>
    </form>
  </div>;
}
