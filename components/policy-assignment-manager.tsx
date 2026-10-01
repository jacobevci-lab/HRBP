"use client";

import { CheckCircle2, LoaderCircle, Search, Send, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type EmploymentOption = {
  id: string;
  employeeNumber: string | null;
  name: string;
  position: string;
  organization: string;
  assigned: boolean;
  assignmentStatus: string | null;
  dueAt: string | null;
};

type AssignmentOptions = {
  relationshipScoped: boolean;
  employments: EmploymentOption[];
};

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

export function PolicyAssignmentManager({
  policyId,
  canWrite
}: {
  policyId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AssignmentOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options?.employments ?? [];
    return (options?.employments ?? []).filter((employment) =>
      [employment.name, employment.employeeNumber ?? "", employment.position, employment.organization]
        .some((value) => value.toLowerCase().includes(q))
    );
  }, [options, query]);

  async function load() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/assignment-options`, { cache: "no-store" });
      const value = await response.json() as { data?: AssignmentOptions; error?: string };
      if (!response.ok || !value.data) throw new Error(value.error || "Assignment options unavailable.");
      setOptions(value.data);
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assignment options unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    setMessage(null);
    setError(null);
    if (next && !options) await load();
  }

  function toggleEmployment(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const employment of visible) if (!employment.assigned) next.add(employment.id);
      return next;
    });
  }

  async function assign() {
    if (!selected.size) {
      setError("Select at least one employee.");
      return;
    }
    setAssigning(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Policy assignment governance" },
        body: JSON.stringify({
          employmentIds: [...selected],
          dueAt: dueAt ? new Date(`${dueAt}T23:59:59.000Z`).toISOString() : undefined
        })
      });
      const value = await response.json() as {
        data?: { assigned: number; requested: number; skippedExisting: number };
        error?: string;
      };
      if (!response.ok || !value.data) {
        setError(value.error || "Policy assignment failed.");
        return;
      }
      setMessage(`${value.data.assigned} new assignment(s) created${value.data.skippedExisting ? `; ${value.data.skippedExisting} existing skipped` : ""}.`);
      setOptions(null);
      setSelected(new Set());
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
      await load();
    } catch {
      setError("Policy assignment service could not be reached.");
    } finally {
      setAssigning(false);
    }
  }

  if (!canWrite) return null;

  return <div style={{ display: "grid", gap: 7, minWidth: 260 }}>
    <button type="button" className="secondary-button" onClick={() => void toggleOpen()}>
      {open ? <X size={13}/> : <UsersRound size={13}/>} {open ? "Close assignments" : "Assign policy"}
    </button>

    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 8, width: "min(760px, 82vw)", maxWidth: "82vw" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span className="matrix-note">
          {options?.relationshipScoped ? "Relationship-scoped employees" : "Tenant-authorized employees"}
        </span>
        <button type="button" className="mini-action apply" disabled={loading} onClick={() => void load()}>
          {loading ? <LoaderCircle size={12}/> : <Search size={12}/>} Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 7 }}>
        <input placeholder="Search employee, number, role or organization…" value={query} onChange={(event) => setQuery(event.target.value)}/>
        <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/>
        <button type="button" className="mini-action apply" onClick={selectVisible}>Select visible</button>
      </div>

      <div className="gov-table-wrap" style={{ maxHeight: 320 }}>
        <table className="gov-table">
          <thead><tr><th></th><th>Employee</th><th>Position</th><th>Organization</th><th>Status</th></tr></thead>
          <tbody>{visible.length ? visible.map((employment) => <tr key={employment.id}>
            <td><input type="checkbox" disabled={employment.assigned} checked={employment.assigned || selected.has(employment.id)} onChange={() => toggleEmployment(employment.id)}/></td>
            <td><strong>{employment.name}</strong><small className="cell-sub">{employment.employeeNumber || "No employee number"}</small></td>
            <td>{employment.position}</td>
            <td>{employment.organization}</td>
            <td>{employment.assigned ? <span className="matrix-note"><CheckCircle2 size={11}/> {employment.assignmentStatus ?? "Assigned"}</span> : "Available"}</td>
          </tr>) : <tr><td colSpan={5} style={{ textAlign: "center", padding: 18 }}>No employees match this scope/filter.</td></tr>}</tbody>
        </table>
      </div>

      <button type="button" className="mini-action approve" disabled={assigning || !selected.size} onClick={() => void assign()}>
        {assigning ? <LoaderCircle size={13}/> : <Send size={13}/>} Assign selected ({selected.size})
      </button>
      {message ? <small className="matrix-note">{message}</small> : null}
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
