"use client";

import { LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PlanningLine = {
  id: string;
  orgUnitId: string;
  positionId: string | null;
  roleLabel: string;
  location: string | null;
  currentFte: number;
  plannedFte: number;
  avgAnnualCost: number | null;
  demandDriver: string | null;
  skillsRequired: string[];
};

type Options = {
  orgUnits: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; positionCode: string; title: string; orgUnitId: string }>;
  relationshipScoped: boolean;
};

type Draft = {
  lineId?: string;
  orgUnitId: string;
  positionId: string;
  roleLabel: string;
  location: string;
  currentFte: string;
  plannedFte: string;
  avgAnnualCost: string;
  demandDriver: string;
  skills: string;
};

const emptyDraft: Draft = {
  orgUnitId: "",
  positionId: "",
  roleLabel: "",
  location: "",
  currentFte: "0",
  plannedFte: "0",
  avgAnnualCost: "",
  demandDriver: "",
  skills: ""
};

export function WorkforcePlanLineManager({
  scenarioId,
  status,
  ownerId,
  actorId,
  canWrite,
  currency,
  lines
}: {
  scenarioId: string;
  status: string;
  ownerId: string;
  actorId: string;
  canWrite: boolean;
  currency: string;
  lines: PlanningLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editable = canWrite && ownerId === actorId && status === "DRAFT";
  const positions = useMemo(
    () => options?.positions.filter((position) => !draft.orgUnitId || position.orgUnitId === draft.orgUnitId) ?? [],
    [options, draft.orgUnitId]
  );
  const orgName = (id: string) => options?.orgUnits.find((org) => org.id === id)?.name ?? id;
  const positionName = (id: string | null) => {
    if (!id) return "—";
    const value = options?.positions.find((position) => position.id === id);
    return value ? `${value.positionCode} · ${value.title}` : id;
  };

  useEffect(() => {
    if (!open || options || loadingOptions) return;
    setLoadingOptions(true);
    fetch("/api/workforce-planning/options", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as { data?: Options; error?: string };
        if (!response.ok || !value.data) throw new Error(value.error || "Options unavailable.");
        setOptions(value.data);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Options unavailable."))
      .finally(() => setLoadingOptions(false));
  }, [open, options, loadingOptions]);

  function edit(line: PlanningLine) {
    setDraft({
      lineId: line.id,
      orgUnitId: line.orgUnitId,
      positionId: line.positionId ?? "",
      roleLabel: line.roleLabel,
      location: line.location ?? "",
      currentFte: String(line.currentFte),
      plannedFte: String(line.plannedFte),
      avgAnnualCost: line.avgAnnualCost === null ? "" : String(line.avgAnnualCost),
      demandDriver: line.demandDriver ?? "",
      skills: line.skillsRequired.join(", ")
    });
    setError(null);
  }

  async function save() {
    if (!editable) return;
    if (!draft.orgUnitId || !draft.roleLabel.trim()) {
      setError("Organization unit and role label are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        orgUnitId: draft.orgUnitId,
        positionId: draft.positionId || null,
        roleLabel: draft.roleLabel.trim(),
        location: draft.location.trim() || null,
        currentFte: Number(draft.currentFte),
        plannedFte: Number(draft.plannedFte),
        avgAnnualCost: draft.avgAnnualCost.trim() ? Number(draft.avgAnnualCost) : null,
        demandDriver: draft.demandDriver.trim() || null,
        skillsRequired: draft.skills.split(",").map((value) => value.trim()).filter(Boolean)
      };
      const path = draft.lineId
        ? `/api/workforce-planning/scenarios/${encodeURIComponent(scenarioId)}/lines/${encodeURIComponent(draft.lineId)}`
        : `/api/workforce-planning/scenarios/${encodeURIComponent(scenarioId)}/lines`;
      const response = await fetch(path, {
        method: draft.lineId ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "x-purpose": "Workforce plan line management" },
        body: JSON.stringify(payload)
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Plan line could not be saved.");
        return;
      }
      setDraft(emptyDraft);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Workforce planning service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(lineId: string) {
    if (!editable || !window.confirm("Delete this draft plan line?")) return;
    setDeleting(lineId);
    setError(null);
    try {
      const response = await fetch(
        `/api/workforce-planning/scenarios/${encodeURIComponent(scenarioId)}/lines/${encodeURIComponent(lineId)}`,
        { method: "DELETE", headers: { "x-purpose": "Workforce plan line management" } }
      );
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Plan line could not be deleted.");
        return;
      }
      if (draft.lineId === lineId) setDraft(emptyDraft);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Workforce planning service could not be reached.");
    } finally {
      setDeleting(null);
    }
  }

  return <div style={{ display: "grid", gap: 7 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
      {open ? <X size={13}/> : <Plus size={13}/>} {open ? "Close lines" : `Manage lines (${lines.length})`}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 9, width: "min(760px, 82vw)", maxWidth: "82vw" }}>
      {loadingOptions ? <span className="matrix-note"><LoaderCircle size={12}/> Loading planning scope…</span> : null}
      {options?.relationshipScoped ? <span className="matrix-note">Relationship-scoped organization and position options</span> : null}

      {lines.length ? <div className="gov-table-wrap"><table className="gov-table">
        <thead><tr><th>Role</th><th>Org</th><th>Position</th><th>FTE</th><th>Cost</th><th>Skills</th><th>Actions</th></tr></thead>
        <tbody>{lines.map((line) => <tr key={line.id}>
          <td><strong>{line.roleLabel}</strong><small className="cell-sub">{line.location || "No location"}{line.demandDriver ? ` · ${line.demandDriver}` : ""}</small></td>
          <td>{orgName(line.orgUnitId)}</td>
          <td>{positionName(line.positionId)}</td>
          <td>{line.currentFte} → {line.plannedFte}</td>
          <td>{line.avgAnnualCost === null ? "—" : `${currency} ${line.avgAnnualCost.toLocaleString("en-US")}`}</td>
          <td>{line.skillsRequired.length ? line.skillsRequired.join(", ") : "—"}</td>
          <td>{editable ? <div className="comp-decision-buttons">
            <button type="button" className="mini-action apply" onClick={() => edit(line)}><Pencil size={12}/> Edit</button>
            <button type="button" className="mini-action reject" disabled={deleting === line.id} onClick={() => void remove(line.id)}>{deleting === line.id ? <LoaderCircle size={12}/> : <Trash2 size={12}/>} Delete</button>
          </div> : <span className="matrix-note">Read only</span>}</td>
        </tr>)}</tbody>
      </table></div> : <span className="matrix-note">No plan lines yet.</span>}

      {editable ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 7 }}>
        <label><small>Organization unit</small><select value={draft.orgUnitId} onChange={(event) => setDraft((value) => ({ ...value, orgUnitId: event.target.value, positionId: "" }))}><option value="">Select…</option>{options?.orgUnits.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <label><small>Position</small><select value={draft.positionId} onChange={(event) => setDraft((value) => ({ ...value, positionId: event.target.value }))}><option value="">Optional</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.positionCode} · {position.title}</option>)}</select></label>
        <label><small>Role label</small><input value={draft.roleLabel} maxLength={160} onChange={(event) => setDraft((value) => ({ ...value, roleLabel: event.target.value }))}/></label>
        <label><small>Location</small><input value={draft.location} maxLength={160} onChange={(event) => setDraft((value) => ({ ...value, location: event.target.value }))}/></label>
        <label><small>Current FTE</small><input type="number" min="0" step="0.01" value={draft.currentFte} onChange={(event) => setDraft((value) => ({ ...value, currentFte: event.target.value }))}/></label>
        <label><small>Planned FTE</small><input type="number" min="0" step="0.01" value={draft.plannedFte} onChange={(event) => setDraft((value) => ({ ...value, plannedFte: event.target.value }))}/></label>
        <label><small>Avg annual cost ({currency})</small><input type="number" min="0" step="0.01" value={draft.avgAnnualCost} onChange={(event) => setDraft((value) => ({ ...value, avgAnnualCost: event.target.value }))}/></label>
        <label><small>Demand driver</small><input value={draft.demandDriver} maxLength={1000} onChange={(event) => setDraft((value) => ({ ...value, demandDriver: event.target.value }))}/></label>
        <label><small>Skills (comma separated)</small><input value={draft.skills} onChange={(event) => setDraft((value) => ({ ...value, skills: event.target.value }))}/></label>
      </div> : <small className="matrix-note">Plan lines become immutable after DRAFT or when you are not the scenario owner.</small>}

      {editable ? <div className="comp-decision-buttons">
        <button type="button" className="mini-action approve" disabled={saving || loadingOptions} onClick={() => void save()}>{saving ? <LoaderCircle size={13}/> : <Save size={13}/>} {draft.lineId ? "Save changes" : "Add line"}</button>
        {draft.lineId ? <button type="button" className="mini-action reject" onClick={() => setDraft(emptyDraft)}><X size={13}/> Cancel edit</button> : null}
      </div> : null}
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
