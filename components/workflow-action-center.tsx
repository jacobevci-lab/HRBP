"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw, ShieldAlert, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type ActionKind = "workflow" | "hr-service" | "employee-relations";
type Urgency = "normal" | "warning" | "critical";
type Filter = "all" | "critical" | "overdue" | "due-soon" | ActionKind;

const allowedFilters = new Set<Filter>(["all", "critical", "overdue", "due-soon", "workflow", "hr-service", "employee-relations"]);

function normalizeFilter(value?: string): Filter {
  return value && allowedFilters.has(value as Filter) ? value as Filter : "all";
}

type LifecycleActionItem = {
  id: string;
  kind: ActionKind;
  title: string;
  subtitle: string;
  module: string;
  href: string;
  subjectType: string;
  subjectId: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  urgency: Urgency;
  action: null | {
    type: "complete-workflow";
    instanceId: string;
    taskId: string;
  };
};

type ActionQueueResponse = {
  data?: {
    items: LifecycleActionItem[];
    summary: {
      total: number;
      overdue: number;
      dueSoon: number;
      critical: number;
      workflow: number;
      hrService: number;
      employeeRelations: number;
    };
    generatedAt: string;
  };
  error?: string;
};

async function acknowledgeTaskNotifications(taskId: string) {
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceType: "WorkflowTask", resourceId: taskId, read: true })
    });
    if (response.ok) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch {
    // Notification acknowledgement is best-effort and must never roll back an
    // already completed workflow task.
  }
}

