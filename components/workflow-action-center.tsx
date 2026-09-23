"use client";

import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type WorkflowTaskItem = {
  id: string;
  stepKey: string;
  name: string;
  assigneeId: string | null;
  assigneeRole: string | null;
  status: "READY" | "IN_PROGRESS";
  dueAt: string | null;
  startedAt: string | null;
  instance: {
    id: string;
    subjectType: string;
    subjectId: string;
    status: string;
    startedAt: string;
    definition: { key: string; name: string; version: number };
  };
};

type ActionQueueResponse = {
  data?: {
    items: WorkflowTaskItem[];
    summary: { total: number; overdue: number; dueSoon: number };
    generatedAt: string;
  };
  error?: string;
};

type Filter = "all" | "overdue" | "due-soon";

export function WorkflowActionCenter() {
  const { locale } = useLocale();
  const [items, setItems] = useState<WorkflowTaskItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, dueSoon: 0 });
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workflows/tasks", { cache: "no-store" });
      const body = await response.json() as ActionQueueResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setItems(body.data?.items ?? []);
      setSummary(body.data?.summary ?? { total: 0, overdue: 0, dueSoon: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === "tr" ? "Aksiyon kuyruğu yüklenemedi." : "Action queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleItems = useMemo(() => {
    const now = Date.now();
    const soon = now + 24 * 60 * 60 * 1000;
    if (filter === "overdue") return items.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now);
    if (filter === "due-soon") return items.filter((item) => {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt).getTime();
      return due >= now && due <= soon;
    });
    return items;
  }, [filter, items]);

  async function completeTask(item: WorkflowTaskItem) {
    const prompt = locale === "tr"
      ? `“${item.name}” görevini tamamlandı olarak işaretlemek istiyor musun?`
      : `Mark “${item.name}” as completed?`;
    if (!window.confirm(prompt)) return;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/workflows/instances/${encodeURIComponent(item.instance.id)}/tasks/${encodeURIComponent(item.id)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: { source: "action-center", completedAt: new Date().toISOString() } })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSuccess(locale === "tr" ? "Görev tamamlandı ve iş akışı bir sonraki adıma ilerletildi." : "Task completed and the workflow advanced to its next step.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === "tr" ? "Görev tamamlanamadı." : "Task could not be completed."));
    } finally {
      setBusyId(null);
    }
  }

  function formatDate(value: string | null) {
    if (!value) return locale === "tr" ? "SLA yok" : "No SLA";
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function dueState(value: string | null) {
    if (!value) return "normal";
    const due = new Date(value).getTime();
    const now = Date.now();
    if (due < now) return "overdue";
    if (due <= now + 24 * 60 * 60 * 1000) return "due-soon";
    return "normal";
  }

  return (
    <section className="workflow-action-center card">
      <div className="workflow-action-head">
        <div>
          <span className="section-kicker">{locale === "tr" ? "Kişisel aksiyon merkezi" : "Personal action center"}</span>
          <h3>{locale === "tr" ? "Bekleyen iş akışı görevlerim" : "My pending workflow tasks"}</h3>
          <p>{locale === "tr" ? "Kullanıcı veya rol atamana gelen aktif adımları tek kuyrukta tamamla." : "Complete active steps assigned directly to you or to your governed role."}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15}/>{locale === "tr" ? "Yenile" : "Refresh"}
        </button>
      </div>

      <div className="workflow-action-metrics">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          <Workflow size={17}/><span>{locale === "tr" ? "Açık görev" : "Open tasks"}</span><strong>{summary.total}</strong>
        </button>
        <button type="button" className={`${filter === "overdue" ? "active" : ""} ${summary.overdue ? "danger" : ""}`} onClick={() => setFilter("overdue")}>
          <AlertTriangle size={17}/><span>{locale === "tr" ? "Geciken" : "Overdue"}</span><strong>{summary.overdue}</strong>
        </button>
        <button type="button" className={filter === "due-soon" ? "active" : ""} onClick={() => setFilter("due-soon")}>
          <Clock3 size={17}/><span>{locale === "tr" ? "24 saat içinde" : "Due in 24h"}</span><strong>{summary.dueSoon}</strong>
        </button>
      </div>

      {error ? <div className="workflow-action-message error"><AlertTriangle size={15}/>{error}</div> : null}
      {success ? <div className="workflow-action-message success"><CheckCircle2 size={15}/>{success}</div> : null}

      <div className="workflow-action-table-wrap">
        <table className="workflow-action-table">
          <thead>
            <tr>
              <th>{locale === "tr" ? "Görev" : "Task"}</th>
              <th>{locale === "tr" ? "İş akışı" : "Workflow"}</th>
              <th>{locale === "tr" ? "Konu" : "Subject"}</th>
              <th>{locale === "tr" ? "Atama" : "Assignment"}</th>
              <th>SLA</th>
              <th>{locale === "tr" ? "Durum" : "Status"}</th>
              <th>{locale === "tr" ? "Aksiyon" : "Action"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty">{locale === "tr" ? "Aksiyon kuyruğu yükleniyor…" : "Loading action queue…"}</td></tr> : null}
            {!loading && visibleItems.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty"><CheckCircle2 size={17}/>{locale === "tr" ? "Bu görünümde bekleyen görev yok." : "No pending tasks in this view."}</td></tr> : null}
            {visibleItems.map((item) => {
              const due = dueState(item.dueAt);
              return (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong><small>{item.stepKey}</small></td>
                  <td><strong>{item.instance.definition.name}</strong><small>{item.instance.definition.key} · v{item.instance.definition.version}</small></td>
                  <td><span>{item.instance.subjectType}</span><small>{item.instance.subjectId}</small></td>
                  <td>{item.assigneeId ? (locale === "tr" ? "Doğrudan kullanıcı" : "Direct user") : item.assigneeRole || (locale === "tr" ? "Ortak kuyruk" : "Shared queue")}</td>
                  <td><span className={`workflow-due ${due}`}>{formatDate(item.dueAt)}</span></td>
                  <td><span className="workflow-task-status">{item.status === "IN_PROGRESS" ? (locale === "tr" ? "Devam ediyor" : "In progress") : (locale === "tr" ? "Hazır" : "Ready")}</span></td>
                  <td><button className="primary-button compact" type="button" disabled={busyId === item.id} onClick={() => void completeTask(item)}>{busyId === item.id ? (locale === "tr" ? "İşleniyor…" : "Processing…") : (locale === "tr" ? "Tamamla" : "Complete")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
