"use client";

import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type SurveyOption = {
  id: string;
  code: string;
  name: string;
  questions: Array<{ id: string }>;
};

type AudienceOptions = {
  relationshipScoped: boolean;
  orgUnits: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; positionCode: string; title: string; orgUnitId: string }>;
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
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [audience, setAudience] = useState<AudienceOptions | null>(null);
  const [selectedOrgUnits, setSelectedOrgUnits] = useState<Set<string>>(new Set());
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    if (!open || audience || loadingAudience) return;
    setLoadingAudience(true);
    fetch("/api/engagement/audience-options", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as { data?: AudienceOptions; error?: string };
        if (!response.ok || !value.data) throw new Error(value.error || "Audience options unavailable.");
        setAudience(value.data);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Audience options unavailable."))
      .finally(() => setLoadingAudience(false));
  }, [open, audience, loadingAudience]);

  if (!canWrite) return null;

  function toggleOrg(id: string) {
    setSelectedOrgUnits((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePosition(id: string) {
    setSelectedPositions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          closesAt: toIso(form.closesAt),
          audienceFilter: selectedOrgUnits.size || selectedPositions.size ? {
            orgUnitIds: [...selectedOrgUnits],
            positionIds: [...selectedPositions]
          } : undefined
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
      setSelectedOrgUnits(new Set());
      setSelectedPositions(new Set());
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
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 8, width: "min(760px, 82vw)", maxWidth: "82vw" }}>
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

      <div className="card" style={{ padding: 8, display: "grid", gap: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>Audience</strong>
          <span className="matrix-note">{audience?.relationshipScoped ? "Relationship scoped" : "Tenant authorized"} · blank = full authorized scope</span>
        </div>
        {loadingAudience ? <span className="matrix-note"><LoaderCircle size={12}/> Loading audience options…</span> : null}
        {audience ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          <div><small>Organization units</small><div style={{ display: "grid", gap: 4, maxHeight: 150, overflow: "auto" }}>
            {audience.orgUnits.map((org) => <label key={org.id}><small><input type="checkbox" checked={selectedOrgUnits.has(org.id)} onChange={() => toggleOrg(org.id)}/> {org.name}</small></label>)}
          </div></div>
          <div><small>Positions</small><div style={{ display: "grid", gap: 4, maxHeight: 150, overflow: "auto" }}>
            {audience.positions.map((position) => <label key={position.id}><small><input type="checkbox" checked={selectedPositions.has(position.id)} onChange={() => togglePosition(position.id)}/> {position.positionCode} · {position.title}</small></label>)}
          </div></div>
        </div> : null}
      </div>

      <button type="button" className="mini-action approve" disabled={saving || !eligibleSurveys.length || loadingAudience} onClick={() => void create()}>
        {saving ? <LoaderCircle size={13}/> : <Save size={13}/>} Create draft campaign
      </button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
