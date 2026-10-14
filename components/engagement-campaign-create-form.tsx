"use client";

import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useLocale } from "@/components/locale-provider";
import { authoringError, authoringText } from "@/lib/engagement-authoring-copy";
import styles from "@/components/engagement-authoring.module.css";

type SurveyOption = { id: string; code: string; name: string; questions: Array<{ id: string }> };
type AudienceOptions = { relationshipScoped: boolean; orgUnits: Array<{ id: string; name: string }>; positions: Array<{ id: string; positionCode: string; title: string; orgUnitId: string }> };
function validAudience(value: unknown): value is AudienceOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as AudienceOptions;
  return typeof data.relationshipScoped === "boolean" && Array.isArray(data.orgUnits) && Array.isArray(data.positions) &&
    data.orgUnits.every(row => row && typeof row.id === "string" && row.id && typeof row.name === "string") &&
    data.positions.every(row => row && typeof row.id === "string" && row.id && typeof row.positionCode === "string" && typeof row.title === "string" && typeof row.orgUnitId === "string");
}
const unknownResult = "The result could not be confirmed. Reload current records before trying another change.";

export function EngagementCampaignCreateForm({ surveys, canWrite }: { surveys: SurveyOption[]; canWrite: boolean }) {
  const router = useRouter(); const { locale } = useLocale();
  const c = (text: string) => authoringText(locale, text);
  const panelId = useId(), gate = useRef(false);
  const [refreshing, startTransition] = useTransition();
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [uncertain, setUncertain] = useState(false);
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [audience, setAudience] = useState<AudienceOptions | null>(null);
  const [audienceError, setAudienceError] = useState(false), [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedOrgUnits, setSelectedOrgUnits] = useState<Set<string>>(new Set());
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const eligibleSurveys = useMemo(() => surveys.filter(survey => survey.questions.length > 0), [surveys]);
  const [form, setForm] = useState({ surveyId: eligibleSurveys[0]?.id ?? "", name: "", anonymous: true, anonymityThreshold: "7", opensAt: "", closesAt: "" });
  const busy = saving || refreshing || uncertain;

  useEffect(() => {
    if (!open || !canWrite) return;
    // Loading state must NOT be an effect dependency: failures previously
    // flipped it false and started another request without a user action.
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    setLoadingAudience(true); setAudienceError(false); setAudience(null);
    fetch("/api/engagement/audience-options", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json() as { data?: unknown; error?: unknown };
        if (response.status !== 200 || value?.error || !validAudience(value?.data)) throw new Error("AUDIENCE_UNAVAILABLE");
        if (active) setAudience(value.data);
      })
      .catch(() => { if (active) setAudienceError(true); })
      .finally(() => { clearTimeout(timer); if (active) setLoadingAudience(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [open, canWrite, loadAttempt]);

  function toggleOrg(id: string) { setSelectedOrgUnits(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function togglePosition(id: string) { setSelectedPositions(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function create() {
    if (!canWrite || busy || gate.current || loadingAudience || !audience) return;
    if (!eligibleSurveys.some(survey => survey.id === form.surveyId) || !form.name.trim()) { setError("Survey and campaign name are required."); return; }
    const threshold = Number(form.anonymityThreshold);
    if (!Number.isInteger(threshold) || threshold < 5 || threshold > 1000) { setError("Anonymity threshold must be an integer between 5 and 1000."); return; }
    const opensAt = form.opensAt ? new Date(form.opensAt) : undefined, closesAt = form.closesAt ? new Date(form.closesAt) : undefined;
    if ((opensAt && !Number.isFinite(+opensAt)) || (closesAt && !Number.isFinite(+closesAt))) { setError("Enter valid campaign dates."); return; }
    if (opensAt && closesAt && closesAt <= opensAt) { setError("The campaign closing time must be after its opening time."); return; }
    gate.current = true; setSaving(true); setError(null);
    try {
      const response = await fetch("/api/engagement/campaigns", {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", "x-purpose": "Engagement campaign creation" },
        body: JSON.stringify({ surveyId: form.surveyId, name: form.name.trim(), anonymous: form.anonymous, anonymityThreshold: threshold,
          opensAt: opensAt?.toISOString(), closesAt: closesAt?.toISOString(),
          audienceFilter: selectedOrgUnits.size || selectedPositions.size ? { orgUnitIds: [...selectedOrgUnits], positionIds: [...selectedPositions] } : undefined })
      });
      const value = await response.json() as { data?: { id?: string; surveyId?: string; status?: string }; error?: unknown };
      if (response.status >= 400 && response.status < 500 && typeof value?.error === "string") { setError(authoringError(response.status, "Campaign could not be created.", value.error)); return; }
      if (response.status !== 201 || !value?.data?.id || value.data.surveyId !== form.surveyId || value.data.status !== "DRAFT" || value.error) { setUncertain(true); setError(unknownResult); return; }
      setForm(value => ({ surveyId: value.surveyId, name: "", anonymous: true, anonymityThreshold: "7", opensAt: "", closesAt: "" }));
      setSelectedOrgUnits(new Set()); setSelectedPositions(new Set());
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      startTransition(() => router.refresh()); setOpen(false);
    } catch { setUncertain(true); setError(unknownResult); }
    finally { gate.current = false; setSaving(false); }
  }
  if (!canWrite) return null;
  return <div className={styles.root} data-engagement-campaign-create>
    <button type="button" className="secondary-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{open ? <X size={13}/> : <Plus size={13}/>} {c(open ? "Close campaign form" : "New campaign")}</button>
    {open ? <div id={panelId} className={`card ${styles.panel}`}>
      <fieldset className={styles.fields} disabled={busy} aria-busy={saving || refreshing}>
        <label><small>{c("Survey")}</small><select aria-label={c("Survey")} value={form.surveyId} onChange={event => setForm(value => ({ ...value, surveyId: event.target.value }))}>
          <option value="">{c("Select authored survey…")}</option>{eligibleSurveys.map(survey => <option key={survey.id} value={survey.id}>{survey.code} · {survey.name}</option>)}
        </select></label>
        {!eligibleSurveys.length ? <small className="comp-decision-error">{c("Create a survey with at least one question before creating a campaign.")}</small> : null}
        <div className={styles.grid}>
          <label><small>{c("Campaign name")}</small><input maxLength={160} value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))}/></label>
          <label><small>{c("Anonymity threshold")}</small><input type="number" min="5" max="1000" step="1" value={form.anonymityThreshold} onChange={event => setForm(value => ({ ...value, anonymityThreshold: event.target.value }))}/></label>
          <label><small>{c("Opens at")}</small><input type="datetime-local" value={form.opensAt} onChange={event => setForm(value => ({ ...value, opensAt: event.target.value }))}/></label>
          <label><small>{c("Closes at")}</small><input type="datetime-local" value={form.closesAt} onChange={event => setForm(value => ({ ...value, closesAt: event.target.value }))}/></label>
        </div>
        <label className={styles.check}><input type="checkbox" checked={form.anonymous} onChange={event => setForm(value => ({ ...value, anonymous: event.target.checked }))}/><small>{c("Anonymous campaign")}</small></label>
        <div className={`card ${styles.box}`}>
          <div className={styles.header}><strong>{c("Audience")}</strong><span className="matrix-note">{audience ? <>{c(audience.relationshipScoped ? "Relationship scoped" : "Tenant authorized")} · {c("blank = full authorized scope")}</> : c("Scope not loaded")}</span></div>
          {loadingAudience ? <span className="matrix-note" role="status"><LoaderCircle size={12}/>{c("Loading audience options…")}</span> : null}
          {audience ? <div className={styles.grid}>
            <div><small>{c("Organization units")}</small><div className={styles.choices}>{audience.orgUnits.map(org => <label className={styles.check} key={org.id}><input type="checkbox" checked={selectedOrgUnits.has(org.id)} onChange={() => toggleOrg(org.id)}/><small>{org.name}</small></label>)}</div></div>
            <div><small>{c("Positions")}</small><div className={styles.choices}>{audience.positions.map(position => <label className={styles.check} key={position.id}><input type="checkbox" checked={selectedPositions.has(position.id)} onChange={() => togglePosition(position.id)}/><small>{position.positionCode} · {position.title}</small></label>)}</div></div>
          </div> : null}
          {audienceError ? <div className={styles.error} role="alert"><span>{c("Audience options could not be loaded. Retry explicitly to continue.")}</span><button type="button" className="secondary-button" disabled={loadingAudience} onClick={() => setLoadAttempt(value => value + 1)}>{c("Retry audience loading")}</button></div> : null}
        </div>
        <button type="button" className="mini-action approve" disabled={!eligibleSurveys.length || loadingAudience || !audience} onClick={() => void create()}>{saving ? <LoaderCircle size={13}/> : <Save size={13}/>} {c("Create draft campaign")}</button>
      </fieldset>
      {error ? <div className={`comp-decision-error ${styles.error}`} role="alert">{c(error)}{uncertain ? <button type="button" className="secondary-button" onClick={() => window.location.reload()}>{c("Reload current records")}</button> : null}</div> : null}
    </div> : null}
  </div>;
}
