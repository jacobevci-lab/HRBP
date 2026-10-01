"use client";

import { CheckCircle2, LoaderCircle, PauseCircle, PlayCircle, Plus, RotateCcw, Save, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PrivacyAssessmentCreateForm({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", riskLevel: "MEDIUM", requiresDpia: false, dueAt: "" });

  if (!canWrite) return null;

  async function create() {
    if (!form.name.trim() || !form.riskLevel.trim()) {
      setError("Name and risk level are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/privacy/assessments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Privacy assurance assessment" },
        body: JSON.stringify({
          name: form.name.trim(),
          riskLevel: form.riskLevel.trim(),
          requiresDpia: form.requiresDpia,
          dueAt: form.dueAt ? new Date(`${form.dueAt}T23:59:59.000Z`).toISOString() : undefined
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Assessment could not be created.");
        return;
      }
      setForm({ name: "", riskLevel: "MEDIUM", requiresDpia: false, dueAt: "" });
      setOpen(false);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Privacy service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={{display:"grid",gap:6}}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>{open ? <X size={12}/> : <Plus size={12}/>} {open ? "Close" : "New assessment"}</button>
    {open ? <div className="card" style={{padding:9,display:"grid",gap:7,width:"min(520px,78vw)",maxWidth:"78vw"}}>
      <label><small>Name</small><input maxLength={180} value={form.name} onChange={(event) => setForm((value) => ({...value,name:event.target.value}))}/></label>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
        <label><small>Risk level</small><input maxLength={40} value={form.riskLevel} onChange={(event) => setForm((value) => ({...value,riskLevel:event.target.value}))}/></label>
        <label><small>Due date</small><input type="date" value={form.dueAt} onChange={(event) => setForm((value) => ({...value,dueAt:event.target.value}))}/></label>
      </div>
      <label><small><input type="checkbox" checked={form.requiresDpia} onChange={(event) => setForm((value) => ({...value,requiresDpia:event.target.checked}))}/> DPIA required</small></label>
      <button type="button" className="mini-action approve" disabled={saving} onClick={() => void create()}>{saving ? <LoaderCircle size={12}/> : <Save size={12}/>} Create assessment</button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}

export function PrivacyAssessmentActions({
  assessmentId,
  status,
  ownerId,
  actorId,
  canWrite
}: {
  assessmentId: string;
  status: string;
  ownerId: string;
  actorId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [openComplete, setOpenComplete] = useState(false);
  const [summary, setSummary] = useState("");
  const [mitigations, setMitigations] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminal = ["COMPLETED","CLOSED"].includes(status.toUpperCase());
  const editable = canWrite && ownerId === actorId;

  async function act(action: "START" | "WAIT" | "COMPLETE" | "REOPEN") {
    if (!editable) return;
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/privacy/assessments/${encodeURIComponent(assessmentId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Privacy assurance lifecycle" },
        body: JSON.stringify({
          action,
          ...(action === "COMPLETE" ? {
            summary: summary.trim(),
            mitigations: mitigations.split(",").map((value) => value.trim()).filter(Boolean)
          } : {})
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Assessment transition failed.");
        return;
      }
      setOpenComplete(false);
      setSummary("");
      setMitigations("");
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Privacy service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  if (!editable) return <span className="matrix-note">Owner only</span>;

  return <div style={{display:"grid",gap:5}}>
    <div className="comp-decision-buttons">
      {!terminal ? <><button type="button" className="mini-action apply" disabled={Boolean(busy)} onClick={() => void act("START")}><PlayCircle size={12}/> Start</button><button type="button" className="mini-action apply" disabled={Boolean(busy)} onClick={() => void act("WAIT")}><PauseCircle size={12}/> Wait</button><button type="button" className="mini-action approve" disabled={Boolean(busy)} onClick={() => setOpenComplete((value) => !value)}><CheckCircle2 size={12}/> Complete</button></> : <button type="button" className="mini-action apply" disabled={Boolean(busy)} onClick={() => void act("REOPEN")}><RotateCcw size={12}/> Reopen</button>}
    </div>
    {openComplete ? <div className="card" style={{padding:8,display:"grid",gap:6,minWidth:320}}>
      <label><small>Findings summary</small><textarea rows={3} maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)}/></label>
      <label><small>Mitigations (comma separated)</small><input value={mitigations} onChange={(event) => setMitigations(event.target.value)}/></label>
      <button type="button" className="mini-action approve" disabled={busy === "COMPLETE" || !summary.trim()} onClick={() => void act("COMPLETE")}><ShieldCheck size={12}/> Confirm completion</button>
    </div> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}

export function PrivacyTransferCreateForm({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", sourceCountry: "", destinationCountry: "", recipient: "", purpose: "",
    mechanism: "SCC", safeguardReference: "", dataCategories: "", dueAt: ""
  });

  if (!canWrite) return null;

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/privacy/transfers", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Cross-border transfer assurance" },
        body: JSON.stringify({
          name: form.name.trim(),
          sourceCountry: form.sourceCountry.trim(),
          destinationCountry: form.destinationCountry.trim(),
          recipient: form.recipient.trim(),
          purpose: form.purpose.trim(),
          mechanism: form.mechanism,
          safeguardReference: form.safeguardReference.trim() || undefined,
          dataCategories: form.dataCategories.split(",").map((value) => value.trim()).filter(Boolean),
          transferImpactDueAt: form.dueAt ? new Date(`${form.dueAt}T23:59:59.000Z`).toISOString() : undefined
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Transfer record could not be created.");
        return;
      }
      setForm({name:"",sourceCountry:"",destinationCountry:"",recipient:"",purpose:"",mechanism:"SCC",safeguardReference:"",dataCategories:"",dueAt:""});
      setOpen(false);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Privacy service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={{display:"grid",gap:6}}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>{open ? <X size={12}/> : <Plus size={12}/>} {open ? "Close" : "New transfer"}</button>
    {open ? <div className="card" style={{padding:9,display:"grid",gap:7,width:"min(620px,80vw)",maxWidth:"80vw"}}>
      <label><small>Name</small><input maxLength={180} value={form.name} onChange={(event) => setForm((value) => ({...value,name:event.target.value}))}/></label>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
        <label><small>Source country</small><input maxLength={80} value={form.sourceCountry} onChange={(event) => setForm((value) => ({...value,sourceCountry:event.target.value}))}/></label>
        <label><small>Destination country</small><input maxLength={80} value={form.destinationCountry} onChange={(event) => setForm((value) => ({...value,destinationCountry:event.target.value}))}/></label>
        <label><small>Recipient</small><input maxLength={240} value={form.recipient} onChange={(event) => setForm((value) => ({...value,recipient:event.target.value}))}/></label>
        <label><small>Mechanism</small><select value={form.mechanism} onChange={(event) => setForm((value) => ({...value,mechanism:event.target.value}))}><option value="ADEQUACY">Adequacy</option><option value="SCC">SCC</option><option value="BCR">BCR</option><option value="DEROGATION">Derogation</option><option value="LOCAL">Local</option></select></label>
      </div>
      <label><small>Purpose</small><textarea rows={2} maxLength={1000} value={form.purpose} onChange={(event) => setForm((value) => ({...value,purpose:event.target.value}))}/></label>
      <label><small>Data categories (comma separated)</small><input value={form.dataCategories} onChange={(event) => setForm((value) => ({...value,dataCategories:event.target.value}))}/></label>
      <label><small>Safeguard reference</small><input maxLength={1000} value={form.safeguardReference} onChange={(event) => setForm((value) => ({...value,safeguardReference:event.target.value}))}/></label>
      <label><small>TIA review due</small><input type="date" value={form.dueAt} onChange={(event) => setForm((value) => ({...value,dueAt:event.target.value}))}/></label>
      <button type="button" className="mini-action approve" disabled={saving} onClick={() => void create()}>{saving ? <LoaderCircle size={12}/> : <Save size={12}/>} Create transfer</button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}

export function PrivacyTransferActions({
  transferId,
  active,
  canWrite
}: {
  transferId: string;
  active: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [nextDueAt, setNextDueAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return <span className="matrix-note">Read only</span>;

  async function act(action: "SCHEDULE_REVIEW" | "COMPLETE_REVIEW" | "DEACTIVATE" | "REACTIVATE") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/privacy/transfers/${encodeURIComponent(transferId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Transfer impact assurance" },
        body: JSON.stringify({
          action,
          nextDueAt: nextDueAt ? new Date(`${nextDueAt}T23:59:59.000Z`).toISOString() : undefined
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Transfer transition failed.");
        return;
      }
      setNextDueAt("");
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Privacy service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  return <div style={{display:"grid",gap:5}}>
    <input type="date" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} aria-label="Next TIA due date"/>
    <div className="comp-decision-buttons">
      {active ? <><button type="button" className="mini-action apply" disabled={Boolean(busy) || !nextDueAt} onClick={() => void act("SCHEDULE_REVIEW")}><Save size={12}/> Schedule</button><button type="button" className="mini-action approve" disabled={Boolean(busy)} onClick={() => void act("COMPLETE_REVIEW")}><CheckCircle2 size={12}/> Complete review</button><button type="button" className="mini-action reject" disabled={Boolean(busy)} onClick={() => void act("DEACTIVATE")}><PauseCircle size={12}/> Deactivate</button></> : <button type="button" className="mini-action approve" disabled={Boolean(busy) || !nextDueAt} onClick={() => void act("REACTIVATE")}><RotateCcw size={12}/> Reactivate</button>}
    </div>
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
