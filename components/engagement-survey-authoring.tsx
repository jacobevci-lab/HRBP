"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { useLocale } from "@/components/locale-provider";
import { authoringError, authoringText } from "@/lib/engagement-authoring-copy";
import styles from "@/components/engagement-authoring.module.css";

type Question = { id: string; questionKey: string; prompt: string; type: string; required: boolean; orderIndex: number; options: string[]; dimension: string | null };
type Survey = { id: string; code: string; name: string; description: string | null; createdById: string; editable: boolean; campaignCount: number; questions: Question[] };
type QuestionDraft = { questionId?: string; questionKey: string; prompt: string; type: string; required: boolean; dimension: string; options: string };
const emptyQuestion: QuestionDraft = { questionKey: "", prompt: "", type: "SCALE", required: true, dimension: "", options: "" };
const unknownResult = "The result could not be confirmed. Reload current records before trying another change.";

export function EngagementSurveyAuthoring({ surveys, canWrite }: { surveys: Survey[]; canWrite: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (text: string) => authoringText(locale, text);
  const panelId = useId();
  const gate = useRef(false);
  const [refreshing, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [surveyForm, setSurveyForm] = useState({ code: "", name: "", description: "" });
  const [selectedSurveyId, setSelectedSurveyId] = useState(surveys[0]?.id ?? "");
  const [question, setQuestion] = useState<QuestionDraft>(emptyQuestion);
  const [editingSurvey, setEditingSurvey] = useState(false);
  const [surveyEdit, setSurveyEdit] = useState({ code: "", name: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const selectedSurvey = surveys.find(survey => survey.id === selectedSurveyId) ?? null;
  const canEditSelected = Boolean(canWrite && selectedSurvey?.editable);
  const busy = saving || refreshing || uncertain;

  async function mutate(path: string, init: RequestInit, fallback: string, onSaved: (data: Record<string, unknown>) => void, expectedId?: string) {
    if (!canWrite || gate.current || busy) return;
    gate.current = true; setSaving(true); setError(null);
    try {
      const response = await fetch(path, { ...init, signal: AbortSignal.timeout(15000) });
      const value = await response.json() as { data?: Record<string, unknown>; error?: unknown };
      if (response.status >= 400 && response.status < 500 && typeof value?.error === "string") {
        setError(authoringError(response.status, fallback, value.error)); return;
      }
      const expectedStatus = init.method === "POST" && !path.endsWith("/reorder") ? 201 : 200;
      // Do not turn an HTML response, missing receipt or lost reply into success.
      if (response.status !== expectedStatus || !value?.data || value.error ||
          (!path.endsWith("/reorder") && (typeof value.data.id !== "string" || !value.data.id || (expectedId && value.data.id !== expectedId)))) {
        setUncertain(true); setError(unknownResult); return;
      }
      onSaved(value.data);
      startTransition(() => router.refresh());
    } catch { setUncertain(true); setError(unknownResult); }
    finally { gate.current = false; setSaving(false); }
  }
  const json = (body: unknown) => ({ headers: { "content-type": "application/json", "x-purpose": "Engagement survey authoring" }, body: JSON.stringify(body) });

  async function createSurvey() {
    if (!surveyForm.code.trim() || !surveyForm.name.trim()) { setError("Survey code and name are required."); return; }
    await mutate("/api/engagement/surveys", { method: "POST", ...json({ code: surveyForm.code.trim(), name: surveyForm.name.trim(), description: surveyForm.description.trim() || undefined }) }, "Survey could not be created.", data => {
      setSurveyForm({ code: "", name: "", description: "" }); setSelectedSurveyId(data.id as string); setQuestion(emptyQuestion); setEditingSurvey(false);
    });
  }
  function editQuestion(value: Question) {
    setQuestion({ questionId: value.id, questionKey: value.questionKey, prompt: value.prompt, type: value.type, required: value.required, dimension: value.dimension ?? "", options: value.options.join(", ") }); setError(null);
  }
  async function saveQuestion() {
    if (!selectedSurvey || !canEditSelected) return;
    if (!question.questionKey.trim() || !question.prompt.trim()) { setError("Question key and prompt are required."); return; }
    const path = question.questionId ? `/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions/${encodeURIComponent(question.questionId)}` : `/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions`;
    await mutate(path, { method: question.questionId ? "PATCH" : "POST", ...json({ questionKey: question.questionKey.trim(), prompt: question.prompt.trim(), type: question.type, required: question.required, dimension: question.dimension.trim() || undefined, options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) ? question.options.split(",").map(value => value.trim()).filter(Boolean) : undefined }) }, "Question could not be saved.", () => setQuestion(emptyQuestion), question.questionId);
  }
  async function moveQuestion(questionId: string, direction: -1 | 1) {
    if (!selectedSurvey || !canEditSelected || busy) return;
    const ordered = [...selectedSurvey.questions].sort((a, b) => a.orderIndex - b.orderIndex);
    const index = ordered.findIndex(item => item.id === questionId), target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await mutate(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions/reorder`, { method: "POST", ...json({ questionIds: ordered.map(item => item.id) }) }, "Question order could not be updated.", () => {});
  }
  async function removeQuestion(questionId: string) {
    if (!selectedSurvey || !canEditSelected || busy || gate.current || !window.confirm(c("Delete this survey question?"))) return;
    await mutate(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions/${encodeURIComponent(questionId)}`, { method: "DELETE", headers: { "x-purpose": "Engagement survey question authoring" } }, "Question could not be deleted.", () => { if (question.questionId === questionId) setQuestion(emptyQuestion); }, questionId);
  }
  function beginSurveyEdit() {
    if (!selectedSurvey || !canEditSelected) return;
    setSurveyEdit({ code: selectedSurvey.code, name: selectedSurvey.name, description: selectedSurvey.description ?? "" }); setEditingSurvey(true); setError(null);
  }
  async function saveSurveyMetadata() {
    if (!selectedSurvey || !canEditSelected) return;
    if (!surveyEdit.code.trim() || !surveyEdit.name.trim()) { setError("Survey code and name are required."); return; }
    await mutate(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}`, { method: "PATCH", ...json({ code: surveyEdit.code.trim(), name: surveyEdit.name.trim(), description: surveyEdit.description.trim() || null }) }, "Survey could not be updated.", () => setEditingSurvey(false), selectedSurvey.id);
  }
  async function deleteSurvey() {
    if (!selectedSurvey || !canEditSelected || selectedSurvey.campaignCount > 0 || busy || gate.current || !window.confirm(c("Delete this unused survey and its questions?"))) return;
    await mutate(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}`, { method: "DELETE", headers: { "x-purpose": "Engagement survey authoring" } }, "Survey could not be deleted.", () => { setSelectedSurveyId(""); setQuestion(emptyQuestion); setEditingSurvey(false); }, selectedSurvey.id);
  }
  if (!canWrite) return null;
  return <div className={styles.root} data-engagement-authoring>
    <button type="button" className="secondary-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {open ? <X size={13}/> : <Plus size={13}/>} {c(open ? "Close authoring" : "Survey authoring")}
    </button>
    {open ? <div id={panelId} className={`card ${styles.panel}`}>
      <fieldset className={styles.fields} disabled={busy} aria-busy={saving || refreshing}>
        <div className={styles.grid}>
          <label><small>{c("Survey code")}</small><input value={surveyForm.code} maxLength={40} onChange={event => setSurveyForm(value => ({ ...value, code: event.target.value }))}/></label>
          <label><small>{c("Survey name")}</small><input value={surveyForm.name} maxLength={160} onChange={event => setSurveyForm(value => ({ ...value, name: event.target.value }))}/></label>
          <label className={styles.full}><small>{c("Description")}</small><textarea aria-label={c("Description")} rows={2} maxLength={2000} value={surveyForm.description} onChange={event => setSurveyForm(value => ({ ...value, description: event.target.value }))}/></label>
        </div>
        <button type="button" className="mini-action approve" onClick={() => void createSurvey()}><Save size={13}/>{c("Create survey")}</button>
        <label><small>{c("Survey")}</small><select aria-label={c("Survey")} value={selectedSurveyId} onChange={event => { setSelectedSurveyId(event.target.value); setQuestion(emptyQuestion); setEditingSurvey(false); setError(null); }}>
          <option value="">{c("Select survey…")}</option>{surveys.map(survey => <option key={survey.id} value={survey.id}>{survey.code} · {survey.name}</option>)}
        </select></label>
        {selectedSurvey ? <>
          <div className={`card ${styles.box}`}>
            <div className={styles.header}>
              <div><strong>{selectedSurvey.code} · {selectedSurvey.name}</strong><small className="cell-sub">{selectedSurvey.description || c("No description")} · {selectedSurvey.campaignCount} {c("campaign(s)")}</small></div>
              {canEditSelected ? <div className={styles.actions}>
                <button type="button" className="mini-action apply" onClick={beginSurveyEdit}><Pencil size={12}/>{c("Edit survey")}</button>
                <button type="button" className="mini-action reject" disabled={selectedSurvey.campaignCount > 0} onClick={() => void deleteSurvey()}><Trash2 size={12}/>{c("Delete survey")}</button>
              </div> : <span className="matrix-note">{c("Survey locked")}</span>}
            </div>
            {editingSurvey && canEditSelected ? <div className={styles.grid}>
              <label><small>{c("Code")}</small><input value={surveyEdit.code} maxLength={40} onChange={event => setSurveyEdit(value => ({ ...value, code: event.target.value }))}/></label>
              <label><small>{c("Name")}</small><input value={surveyEdit.name} maxLength={160} onChange={event => setSurveyEdit(value => ({ ...value, name: event.target.value }))}/></label>
              <label className={styles.full}><small>{c("Description")}</small><textarea aria-label={c("Description")} rows={2} maxLength={2000} value={surveyEdit.description} onChange={event => setSurveyEdit(value => ({ ...value, description: event.target.value }))}/></label>
              <div className={`${styles.actions} ${styles.full}`}><button type="button" className="mini-action approve" onClick={() => void saveSurveyMetadata()}><Save size={12}/>{c("Save survey")}</button><button type="button" className="mini-action reject" onClick={() => setEditingSurvey(false)}><X size={12}/>{c("Cancel")}</button></div>
            </div> : null}
          </div>
          <div className={`gov-table-wrap ${styles.scroll}`} role="region" aria-label={c("Survey authoring")} tabIndex={0}><table className="gov-table">
            <thead><tr><th>#</th>{["Key", "Prompt", "Type", "Dimension", "Required", "Actions"].map(label => <th key={label}>{c(label)}</th>)}</tr></thead>
            <tbody>{selectedSurvey.questions.length ? selectedSurvey.questions.map((item, index) => <tr key={item.id}>
              <td>{item.orderIndex}</td><td><strong>{item.questionKey}</strong></td><td>{item.prompt}</td><td>{c(item.type)}</td><td>{item.dimension ?? "—"}</td><td>{c(item.required ? "Yes" : "No")}</td>
              <td>{canEditSelected ? <div className={styles.actions}>
                <button type="button" className="mini-action apply" disabled={index === 0} onClick={() => void moveQuestion(item.id, -1)}><ArrowUp size={12}/>{c("Up")}</button>
                <button type="button" className="mini-action apply" disabled={index === selectedSurvey.questions.length - 1} onClick={() => void moveQuestion(item.id, 1)}><ArrowDown size={12}/>{c("Down")}</button>
                <button type="button" className="mini-action apply" onClick={() => editQuestion(item)}><Pencil size={12}/>{c("Edit")}</button>
                <button type="button" className="mini-action reject" onClick={() => void removeQuestion(item.id)}><Trash2 size={12}/>{c("Delete")}</button>
              </div> : <span className="matrix-note">{c("Locked")}</span>}</td>
            </tr>) : <tr><td colSpan={7}>{c("No questions authored yet.")}</td></tr>}</tbody>
          </table></div>
          {canEditSelected ? <>
            <div className={styles.questionGrid}>
              <label><small>{c("Question key")}</small><input value={question.questionKey} maxLength={80} onChange={event => setQuestion(value => ({ ...value, questionKey: event.target.value }))}/></label>
              <label><small>{c("Type")}</small><select aria-label={c("Type")} value={question.type} onChange={event => setQuestion(value => ({ ...value, type: event.target.value }))}>
                <option value="SCALE">{c("Scale")}</option><option value="SINGLE_CHOICE">{c("Single choice")}</option><option value="MULTI_CHOICE">{c("Multi choice")}</option><option value="TEXT">{c("Text")}</option><option value="ENPS">{c("eNPS")}</option>
              </select></label>
              <label><small>{c("Dimension")}</small><input value={question.dimension} maxLength={120} onChange={event => setQuestion(value => ({ ...value, dimension: event.target.value }))}/></label>
              <label className={styles.full}><small>{c("Prompt")}</small><textarea aria-label={c("Prompt")} rows={2} maxLength={1000} value={question.prompt} onChange={event => setQuestion(value => ({ ...value, prompt: event.target.value }))}/></label>
              {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) ? <label className={styles.full}><small>{c("Options (comma separated)")}</small><input value={question.options} onChange={event => setQuestion(value => ({ ...value, options: event.target.value }))}/></label> : null}
              <label className={styles.check}><input type="checkbox" checked={question.required} onChange={event => setQuestion(value => ({ ...value, required: event.target.checked }))}/><small>{c("Required")}</small></label>
            </div>
            <div className={styles.actions}><button type="button" className="mini-action approve" onClick={() => void saveQuestion()}><Save size={13}/>{c(question.questionId ? "Save question" : "Add question")}</button>{question.questionId ? <button type="button" className="mini-action reject" onClick={() => setQuestion(emptyQuestion)}><X size={13}/>{c("Cancel edit")}</button> : null}</div>
          </> : <small className="matrix-note">{c("Authoring is locked because a campaign using this survey has left DRAFT, or you are not the survey creator.")}</small>}
        </> : null}
      </fieldset>
      {saving || refreshing ? <span role="status"><LoaderCircle size={13}/></span> : null}
      {error ? <div className={`comp-decision-error ${styles.error}`} role="alert">{c(error)}{uncertain ? <button type="button" className="secondary-button" onClick={() => window.location.reload()}>{c("Reload current records")}</button> : null}</div> : null}
    </div> : null}
  </div>;
}