export function WorkflowActionCenter({ initialTaskId, initialInstanceId, initialFilter }: { initialTaskId?: string; initialInstanceId?: string; initialFilter?: string }) {
  const { locale } = useLocale();
  const [items, setItems] = useState<LifecycleActionItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, dueSoon: 0, critical: 0, workflow: 0, hrService: 0, employeeRelations: 0 });
  const [filter, setFilter] = useState<Filter>(() => normalizeFilter(initialFilter));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/action-center", { cache: "no-store" });
      const body = await response.json() as ActionQueueResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setItems(body.data?.items ?? []);
      setSummary(body.data?.summary ?? { total: 0, overdue: 0, dueSoon: 0, critical: 0, workflow: 0, hrService: 0, employeeRelations: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === "tr" ? "Aksiyon merkezi yüklenemedi." : "Action center could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || (!initialTaskId && !initialInstanceId)) return;
    setFilter("all");
    const target = initialTaskId
      ? document.getElementById(`action-item-workflow:${initialTaskId}`)
      : document.querySelector<HTMLElement>(`[data-workflow-instance="${CSS.escape(initialInstanceId ?? "")}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [initialInstanceId, initialTaskId, loading]);

  const visibleItems = useMemo(() => {
    const now = Date.now();
    const soon = now + 24 * 60 * 60 * 1000;
    if (filter === "critical") return items.filter((item) => item.urgency === "critical");
    if (filter === "overdue") return items.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now);
    if (filter === "due-soon") return items.filter((item) => {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt).getTime();
      return due >= now && due <= soon;
    });
    if (filter === "workflow" || filter === "hr-service" || filter === "employee-relations") return items.filter((item) => item.kind === filter);
    return items;
  }, [filter, items]);

  async function completeWorkflowTask(item: LifecycleActionItem) {
    if (!item.action || item.action.type !== "complete-workflow") return;
    const prompt = locale === "tr"
      ? `“${item.title}” görevini tamamlandı olarak işaretlemek istiyor musun?`
      : `Mark “${item.title}” as completed?`;
    if (!window.confirm(prompt)) return;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/workflows/instances/${encodeURIComponent(item.action.instanceId)}/tasks/${encodeURIComponent(item.action.taskId)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: { source: "lifecycle-action-center", completedAt: new Date().toISOString() } })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSuccess(locale === "tr" ? "Görev tamamlandı ve yaşam döngüsü bir sonraki adıma ilerletildi." : "Task completed and the lifecycle advanced to its next step.");
      await acknowledgeTaskNotifications(item.action.taskId);
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

  function sourceLabel(kind: ActionKind) {
    if (kind === "workflow") return locale === "tr" ? "İş akışı" : "Workflow";
    if (kind === "hr-service") return locale === "tr" ? "İK Hizmeti" : "HR Service";
    return locale === "tr" ? "Çalışan İlişkileri" : "Employee Relations";
  }

  function urgencyLabel(urgency: Urgency) {
    if (urgency === "critical") return locale === "tr" ? "Kritik" : "Critical";
    if (urgency === "warning") return locale === "tr" ? "Dikkat" : "Attention";
    return locale === "tr" ? "Normal" : "Normal";
  }

  return (
    <section className="workflow-action-center card">
      <div className="workflow-action-head">
        <div>
          <span className="section-kicker">{locale === "tr" ? "Yaşam döngüsü aksiyon merkezi" : "Lifecycle action center"}</span>
          <h3>{locale === "tr" ? "Bekleyen işlerim ve operasyonel blokajlar" : "My pending work and operational blockers"}</h3>
          <p>{locale === "tr" ? "İş akışlarını, İK hizmet taleplerini ve kısıtlı çalışan ilişkileri aksiyonlarını tek yetkili kuyrukta takip et." : "Track workflows, HR service requests and restricted employee-relations actions in one authorized queue."}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15}/>{locale === "tr" ? "Yenile" : "Refresh"}
        </button>
      </div>

      <div className="workflow-action-metrics">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          <Workflow size={17}/><span>{locale === "tr" ? "Tüm açık işler" : "All open work"}</span><strong>{summary.total}</strong>
        </button>
        <button type="button" className={`${filter === "critical" ? "active" : ""} ${summary.critical ? "danger" : ""}`} onClick={() => setFilter("critical")}>
          <ShieldAlert size={17}/><span>{locale === "tr" ? "Kritik" : "Critical"}</span><strong>{summary.critical}</strong>
        </button>
        <button type="button" className={`${filter === "overdue" ? "active" : ""} ${summary.overdue ? "danger" : ""}`} onClick={() => setFilter("overdue")}>
          <AlertTriangle size={17}/><span>{locale === "tr" ? "Geciken" : "Overdue"}</span><strong>{summary.overdue}</strong>
        </button>
        <button type="button" className={filter === "due-soon" ? "active" : ""} onClick={() => setFilter("due-soon")}>
          <Clock3 size={17}/><span>{locale === "tr" ? "24 saat içinde" : "Due in 24h"}</span><strong>{summary.dueSoon}</strong>
        </button>
      </div>

      <div className="workflow-action-source-filters" role="group" aria-label={locale === "tr" ? "Kaynak filtresi" : "Source filter"}>
        <button type="button" className={filter === "workflow" ? "active" : ""} onClick={() => setFilter("workflow")}>{locale === "tr" ? "İş akışı" : "Workflow"} <strong>{summary.workflow}</strong></button>
        <button type="button" className={filter === "hr-service" ? "active" : ""} onClick={() => setFilter("hr-service")}>{locale === "tr" ? "İK Hizmeti" : "HR Service"} <strong>{summary.hrService}</strong></button>
        <button type="button" className={filter === "employee-relations" ? "active" : ""} onClick={() => setFilter("employee-relations")}>{locale === "tr" ? "Çalışan İlişkileri" : "Employee Relations"} <strong>{summary.employeeRelations}</strong></button>
      </div>

      {error ? <div className="workflow-action-message error"><AlertTriangle size={15}/>{error}</div> : null}
      {success ? <div className="workflow-action-message success"><CheckCircle2 size={15}/>{success}</div> : null}

      <div className="workflow-action-table-wrap">
        <table className="workflow-action-table">
          <thead>
            <tr>
              <th>{locale === "tr" ? "Kaynak" : "Source"}</th>
              <th>{locale === "tr" ? "Aksiyon" : "Action"}</th>
              <th>{locale === "tr" ? "Konu" : "Subject"}</th>
              <th>SLA</th>
              <th>{locale === "tr" ? "Öncelik" : "Priority"}</th>
              <th>{locale === "tr" ? "Durum" : "Status"}</th>
              <th>{locale === "tr" ? "İşlem" : "Operation"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty">{locale === "tr" ? "Aksiyon merkezi yükleniyor…" : "Loading action center…"}</td></tr> : null}
            {!loading && visibleItems.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty"><CheckCircle2 size={17}/>{locale === "tr" ? "Bu görünümde bekleyen aksiyon yok." : "No pending actions in this view."}</td></tr> : null}
            {visibleItems.map((item) => {
              const focused = item.kind === "workflow" && (item.action?.taskId === initialTaskId || item.action?.instanceId === initialInstanceId);
              return (
                <tr key={item.id} id={`action-item-${item.id}`} data-workflow-instance={item.action?.instanceId} className={focused ? "focused" : undefined}>
                  <td><span className={`workflow-source ${item.kind}`}>{sourceLabel(item.kind)}</span></td>
                  <td><strong>{item.title}</strong><small>{item.subtitle}</small></td>
                  <td><span>{item.subjectType}</span><small>{item.subjectId}</small></td>
                  <td><span className={`workflow-due ${item.urgency}`}>{formatDate(item.dueAt)}</span></td>
                  <td><span className={`workflow-urgency ${item.urgency}`}>{urgencyLabel(item.urgency)}</span></td>
                  <td><span className="workflow-task-status">{item.status}</span></td>
                  <td>
                    {item.action?.type === "complete-workflow"
                      ? <button className="primary-button compact" type="button" disabled={busyId === item.id} onClick={() => void completeWorkflowTask(item)}>{busyId === item.id ? (locale === "tr" ? "İşleniyor…" : "Processing…") : (locale === "tr" ? "Tamamla" : "Complete")}</button>
                      : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
