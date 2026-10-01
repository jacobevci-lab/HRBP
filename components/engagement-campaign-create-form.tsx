"use client";

import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type SurveyOption = {
  id: string;
  code: string;
  name: string;
  questions: Array<{ id: string }>;
};

function toIso(value: string) {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

export function EngagementCampaignCreateForm({
  surveys,
  canWrite
}: {
  surveys: SurveyOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleSurveys = useMemo(() => surveys.filter((survey) => survey.questions.length > 0), [surveys]);
  const [form, setForm] = useState({
    surveyId: eligibleSurveys[0]?.id ?? "",
    name: "",
    anonymous: true,
    anonymityThreshold: "7",
    opensAt: "",
    closesAt: ""
  });

  if (!canWrite) return null;

  async function create() {
    if (!form.surveyId || !form.name.trim()) {
      setError("Survey and campaign name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/engagement/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Engagement campaign creation" },
        body: JSON.stringify({
          surveyId: form.surveyId,
          name: form.name.trim(),
          anonymous: form.anonymous,
          anonymityThreshold: Number(form.anonymityThreshold),
          opensAt: toIso(form.opensAt),
          closesAt: toIso(form.closesAt)
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Campaign could not be created.");
        return;
      }
      setForm((value) => ({
        surveyId: value.surveyId,
        name: "",
        anonymous: true,
        anonymityThreshold: "7",
        opensAt: "",
        closesAt: ""
      }));
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
      setOpen(false);
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  return <div style={{ display: "grid", gap: 7 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
      {open ? <X size={13}/> : <Plus size={13}/>} {open ? "Close campaign form" : "New campaign"}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 8, width: "min(620px, 80vw)", maxWidth: "80vw" }}>
      <label><small>Survey</small><select value={form.surveyId} onChange={(event) => setForm((value) => ({ ...value, surveyId: event.target.value }))}>
        <option value="">Select authored survey…</option>
        {eligibleSurveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.code} · {survey.name}</option>)}
      </select></label>
      {!eligibleSurveys.length ? <small className="comp-decision-error">Create a survey with at least one question before creating a campaign.</small> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7 }}>
        <label><small>Campaign name</small><input maxLength={160} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}/></label>
        <label><small>Anonymity threshold</small><input type="number" min="5" max="1000" value={form.anonymityThreshold} onChange={(event) => setForm((value) => ({ ...value, anonymityThreshold: event.target.value }))}/></label>
        <label><small>Opens at</small><input type="datetime-local" value={form.opensAt} onChange={(event) => setForm((value) => ({ ...value, opensAt: event.target.value }))}/></label>
        <label><small>Closes at</small><input type="datetime-local" value={form.closesAt} onChange={(event) => setForm((value) => ({ ...value, closesAt: event.target.value }))}/></label>
      </div>
      <label><small><input type="checkbox" checked={form.anonymous} onChange={(event) => setForm((value) => ({ ...value, anonymous: event.target.checked }))}/> Anonymous campaign</small></label>
      <button type="button" className="mini-action approve" disabled={saving || !eligibleSurveys.length} onClick={() => void create()}>
        {saving ? <LoaderCircle size={13}/> : <Save size={13}/>} Create draft campaign
      </button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
