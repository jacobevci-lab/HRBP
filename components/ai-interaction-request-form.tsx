"use client";

import { Bot, LoaderCircle, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AIInteractionRequestForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    module: "ai-assistant",
    purpose: "",
    classification: "INTERNAL",
    prompt: "",
    restrictedDataAccess: false
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!form.prompt.trim() || !form.module.trim() || !form.purpose.trim()) {
      setError("Prompt, module and purpose are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ai/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": form.purpose.trim() },
        body: JSON.stringify({
          prompt: form.prompt.trim(),
          module: form.module.trim(),
          purpose: form.purpose.trim(),
          classification: form.classification,
          restrictedDataAccess: form.restrictedDataAccess
        })
      });
      const value = await response.json() as { data?: { id: string; status: string }; error?: string };
      if (!response.ok || !value.data) {
        setError(value.error || "AI request could not be submitted.");
        return;
      }
      setMessage(`Request accepted · ${value.data.status}`);
      setForm((current) => ({ ...current, prompt: "" }));
      router.refresh();
    } catch {
      setError("AI request service could not be reached.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div style={{ display: "grid", gap: 7 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
      {open ? <X size={13}/> : <Bot size={13}/>} {open ? "Close request" : "New AI request"}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 8, width: "min(680px, 82vw)", maxWidth: "82vw" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <label><small>Module</small><input maxLength={80} value={form.module} onChange={(event) => setForm((value) => ({ ...value, module: event.target.value }))}/></label>
        <label><small>Classification</small><select value={form.classification} onChange={(event) => setForm((value) => ({ ...value, classification: event.target.value }))}>
          <option value="INTERNAL">Internal</option>
          <option value="CONFIDENTIAL">Confidential</option>
          <option value="RESTRICTED">Restricted</option>
        </select></label>
        <label style={{ gridColumn: "1 / -1" }}><small>Business purpose</small><input maxLength={240} value={form.purpose} onChange={(event) => setForm((value) => ({ ...value, purpose: event.target.value }))}/></label>
        <label style={{ gridColumn: "1 / -1" }}><small>Prompt</small><textarea rows={5} maxLength={12000} value={form.prompt} onChange={(event) => setForm((value) => ({ ...value, prompt: event.target.value }))}/></label>
      </div>
      <label><small><input type="checkbox" checked={form.restrictedDataAccess} onChange={(event) => setForm((value) => ({ ...value, restrictedDataAccess: event.target.checked }))}/> Request may require restricted-data access</small></label>
      <small className="matrix-note">Raw prompts and raw responses are not retained in the operational AI ledger. Highly restricted data is rejected.</small>
      <button type="button" className="mini-action approve" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <LoaderCircle size={13}/> : <Send size={13}/>} Submit governed request
      </button>
      {message ? <small className="matrix-note">{message}</small> : null}
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
