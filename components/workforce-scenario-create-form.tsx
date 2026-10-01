"use client";

import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function WorkforceScenarioCreateForm({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    baseDate: new Date().toISOString().slice(0, 10),
    horizonMonths: "12",
    currency: "USD"
  });

  if (!canWrite) return null;

  async function create() {
    if (!form.code.trim() || !form.name.trim() || !form.baseDate || !form.currency.trim()) {
      setError("Code, name, base date and currency are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/workforce-planning/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Workforce scenario creation" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          baseDate: form.baseDate,
          horizonMonths: Number(form.horizonMonths),
          currency: form.currency.trim()
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Scenario could not be created.");
        return;
      }
      setForm({
        code: "",
        name: "",
        description: "",
        baseDate: new Date().toISOString().slice(0, 10),
        horizonMonths: "12",
        currency: "USD"
      });
      setOpen(false);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Workforce planning service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={{ display: "grid", gap: 7 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
      {open ? <X size={13}/> : <Plus size={13}/>} {open ? "Close" : "New scenario"}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 8, minWidth: 340 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7 }}>
        <label><small>Code</small><input value={form.code} maxLength={40} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))}/></label>
        <label><small>Name</small><input value={form.name} maxLength={160} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}/></label>
        <label><small>Base date</small><input type="date" value={form.baseDate} onChange={(event) => setForm((value) => ({ ...value, baseDate: event.target.value }))}/></label>
        <label><small>Horizon (months)</small><input type="number" min="1" max="120" value={form.horizonMonths} onChange={(event) => setForm((value) => ({ ...value, horizonMonths: event.target.value }))}/></label>
        <label><small>Currency</small><input value={form.currency} maxLength={3} onChange={(event) => setForm((value) => ({ ...value, currency: event.target.value.toUpperCase() }))}/></label>
        <label style={{ gridColumn: "1 / -1" }}><small>Description</small><textarea value={form.description} maxLength={2000} rows={3} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}/></label>
      </div>
      <button type="button" className="mini-action approve" disabled={saving} onClick={() => void create()}>
        {saving ? <LoaderCircle size={13}/> : <Save size={13}/>} Create draft
      </button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
