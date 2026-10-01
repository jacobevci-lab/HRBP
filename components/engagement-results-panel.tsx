"use client";

import { BarChart3, EyeOff, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

type Distribution = {
  option: string;
  count: number | null;
  percent: number | null;
  suppressed: boolean;
};

type QuestionResult = {
  id: string;
  questionKey: string;
  prompt: string;
  type: string;
  dimension: string | null;
  answered: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
  metric: { label: string; value: number } | null;
  distribution: Distribution[];
};

type ResultData = {
  campaign: { id: string; name: string; survey: string; anonymous: boolean; status: string };
  suppressed: boolean;
  suppressionReason: string | null;
  threshold: number;
  responseCount: number | null;
  targetCount: number | null;
  responseRate: number | null;
  questions: QuestionResult[];
};

export function EngagementResultsPanel({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    if (!next || data || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${encodeURIComponent(campaignId)}/results`, { cache: "no-store" });
      const value = await response.json() as { data?: ResultData; error?: string };
      if (!response.ok || !value.data) throw new Error(value.error || "Results unavailable.");
      setData(value.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Results unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return <div style={{ display: "grid", gap: 6 }}>
    <button type="button" className="secondary-button" onClick={() => void toggle()}>
      {open ? <X size={12}/> : <BarChart3 size={12}/>} {open ? "Close results" : "Results"}
    </button>

    {open ? <div className="card" style={{ padding: 10, display: "grid", gap: 10, width: "min(840px, 84vw)", maxWidth: "84vw" }}>
      {loading ? <span className="matrix-note"><LoaderCircle size={12}/> Aggregating privacy-safe results…</span> : null}
      {data ? <>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div><strong>{data.campaign.name}</strong><small className="cell-sub">{data.campaign.survey} · {data.campaign.anonymous ? "Anonymous" : "Confidential"}</small></div>
          <span className="matrix-note">Privacy threshold {data.threshold}</span>
        </div>

        {data.suppressed ? <div className="governance-note"><EyeOff size={16}/><p><strong>Results suppressed.</strong> {data.suppressionReason}</p></div> : <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            <div className="card" style={{ padding: 9 }}><small>Responses</small><strong style={{ display: "block" }}>{data.responseCount}{data.targetCount ? ` / ${data.targetCount}` : ""}</strong></div>
            <div className="card" style={{ padding: 9 }}><small>Response rate</small><strong style={{ display: "block" }}>{data.responseRate === null ? "—" : `${data.responseRate}%`}</strong></div>
            <div className="card" style={{ padding: 9 }}><small>Disclosure</small><strong style={{ display: "block" }}>Aggregate only</strong></div>
          </div>

          <div style={{ display: "grid", gap: 9 }}>
            {data.questions.map((question) => <div key={question.id} className="card" style={{ padding: 10, display: "grid", gap: 7 }}>
              <div><strong>{question.prompt}</strong><small className="cell-sub">{question.questionKey} · {question.type}{question.dimension ? ` · ${question.dimension}` : ""}</small></div>
              {question.suppressed ? <small className="matrix-note"><EyeOff size={11}/> {question.suppressionReason}</small> : <>
                <small>{question.answered} answer(s)</small>
                {question.metric ? <div><strong>{question.metric.label}: {question.metric.value}</strong></div> : null}
                {question.distribution.length ? <div className="gov-table-wrap"><table className="gov-table"><thead><tr><th>Option</th><th>Count</th><th>Percent</th></tr></thead><tbody>
                  {question.distribution.map((item) => <tr key={item.option}><td>{item.option}</td><td>{item.suppressed ? "Suppressed" : item.count}</td><td>{item.suppressed || item.percent === null ? "Suppressed" : `${item.percent}%`}</td></tr>)}
                </tbody></table></div> : null}
              </>}
            </div>)}
          </div>
        </>}
      </> : null}
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
