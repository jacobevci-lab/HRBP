"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, Download, ExternalLink, History, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type DecisionHistoryItem = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  classification: string;
  occurredAt: string;
  href: string | null;
};

type HistoryResponse = {
  data?: {
    days: number;
    items: DecisionHistoryItem[];
  };
  error?: string;
};

function actionLabel(action: string) {
  return action
    .replace(/^engagement\./, "")
    .replace(/^privacy\./, "")
    .replace(/^workflow\./, "")
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLabel(resourceType: string, tr: boolean) {
  const labels: Record<string, [string, string]> = {
    LeaveRequest: ["Leave", "İzin"],
    TimeEntry: ["Time", "Zaman"],
    CompensationChange: ["Compensation", "Ücret"],
    PayrollRun: ["Payroll", "Bordro"],
    Requisition: ["Recruiting requisition", "İşe alım talebi"],
    Offer: ["Recruiting offer", "İşe alım teklifi"],
    PolicyRecord: ["Policy", "Politika"],
    WorkforceScenario: ["Workforce plan", "İşgücü planı"],
    WorkflowDefinition: ["Workflow definition", "İş akışı tanımı"],
    WorkflowTask: ["Workflow task", "İş akışı görevi"],
    SurveyCampaign: ["Engagement campaign", "Bağlılık kampanyası"],
    DataSubjectRequest: ["Privacy DSR", "Gizlilik DSR"],
    PrivacyRiskAssessment: ["Privacy assessment", "Gizlilik değerlendirmesi"],
    HRServiceRequest: ["HR service", "İK hizmeti"]
  };
  const label = labels[resourceType];
  return label ? (tr ? label[1] : label[0]) : resourceType;
}

export function ActionCenterDecisionHistory() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [days, setDays] = useState(30);
  const [items, setItems] = useState<DecisionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (windowDays = days) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/action-center/history?days=${windowDays}`, { cache: "no-store" });
      const body = await response.json() as HistoryResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setItems(body.data?.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Karar geçmişi yüklenemedi." : "Decision history could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [days, tr]);

  useEffect(() => { void load(days); }, [days, load]);

  useEffect(() => {
    const refresh = () => void load(days);
    window.addEventListener("hrbp:lifecycle-actions-changed", refresh);
    return () => window.removeEventListener("hrbp:lifecycle-actions-changed", refresh);
  }, [days, load]);

  const grouped = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.resourceType, (counts.get(item.resourceType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [items]);

  function fmt(value: string) {
    return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  return <section className="workflow-decision-history card">
    <div className="workflow-decision-history-head">
      <div>
        <span className="section-kicker">{tr ? "Karar kanıtı" : "Decision evidence"}</span>
        <h3>{tr ? "Son verdiğim yönetişim kararları" : "My recent governed decisions"}</h3>
        <p>{tr ? "Action Center ve bağlı domain akışlarında verdiğiniz kararların actor-scoped audit görünümü. Hassas purpose, payload, kişi veya ücret detayı bu görünüme taşınmaz." : "Actor-scoped audit view of decisions you made through Action Center and governed domain flows. Sensitive purpose, payload, person or pay detail is not projected here."}</p>
      </div>
      <div className="workflow-history-controls">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label={tr ? "Zaman aralığı" : "Time range"}>
          <option value={7}>7d</option>
          <option value={30}>30d</option>
          <option value={90}>90d</option>
        </select>
        <button className="secondary-button compact" type="button" onClick={() => void load(days)} disabled={loading}><RefreshCw size={14}/>{tr ? "Yenile" : "Refresh"}</button>
        <a className="secondary-button compact" href={`/api/action-center/history/export?days=${days}`}><Download size={14}/>{tr ? "CSV kanıt" : "Export CSV"}</a>
      </div>
    </div>

    <div className="workflow-history-metrics">
      <div><History size={16}/><span>{tr ? "Karar kaydı" : "Decision records"}</span><strong>{items.length}</strong></div>
      <div><ShieldCheck size={16}/><span>{tr ? "Actor scope" : "Actor scope"}</span><strong>{tr ? "Kişisel" : "Personal"}</strong></div>
      <div><Clock3 size={16}/><span>{tr ? "Pencere" : "Window"}</span><strong>{days}d</strong></div>
    </div>

    {grouped.length ? <div className="workflow-history-chips">{grouped.map(([resource, count]) => <span key={resource}>{sourceLabel(resource, tr)} <strong>{count}</strong></span>)}</div> : null}
    {error ? <div className="workflow-action-message error">{error}</div> : null}

    <div className="workflow-action-table-wrap">
      <table className="workflow-action-table workflow-history-table">
        <thead><tr><th>{tr ? "Zaman" : "Time"}</th><th>{tr ? "Alan" : "Domain"}</th><th>{tr ? "Karar" : "Decision"}</th><th>{tr ? "Kaynak" : "Resource"}</th><th>{tr ? "Sınıf" : "Class"}</th><th>{tr ? "Kanıt" : "Evidence"}</th></tr></thead>
        <tbody>
          {loading && !items.length ? <tr><td colSpan={6} className="workflow-action-empty">{tr ? "Karar geçmişi yükleniyor…" : "Loading decision history…"}</td></tr> : null}
          {!loading && !items.length ? <tr><td colSpan={6} className="workflow-action-empty"><CheckCircle2 size={16}/>{tr ? "Seçili aralıkta yönetişim kararı yok." : "No governed decisions in this period."}</td></tr> : null}
          {items.map((item) => <tr key={item.id}>
            <td><time>{fmt(item.occurredAt)}</time></td>
            <td><span className="workflow-source">{sourceLabel(item.resourceType, tr)}</span></td>
            <td><strong className="workflow-history-action">{actionLabel(item.action)}</strong></td>
            <td><span>{item.resourceType}</span><small>{item.resourceId}</small></td>
            <td><span className="workflow-task-status">{item.classification.replaceAll("_", " ")}</span></td>
            <td>{item.href ? <Link className="secondary-button compact" href={item.href}>{tr ? "Kaydı aç" : "Open record"}<ExternalLink size={12}/></Link> : <span className="matrix-note">Audit</span>}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="workflow-history-footnote">{tr ? "En fazla son 80 actor-scoped karar gösterilir. Tam hash-zincirli kanıt Audit Ledger içinde kalır." : "Up to the latest 80 actor-scoped decisions are shown. Full hash-chained evidence remains in the Audit Ledger."}</p>
  </section>;
}
