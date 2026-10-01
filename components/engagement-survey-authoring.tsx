"use client";

import { LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Question = {
  id: string;
  questionKey: string;
  prompt: string;
  type: string;
  required: boolean;
  orderIndex: number;
  options: string[];
  dimension: string | null;
};

type Survey = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdById: string;
  editable: boolean;
  campaignCount: number;
  questions: Question[];
};

type QuestionDraft = {
  questionId?: string;
  questionKey: string;
  prompt: string;
  type: string;
  required: boolean;
  dimension: string;
  options: string;
};

const emptyQuestion: QuestionDraft = {
  questionKey: "",
  prompt: "",
  type: "SCALE",
  required: true,
  dimension: "",
  options: ""
};

export function EngagementSurveyAuthoring({ surveys, canWrite }: { surveys: Survey[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [surveyForm, setSurveyForm] = useState({ code: "", name: "", description: "" });
  const [selectedSurveyId, setSelectedSurveyId] = useState(surveys[0]?.id ?? "");
  const [question, setQuestion] = useState<QuestionDraft>(emptyQuestion);
  const [editingSurvey, setEditingSurvey] = useState(false);
  const [surveyEdit, setSurveyEdit] = useState({ code: "", name: "", description: "" });
  const [deletingSurvey, setDeletingSurvey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSurvey = surveys.find((survey) => survey.id === selectedSurveyId) ?? null;
  const canEditSelected = Boolean(canWrite && selectedSurvey?.editable);

  async function createSurvey() {
    if (!surveyForm.code.trim() || !surveyForm.name.trim()) {
      setError("Survey code and name are required.");
      return;
    }
    setSavingSurvey(true);
    setError(null);
    try {
      const response = await fetch("/api/engagement/surveys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Engagement survey authoring" },
        body: JSON.stringify({
          code: surveyForm.code.trim(),
          name: surveyForm.name.trim(),
          description: surveyForm.description.trim() || undefined
        })
      });
      const value = await response.json() as { data?: { id: string }; error?: string };
      if (!response.ok || !value.data) {
        setError(value.error || "Survey could not be created.");
        return;
      }
      setSurveyForm({ code: "", name: "", description: "" });
      setSelectedSurveyId(value.data.id);
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setSavingSurvey(false);
    }
  }

  function editQuestion(value: Question) {
    setQuestion({
      questionId: value.id,
      questionKey: value.questionKey,
      prompt: value.prompt,
      type: value.type,
      required: value.required,
      dimension: value.dimension ?? "",
      options: value.options.join(", ")
    });
    setError(null);
  }

  async function saveQuestion() {
    if (!selectedSurvey || !canEditSelected) return;
    if (!question.questionKey.trim() || !question.prompt.trim()) {
      setError("Question key and prompt are required.");
      return;
    }
    setSavingQuestion(true);
    setError(null);
    try {
      const path = question.questionId
        ? `/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions/${encodeURIComponent(question.questionId)}`
        : `/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions`;
      const response = await fetch(path, {
        method: question.questionId ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "x-purpose": "Engagement survey question authoring" },
        body: JSON.stringify({
          questionKey: question.questionKey.trim(),
          prompt: question.prompt.trim(),
          type: question.type,
          required: question.required,
          dimension: question.dimension.trim() || undefined,
          options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type)
            ? question.options.split(",").map((value) => value.trim()).filter(Boolean)
            : undefined
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Question could not be saved.");
        return;
      }
      setQuestion(emptyQuestion);
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setSavingQuestion(false);
    }
  }

  async function removeQuestion(questionId: string) {
    if (!selectedSurvey || !canEditSelected || !window.confirm("Delete this survey question?")) return;
    setDeleting(questionId);
    setError(null);
    try {
      const response = await fetch(
        `/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}/questions/${encodeURIComponent(questionId)}`,
        { method: "DELETE", headers: { "x-purpose": "Engagement survey question authoring" } }
      );
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Question could not be deleted.");
        return;
      }
      if (question.questionId === questionId) setQuestion(emptyQuestion);
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setDeleting(null);
    }
  }

  function beginSurveyEdit() {
    if (!selectedSurvey || !canEditSelected) return;
    setSurveyEdit({
      code: selectedSurvey.code,
      name: selectedSurvey.name,
      description: selectedSurvey.description ?? ""
    });
    setEditingSurvey(true);
    setError(null);
  }

  async function saveSurveyMetadata() {
    if (!selectedSurvey || !canEditSelected) return;
    setSavingSurvey(true);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-purpose": "Engagement survey authoring" },
        body: JSON.stringify({
          code: surveyEdit.code.trim(),
          name: surveyEdit.name.trim(),
          description: surveyEdit.description.trim() || null
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Survey could not be updated.");
        return;
      }
      setEditingSurvey(false);
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setSavingSurvey(false);
    }
  }

  async function deleteSurvey() {
    if (!selectedSurvey || !canEditSelected || selectedSurvey.campaignCount > 0) return;
    if (!window.confirm("Delete this unused survey and its questions?")) return;
    setDeletingSurvey(true);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/surveys/${encodeURIComponent(selectedSurvey.id)}`, {
        method: "DELETE",
        headers: { "x-purpose": "Engagement survey authoring" }
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Survey could not be deleted.");
        return;
      }
      setSelectedSurveyId("");
      setQuestion(emptyQuestion);
      setEditingSurvey(false);
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setDeletingSurvey(false);
    }
  }

  if (!canWrite) return null;

  return <div style={{ display: "grid", gap: 8 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>
      {open ? <X size={13}/> : <Plus size={13}/>} {open ? "Close authoring" : "Survey authoring"}
    </button>
    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 10, width: "min(900px, 84vw)", maxWidth: "84vw" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label><small>Survey code</small><input value={surveyForm.code} maxLength={40} onChange={(event) => setSurveyForm((value) => ({ ...value, code: event.target.value }))}/></label>
        <label><small>Survey name</small><input value={surveyForm.name} maxLength={160} onChange={(event) => setSurveyForm((value) => ({ ...value, name: event.target.value }))}/></label>
        <label style={{ gridColumn: "1 / -1" }}><small>Description</small><textarea rows={2} maxLength={2000} value={surveyForm.description} onChange={(event) => setSurveyForm((value) => ({ ...value, description: event.target.value }))}/></label>
      </div>
      <button type="button" className="mini-action approve" disabled={savingSurvey} onClick={() => void createSurvey()}>
        {savingSurvey ? <LoaderCircle size={13}/> : <Save size={13}/>} Create survey
      </button>

      <label><small>Survey</small><select value={selectedSurveyId} onChange={(event) => { setSelectedSurveyId(event.target.value); setQuestion(emptyQuestion); setEditingSurvey(false); }}>
        <option value="">Select survey…</option>
        {surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.code} · {survey.name}</option>)}
      </select></label>

      {selectedSurvey ? <>
        <div className="card" style={{ padding: 9, display: "grid", gap: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div><strong>{selectedSurvey.code} · {selectedSurvey.name}</strong><small className="cell-sub">{selectedSurvey.description || "No description"} · {selectedSurvey.campaignCount} campaign(s)</small></div>
            {canEditSelected ? <div className="comp-decision-buttons">
              <button type="button" className="mini-action apply" onClick={beginSurveyEdit}><Pencil size={12}/> Edit survey</button>
              <button type="button" className="mini-action reject" disabled={deletingSurvey || selectedSurvey.campaignCount > 0} onClick={() => void deleteSurvey()}>{deletingSurvey ? <LoaderCircle size={12}/> : <Trash2 size={12}/>} Delete survey</button>
            </div> : <span className="matrix-note">Survey locked</span>}
          </div>
          {editingSurvey ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <label><small>Code</small><input value={surveyEdit.code} maxLength={40} onChange={(event) => setSurveyEdit((value) => ({ ...value, code: event.target.value }))}/></label>
            <label><small>Name</small><input value={surveyEdit.name} maxLength={160} onChange={(event) => setSurveyEdit((value) => ({ ...value, name: event.target.value }))}/></label>
            <label style={{ gridColumn: "1 / -1" }}><small>Description</small><textarea rows={2} maxLength={2000} value={surveyEdit.description} onChange={(event) => setSurveyEdit((value) => ({ ...value, description: event.target.value }))}/></label>
            <div className="comp-decision-buttons"><button type="button" className="mini-action approve" disabled={savingSurvey} onClick={() => void saveSurveyMetadata()}>{savingSurvey ? <LoaderCircle size={12}/> : <Save size={12}/>} Save survey</button><button type="button" className="mini-action reject" onClick={() => setEditingSurvey(false)}><X size={12}/> Cancel</button></div>
          </div> : null}
        </div>
        <div className="gov-table-wrap"><table className="gov-table">
          <thead><tr><th>#</th><th>Key</th><th>Prompt</th><th>Type</th><th>Dimension</th><th>Required</th><th>Actions</th></tr></thead>
          <tbody>{selectedSurvey.questions.length ? selectedSurvey.questions.map((item) => <tr key={item.id}>
            <td>{item.orderIndex}</td><td><strong>{item.questionKey}</strong></td><td>{item.prompt}</td><td>{item.type}</td><td>{item.dimension ?? "—"}</td><td>{item.required ? "Yes" : "No"}</td>
            <td>{canEditSelected ? <div className="comp-decision-buttons">
              <button type="button" className="mini-action apply" onClick={() => editQuestion(item)}><Pencil size={12}/> Edit</button>
              <button type="button" className="mini-action reject" disabled={deleting === item.id} onClick={() => void removeQuestion(item.id)}>{deleting === item.id ? <LoaderCircle size={12}/> : <Trash2 size={12}/>} Delete</button>
            </div> : <span className="matrix-note">Locked</span>}</td>
          </tr>) : <tr><td colSpan={7} style={{ textAlign: "center", padding: 18 }}>No questions authored yet.</td></tr>}</tbody>
        </table></div>

        {canEditSelected ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 7 }}>
          <label><small>Question key</small><input value={question.questionKey} maxLength={80} onChange={(event) => setQuestion((value) => ({ ...value, questionKey: event.target.value }))}/></label>
          <label><small>Type</small><select value={question.type} onChange={(event) => setQuestion((value) => ({ ...value, type: event.target.value }))}>
            <option value="SCALE">Scale</option><option value="SINGLE_CHOICE">Single choice</option><option value="MULTI_CHOICE">Multi choice</option><option value="TEXT">Text</option><option value="ENPS">eNPS</option>
          </select></label>
          <label><small>Dimension</small><input value={question.dimension} maxLength={120} onChange={(event) => setQuestion((value) => ({ ...value, dimension: event.target.value }))}/></label>
          <label style={{ gridColumn: "1 / -1" }}><small>Prompt</small><textarea rows={2} maxLength={1000} value={question.prompt} onChange={(event) => setQuestion((value) => ({ ...value, prompt: event.target.value }))}/></label>
          {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) ? <label style={{ gridColumn: "1 / -1" }}><small>Options (comma separated)</small><input value={question.options} onChange={(event) => setQuestion((value) => ({ ...value, options: event.target.value }))}/></label> : null}
          <label><small><input type="checkbox" checked={question.required} onChange={(event) => setQuestion((value) => ({ ...value, required: event.target.checked }))}/> Required</small></label>
        </div> : <small className="matrix-note">Authoring is locked because a campaign using this survey has left DRAFT, or you are not the survey creator.</small>}

        {canEditSelected ? <div className="comp-decision-buttons">
          <button type="button" className="mini-action approve" disabled={savingQuestion} onClick={() => void saveQuestion()}>{savingQuestion ? <LoaderCircle size={13}/> : <Save size={13}/>} {question.questionId ? "Save question" : "Add question"}</button>
          {question.questionId ? <button type="button" className="mini-action reject" onClick={() => setQuestion(emptyQuestion)}><X size={13}/> Cancel edit</button> : null}
        </div> : null}
      </> : null}

      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
