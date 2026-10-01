"use client";

import { CheckCircle2, LoaderCircle, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Question = {
  id: string;
  questionKey: string;
  prompt: string;
  type: "SCALE" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "TEXT" | "ENPS";
  required: boolean;
  orderIndex: number;
  options: string[];
  dimension: string | null;
};

type ResponseContext = {
  campaignId: string;
  campaignName: string;
  surveyName: string;
  anonymous: boolean;
  submitted: boolean;
  submittedAt: string | null;
  questions: Question[];
};

export function EngagementResponseAction({
  campaignId
}: {
  campaignId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [context, setContext] = useState<ResponseContext | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${encodeURIComponent(campaignId)}/responses`, { cache: "no-store" });
      const value = await response.json() as { data?: ResponseContext; error?: string };
      if (!response.ok || !value.data) throw new Error(value.error || "Response form unavailable.");
      setContext(value.data);
      setAnswers({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Response form unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next && !context) await load();
  }

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleMulti(questionId: string, option: string) {
    setAnswers((current) => {
      const existing = Array.isArray(current[questionId]) ? current[questionId] as string[] : [];
      const next = existing.includes(option) ? existing.filter((item) => item !== option) : [...existing, option];
      return { ...current, [questionId]: next };
    });
  }

  async function submit() {
    if (!context || context.submitted) return;
    const missing = context.questions.filter((question) => question.required && answers[question.id] === undefined);
    if (missing.length) {
      setError("Answer all required questions.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${encodeURIComponent(campaignId)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Engagement survey response" },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value }))
        })
      });
      const value = await response.json() as { data?: { submitted: boolean; submittedAt: string }; error?: string };
      if (!response.ok || !value.data) {
        setError(value.error || "Response could not be submitted.");
        return;
      }
      setContext((current) => current ? { ...current, submitted: true, submittedAt: value.data!.submittedAt, questions: [] } : current);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div style={{ display: "grid", gap: 6 }}>
    <button type="button" className="secondary-button" onClick={() => void toggle()}>
      {open ? <X size={12}/> : context?.submitted ? <CheckCircle2 size={12}/> : <Send size={12}/>}
      {open ? "Close response" : context?.submitted ? "Response submitted" : "Respond"}
    </button>

    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 10, width: "min(680px, 82vw)", maxWidth: "82vw" }}>
      {loading ? <span className="matrix-note"><LoaderCircle size={12}/> Loading survey…</span> : null}
      {context ? <div>
        <strong>{context.campaignName}</strong>
        <small className="cell-sub">{context.surveyName} · {context.anonymous ? "Anonymous" : "Confidential"}</small>
      </div> : null}

      {context?.submitted ? <span className="matrix-note"><CheckCircle2 size={12}/> Submitted {context.submittedAt ? new Date(context.submittedAt).toLocaleString() : ""}</span> : null}

      {context && !context.submitted ? <div style={{ display: "grid", gap: 10 }}>
        {context.questions.map((question) => <div key={question.id} className="card" style={{ padding: 9, display: "grid", gap: 6 }}>
          <label><strong>{question.orderIndex}. {question.prompt}{question.required ? " *" : ""}</strong>{question.dimension ? <small className="cell-sub">{question.dimension}</small> : null}</label>
          {question.type === "TEXT" ? <textarea rows={3} maxLength={2000} value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""} onChange={(event) => setAnswer(question.id, event.target.value)}/> : null}
          {question.type === "SCALE" ? <input type="number" min="1" max="5" value={typeof answers[question.id] === "number" ? answers[question.id] as number : ""} onChange={(event) => setAnswer(question.id, Number(event.target.value))}/> : null}
          {question.type === "ENPS" ? <input type="number" min="0" max="10" value={typeof answers[question.id] === "number" ? answers[question.id] as number : ""} onChange={(event) => setAnswer(question.id, Number(event.target.value))}/> : null}
          {question.type === "SINGLE_CHOICE" ? <select value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""} onChange={(event) => setAnswer(question.id, event.target.value)}>
            <option value="">Select…</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select> : null}
          {question.type === "MULTI_CHOICE" ? <div style={{ display: "grid", gap: 4 }}>{question.options.map((option) => {
            const selected = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]).includes(option) : false;
            return <label key={option}><small><input type="checkbox" checked={selected} onChange={() => toggleMulti(question.id, option)}/> {option}</small></label>;
          })}</div> : null}
        </div>)}
        <button type="button" className="mini-action approve" disabled={submitting} onClick={() => void submit()}>
          {submitting ? <LoaderCircle size={13}/> : <Send size={13}/>} Submit response
        </button>
      </div> : null}

      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
