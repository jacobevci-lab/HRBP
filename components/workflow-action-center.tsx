"use client";

import Link from "next/link";
import { AlertTriangle, BadgeDollarSign, BookOpenCheck, BriefcaseBusiness, CalendarCheck2, CheckCircle2, ClipboardCheck, Clock3, ExternalLink, FileClock, HeartHandshake, ReceiptText, RefreshCw, ShieldAlert, Target, TimerReset, UserMinus, UserPlus, UsersRound, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type ActionKind = "workflow" | "hr-service" | "employee-relations" | "documents" | "onboarding" | "offboarding" | "leave" | "time-attendance" | "compensation" | "payroll" | "benefits" | "performance" | "learning" | "development-plan" | "succession" | "recruiting" | "policies" | "workforce-planning" | "privacy" | "engagement";
type Urgency = "normal" | "warning" | "critical";
type Filter = "all" | "critical" | "overdue" | "due-soon" | ActionKind;

const allowedFilters = new Set<Filter>(["all", "critical", "overdue", "due-soon", "workflow", "hr-service", "employee-relations", "documents", "onboarding", "offboarding", "leave", "time-attendance", "compensation", "payroll", "benefits", "performance", "learning", "development-plan", "succession", "recruiting", "policies", "workforce-planning", "privacy", "engagement"]);

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
  secondaryAction?: null | {
    type: "reject-leave";
    requestId: string;
  } | {
    type: "reject-time";
    entryId: string;
  } | {
    type: "reject-compensation";
    changeId: string;
  } | {
    type: "return-requisition";
    requisitionId: string;
  } | {
    type: "return-offer";
    offerId: string;
  } | {
    type: "request-policy-changes";
    policyId: string;
  };
  action: null | {
    type: "complete-workflow";
    instanceId: string;
    taskId: string;
  } | {
    type: "approve-leave";
    requestId: string;
  } | {
    type: "approve-time";
    entryId: string;
  } | {
    type: "approve-compensation";
    changeId: string;
  } | {
    type: "apply-compensation";
    changeId: string;
  } | {
    type: "approve-payroll";
    runId: string;
  } | {
    type: "mark-payroll-paid";
    runId: string;
  } | {
    type: "approve-requisition";
    requisitionId: string;
  } | {
    type: "approve-offer";
    offerId: string;
  } | {
    type: "approve-policy";
    policyId: string;
  };
};

type ActionSummary = {
  total: number;
  overdue: number;
  dueSoon: number;
  critical: number;
  workflow: number;
  hrService: number;
  employeeRelations: number;
  documents: number;
  onboarding: number;
  offboarding: number;
  leave: number;
  timeAttendance: number;
  compensation: number;
  payroll: number;
  benefits: number;
  performance: number;
  learning: number;
  developmentPlans: number;
  succession: number;
  recruiting: number;
  policies: number;
  workforcePlanning: number;
  privacy: number;
  engagement: number;
};

const emptySummary: ActionSummary = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  critical: 0,
  workflow: 0,
  hrService: 0,
  employeeRelations: 0,
  documents: 0,
  onboarding: 0,
  offboarding: 0,
  leave: 0,
  timeAttendance: 0,
  compensation: 0,
  payroll: 0,
  benefits: 0,
  performance: 0,
  learning: 0,
  developmentPlans: 0,
  succession: 0,
  recruiting: 0,
  policies: 0,
  workforcePlanning: 0,
  privacy: 0,
  engagement: 0
};

type ActionQueueResponse = {
  data?: {
    items: LifecycleActionItem[];
    summary: ActionSummary;
    generatedAt: string;
  };
  error?: string;
};

async function acknowledgeResourceNotifications(resourceType: string, resourceId: string) {
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceType, resourceId, read: true })
    });
    if (response.ok) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch {
    // Notification acknowledgement is best-effort and must never roll back an
    // already accepted domain decision.
  }
}

async function acknowledgeTaskNotifications(taskId: string) {
  return acknowledgeResourceNotifications("WorkflowTask", taskId);
}

function actionNotificationSubject(item: LifecycleActionItem) {
  const action = item.action;
  if (action?.type === "approve-leave") return { resourceType: "LeaveRequest", resourceId: action.requestId };
  if (action?.type === "approve-time") return { resourceType: "TimeEntry", resourceId: action.entryId };
  if (action?.type === "approve-compensation" || action?.type === "apply-compensation") return { resourceType: "CompensationChange", resourceId: action.changeId };
  if (action?.type === "approve-payroll" || action?.type === "mark-payroll-paid") return { resourceType: "PayrollRun", resourceId: action.runId };
  if (action?.type === "approve-requisition") return { resourceType: "Requisition", resourceId: action.requisitionId };
  if (action?.type === "approve-offer") return { resourceType: "Offer", resourceId: action.offerId };
  if (action?.type === "approve-policy") return { resourceType: "PolicyRecord", resourceId: action.policyId };

  const secondary = item.secondaryAction;
  if (secondary?.type === "reject-leave") return { resourceType: "LeaveRequest", resourceId: secondary.requestId };
  if (secondary?.type === "reject-time") return { resourceType: "TimeEntry", resourceId: secondary.entryId };
  if (secondary?.type === "reject-compensation") return { resourceType: "CompensationChange", resourceId: secondary.changeId };
  if (secondary?.type === "return-requisition") return { resourceType: "Requisition", resourceId: secondary.requisitionId };
  if (secondary?.type === "return-offer") return { resourceType: "Offer", resourceId: secondary.offerId };
  if (secondary?.type === "request-policy-changes") return { resourceType: "PolicyRecord", resourceId: secondary.policyId };
  return null;
}

export function WorkflowActionCenter({ initialTaskId, initialInstanceId, initialFilter }: { initialTaskId?: string; initialInstanceId?: string; initialFilter?: string }) {
  const { locale } = useLocale();
  const [items, setItems] = useState<LifecycleActionItem[]>([]);
  const [summary, setSummary] = useState<ActionSummary>(emptySummary);
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
      setSummary(body.data?.summary ?? emptySummary);
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
    const handleLifecycleChange = () => void refresh();
    window.addEventListener("hrbp:lifecycle-actions-changed", handleLifecycleChange);
    return () => window.removeEventListener("hrbp:lifecycle-actions-changed", handleLifecycleChange);
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
    if (filter !== "all") return items.filter((item) => item.kind === filter);
    return items;
  }, [filter, items]);

  function quickActionCopy(item: LifecycleActionItem) {
    if (!item.action) return null;
    if (item.action.type === "complete-workflow") return {
      label: locale === "tr" ? "Tamamla" : "Complete",
      busy: locale === "tr" ? "İşleniyor…" : "Processing…",
      confirm: locale === "tr" ? `“${item.title}” görevini tamamlandı olarak işaretlemek istiyor musun?` : `Mark “${item.title}” as completed?`,
      success: locale === "tr" ? "Görev tamamlandı ve yaşam döngüsü bir sonraki adıma ilerletildi." : "Task completed and the lifecycle advanced to its next step."
    };
    if (item.action.type === "approve-leave") return {
      label: locale === "tr" ? "İzni onayla" : "Approve leave",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” kaydını onaylamak istiyor musun?` : `Approve “${item.title}”?`,
      success: locale === "tr" ? "İzin talebi onaylandı." : "Leave request approved."
    };
    if (item.action.type === "approve-time") return {
      label: locale === "tr" ? "Zamanı onayla" : "Approve time",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” kaydını onaylamak istiyor musun?` : `Approve “${item.title}”?`,
      success: locale === "tr" ? "Zaman kaydı onaylandı." : "Time entry approved."
    };
    if (item.action.type === "approve-compensation") return {
      label: locale === "tr" ? "Ücreti onayla" : "Approve compensation",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? "Bu ücret değişikliği için bağımsız onayı vermek istiyor musun?" : "Give independent approval for this compensation change?",
      success: locale === "tr" ? "Ücret değişikliği bağımsız olarak onaylandı." : "Compensation change independently approved."
    };
    if (item.action.type === "apply-compensation") return {
      label: locale === "tr" ? "Ücreti uygula" : "Apply compensation",
      busy: locale === "tr" ? "Uygulanıyor…" : "Applying…",
      confirm: locale === "tr" ? "Onaylı ücret değişikliğini çalışan kaydına uygulamak istiyor musun?" : "Apply the approved compensation change to the employee record?",
      success: locale === "tr" ? "Onaylı ücret değişikliği uygulandı." : "Approved compensation change applied."
    };
    if (item.action.type === "approve-payroll") return {
      label: locale === "tr" ? "Bordroyu onayla" : "Approve payroll",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? "Bu bordro çalıştırmasını bağımsız olarak onaylamak istiyor musun?" : "Independently approve this payroll run?",
      success: locale === "tr" ? "Bordro çalıştırması onaylandı." : "Payroll run approved."
    };
    if (item.action.type === "approve-requisition") return {
      label: locale === "tr" ? "Talebi onayla" : "Approve requisition",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” kaydını onaylayıp açmak istiyor musun?` : `Approve and open “${item.title}”?`,
      success: locale === "tr" ? "İşe alım talebi onaylandı ve açıldı." : "Requisition approved and opened."
    };
    if (item.action.type === "approve-offer") return {
      label: locale === "tr" ? "Teklifi onayla" : "Approve offer",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” kaydını onaylayıp gönderime çıkarmak istiyor musun?` : `Approve and release “${item.title}” for sending?`,
      success: locale === "tr" ? "Teklif bağımsız olarak onaylandı." : "Offer independently approved."
    };
    if (item.action.type === "approve-policy") return {
      label: locale === "tr" ? "Politikayı onayla" : "Approve policy",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” kaydı için bağımsız onayı vermek istiyor musun?` : `Give independent approval for “${item.title}”?`,
      success: locale === "tr" ? "Politika bağımsız olarak onaylandı." : "Policy independently approved."
    };
    return {
      label: locale === "tr" ? "Ödendi işaretle" : "Mark paid",
      busy: locale === "tr" ? "İşleniyor…" : "Processing…",
      confirm: locale === "tr" ? "Onaylı bordro çalıştırmasını ödendi olarak işaretlemek istiyor musun?" : "Mark the approved payroll run as paid?",
      success: locale === "tr" ? "Bordro çalıştırması ödendi olarak işaretlendi." : "Payroll run marked paid."
    };
  }

  function secondaryActionCopy(item: LifecycleActionItem) {
    if (!item.secondaryAction) return null;
    if (item.secondaryAction.type === "reject-leave") return {
      label: locale === "tr" ? "Reddet" : "Reject",
      busy: locale === "tr" ? "Reddediliyor…" : "Rejecting…",
      confirm: locale === "tr" ? `“${item.title}” kaydını reddetmek istiyor musun?` : `Reject “${item.title}”?`,
      success: locale === "tr" ? "İzin talebi reddedildi." : "Leave request rejected."
    };
    if (item.secondaryAction.type === "reject-time") return {
      label: locale === "tr" ? "Reddet" : "Reject",
      busy: locale === "tr" ? "Reddediliyor…" : "Rejecting…",
      confirm: locale === "tr" ? `“${item.title}” kaydını reddetmek istiyor musun?` : `Reject “${item.title}”?`,
      success: locale === "tr" ? "Zaman kaydı reddedildi." : "Time entry rejected."
    };
    if (item.secondaryAction.type === "return-requisition") return {
      label: locale === "tr" ? "Taslağa döndür" : "Return to draft",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını düzeltme için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for revision?`,
      success: locale === "tr" ? "İşe alım talebi taslağa döndürüldü." : "Requisition returned to draft."
    };
    if (item.secondaryAction.type === "return-offer") return {
      label: locale === "tr" ? "Taslağa döndür" : "Return to draft",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını düzeltme için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for revision?`,
      success: locale === "tr" ? "Teklif taslağa döndürüldü." : "Offer returned to draft."
    };
    if (item.secondaryAction.type === "request-policy-changes") return {
      label: locale === "tr" ? "Düzeltme iste" : "Request changes",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını kontrollü revizyon için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for controlled revision?`,
      success: locale === "tr" ? "Politika düzeltme için taslağa döndürüldü." : "Policy returned to draft for revision."
    };
    return {
      label: locale === "tr" ? "Reddet" : "Reject",
      busy: locale === "tr" ? "Reddediliyor…" : "Rejecting…",
      confirm: locale === "tr" ? "Bu ücret değişikliğini reddetmek istiyor musun?" : "Reject this compensation change?",
      success: locale === "tr" ? "Ücret değişikliği reddedildi." : "Compensation change rejected."
    };
  }

  async function executeSecondaryAction(item: LifecycleActionItem) {
    if (!item.secondaryAction) return;
    const copy = secondaryActionCopy(item);
    if (!copy || !window.confirm(copy.confirm)) return;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      let endpoint = "";
      let payload: Record<string, unknown> = {};
      if (item.secondaryAction.type === "reject-leave") {
        endpoint = `/api/leave/requests/${encodeURIComponent(item.secondaryAction.requestId)}/decision`;
        payload = { decision: "REJECTED" };
      } else if (item.secondaryAction.type === "reject-time") {
        endpoint = `/api/time/entries/${encodeURIComponent(item.secondaryAction.entryId)}/transition`;
        payload = { status: "REJECTED" };
      } else if (item.secondaryAction.type === "reject-compensation") {
        endpoint = `/api/compensation/changes/${encodeURIComponent(item.secondaryAction.changeId)}/decision`;
        payload = { decision: "REJECT" };
      } else if (item.secondaryAction.type === "return-requisition") {
        endpoint = `/api/recruiting/requisitions/${encodeURIComponent(item.secondaryAction.requisitionId)}/status`;
        payload = { status: "DRAFT" };
      } else if (item.secondaryAction.type === "return-offer") {
        endpoint = `/api/recruiting/offers/${encodeURIComponent(item.secondaryAction.offerId)}/status`;
        payload = { status: "DRAFT" };
      } else if (item.secondaryAction.type === "request-policy-changes") {
        endpoint = `/api/policies/${encodeURIComponent(item.secondaryAction.policyId)}/review`;
        payload = { action: "REQUEST_CHANGES" };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSuccess(copy.success);
      const notificationSubject = actionNotificationSubject(item);
      if (notificationSubject) await acknowledgeResourceNotifications(notificationSubject.resourceType, notificationSubject.resourceId);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === "tr" ? "Aksiyon tamamlanamadı." : "Action could not be completed."));
    } finally {
      setBusyId(null);
    }
  }

  async function executeQuickAction(item: LifecycleActionItem) {
    if (!item.action) return;
    const copy = quickActionCopy(item);
    if (!copy || !window.confirm(copy.confirm)) return;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      let endpoint = "";
      let payload: Record<string, unknown> = {};
      if (item.action.type === "complete-workflow") {
        endpoint = `/api/workflows/instances/${encodeURIComponent(item.action.instanceId)}/tasks/${encodeURIComponent(item.action.taskId)}/complete`;
        payload = { result: { source: "lifecycle-action-center", completedAt: new Date().toISOString() } };
      } else if (item.action.type === "approve-leave") {
        endpoint = `/api/leave/requests/${encodeURIComponent(item.action.requestId)}/decision`;
        payload = { decision: "APPROVED" };
      } else if (item.action.type === "approve-time") {
        endpoint = `/api/time/entries/${encodeURIComponent(item.action.entryId)}/transition`;
        payload = { status: "APPROVED" };
      } else if (item.action.type === "approve-compensation") {
        endpoint = `/api/compensation/changes/${encodeURIComponent(item.action.changeId)}/decision`;
        payload = { decision: "APPROVE" };
      } else if (item.action.type === "apply-compensation") {
        endpoint = `/api/compensation/changes/${encodeURIComponent(item.action.changeId)}/decision`;
        payload = { decision: "APPLY" };
      } else if (item.action.type === "approve-payroll") {
        endpoint = `/api/payroll/runs/${encodeURIComponent(item.action.runId)}/transition`;
        payload = { status: "APPROVED" };
      } else if (item.action.type === "mark-payroll-paid") {
        endpoint = `/api/payroll/runs/${encodeURIComponent(item.action.runId)}/transition`;
        payload = { status: "PAID" };
      } else if (item.action.type === "approve-requisition") {
        endpoint = `/api/recruiting/requisitions/${encodeURIComponent(item.action.requisitionId)}/status`;
        payload = { status: "OPEN" };
      } else if (item.action.type === "approve-offer") {
        endpoint = `/api/recruiting/offers/${encodeURIComponent(item.action.offerId)}/status`;
        payload = { status: "SENT" };
      } else if (item.action.type === "approve-policy") {
        endpoint = `/api/policies/${encodeURIComponent(item.action.policyId)}/review`;
        payload = { action: "APPROVE" };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSuccess(copy.success);
      if (item.action.type === "complete-workflow") {
        await acknowledgeTaskNotifications(item.action.taskId);
      } else {
        const notificationSubject = actionNotificationSubject(item);
        if (notificationSubject) await acknowledgeResourceNotifications(notificationSubject.resourceType, notificationSubject.resourceId);
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (locale === "tr" ? "Aksiyon tamamlanamadı." : "Action could not be completed."));
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
    if (kind === "documents") return locale === "tr" ? "Dokümanlar" : "Documents";
    if (kind === "onboarding") return locale === "tr" ? "İşe Başlatma" : "Onboarding";
    if (kind === "offboarding") return locale === "tr" ? "İşten Ayrılış" : "Offboarding";
    if (kind === "leave") return locale === "tr" ? "İzin" : "Leave";
    if (kind === "time-attendance") return locale === "tr" ? "Zaman & Devam" : "Time & Attendance";
    if (kind === "compensation") return locale === "tr" ? "Ücretlendirme" : "Compensation";
    if (kind === "payroll") return locale === "tr" ? "Bordro" : "Payroll";
    if (kind === "benefits") return locale === "tr" ? "Yan Haklar" : "Benefits";
    if (kind === "performance") return locale === "tr" ? "Performans" : "Performance";
    if (kind === "learning") return locale === "tr" ? "Eğitim" : "Learning";
    if (kind === "development-plan") return locale === "tr" ? "Gelişim Planı" : "Development Plan";
    if (kind === "succession") return locale === "tr" ? "Yedekleme" : "Succession";
    if (kind === "recruiting") return locale === "tr" ? "İşe Alım" : "Recruiting";
    if (kind === "policies") return locale === "tr" ? "Politikalar" : "Policies";
    if (kind === "workforce-planning") return locale === "tr" ? "İşgücü Planlama" : "Workforce Planning";
    if (kind === "privacy") return locale === "tr" ? "Gizlilik" : "Privacy";
    if (kind === "engagement") return locale === "tr" ? "Bağlılık" : "Engagement";
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
          <p>{locale === "tr" ? "İş akışlarını, işe alım onaylarını, işe başlatma ve işten ayrılış kontrollerini, İK hizmet taleplerini, kısıtlı çalışan ilişkileri aksiyonlarını, doküman yaşam döngüsünü, iş-ücret ve yan hak kontrollerini ve gelişim aksiyonlarını tek yetkili kuyrukta takip et." : "Track workflows, recruiting approvals, onboarding and offboarding controls, HR service requests, restricted employee-relations actions, document lifecycle, work-pay and benefits controls, and growth actions in one authorized queue."}</p>
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
        <button type="button" className={filter === "recruiting" ? "active" : ""} onClick={() => setFilter("recruiting")}><BriefcaseBusiness size={14}/>{locale === "tr" ? "İşe Alım" : "Recruiting"} <strong>{summary.recruiting}</strong></button>
        <button type="button" className={filter === "policies" ? "active" : ""} onClick={() => setFilter("policies")}><BookOpenCheck size={14}/>{locale === "tr" ? "Politikalar" : "Policies"} <strong>{summary.policies}</strong></button>
        <button type="button" className={filter === "workforce-planning" ? "active" : ""} onClick={() => setFilter("workforce-planning")}><Target size={14}/>{locale === "tr" ? "İşgücü Planlama" : "Workforce Planning"} <strong>{summary.workforcePlanning}</strong></button>
        <button type="button" className={filter === "privacy" ? "active" : ""} onClick={() => setFilter("privacy")}><ShieldAlert size={14}/>{locale === "tr" ? "Gizlilik" : "Privacy"} <strong>{summary.privacy}</strong></button>
        <button type="button" className={filter === "engagement" ? "active" : ""} onClick={() => setFilter("engagement")}><UsersRound size={14}/>{locale === "tr" ? "Bağlılık" : "Engagement"} <strong>{summary.engagement}</strong></button>
        <button type="button" className={filter === "hr-service" ? "active" : ""} onClick={() => setFilter("hr-service")}>{locale === "tr" ? "İK Hizmeti" : "HR Service"} <strong>{summary.hrService}</strong></button>
        <button type="button" className={filter === "employee-relations" ? "active" : ""} onClick={() => setFilter("employee-relations")}>{locale === "tr" ? "Çalışan İlişkileri" : "Employee Relations"} <strong>{summary.employeeRelations}</strong></button>
        <button type="button" className={filter === "documents" ? "active" : ""} onClick={() => setFilter("documents")}><FileClock size={14}/>{locale === "tr" ? "Dokümanlar" : "Documents"} <strong>{summary.documents}</strong></button>
        <button type="button" className={filter === "onboarding" ? "active" : ""} onClick={() => setFilter("onboarding")}><UserPlus size={14}/>{locale === "tr" ? "İşe Başlatma" : "Onboarding"} <strong>{summary.onboarding}</strong></button>
        <button type="button" className={filter === "offboarding" ? "active" : ""} onClick={() => setFilter("offboarding")}><UserMinus size={14}/>{locale === "tr" ? "İşten Ayrılış" : "Offboarding"} <strong>{summary.offboarding}</strong></button>
        <button type="button" className={filter === "leave" ? "active" : ""} onClick={() => setFilter("leave")}><CalendarCheck2 size={14}/>{locale === "tr" ? "İzin" : "Leave"} <strong>{summary.leave}</strong></button>
        <button type="button" className={filter === "time-attendance" ? "active" : ""} onClick={() => setFilter("time-attendance")}><TimerReset size={14}/>{locale === "tr" ? "Zaman" : "Time"} <strong>{summary.timeAttendance}</strong></button>
        <button type="button" className={filter === "compensation" ? "active" : ""} onClick={() => setFilter("compensation")}><BadgeDollarSign size={14}/>{locale === "tr" ? "Ücret" : "Compensation"} <strong>{summary.compensation}</strong></button>
        <button type="button" className={filter === "payroll" ? "active" : ""} onClick={() => setFilter("payroll")}><ReceiptText size={14}/>{locale === "tr" ? "Bordro" : "Payroll"} <strong>{summary.payroll}</strong></button>
        <button type="button" className={filter === "benefits" ? "active" : ""} onClick={() => setFilter("benefits")}><HeartHandshake size={14}/>{locale === "tr" ? "Yan Haklar" : "Benefits"} <strong>{summary.benefits}</strong></button>
        <button type="button" className={filter === "performance" ? "active" : ""} onClick={() => setFilter("performance")}><ClipboardCheck size={14}/>{locale === "tr" ? "Performans" : "Performance"} <strong>{summary.performance}</strong></button>
        <button type="button" className={filter === "learning" ? "active" : ""} onClick={() => setFilter("learning")}><BookOpenCheck size={14}/>{locale === "tr" ? "Eğitim" : "Learning"} <strong>{summary.learning}</strong></button>
        <button type="button" className={filter === "development-plan" ? "active" : ""} onClick={() => setFilter("development-plan")}><Target size={14}/>{locale === "tr" ? "Gelişim" : "Development"} <strong>{summary.developmentPlans}</strong></button>
        <button type="button" className={filter === "succession" ? "active" : ""} onClick={() => setFilter("succession")}><UsersRound size={14}/>{locale === "tr" ? "Yedekleme" : "Succession"} <strong>{summary.succession}</strong></button>
      </div>

      {error ? <div className="workflow-action-message error"><AlertTriangle size={15}/>{error}</div> : null}
      {success ? <div className="workflow-action-message success"><CheckCircle2 size={15}/>{success}</div> : null}

      <div className="workflow-action-table-wrap">
        <table className="workflow-action-table">
          <thead><tr><th>{locale === "tr" ? "Kaynak" : "Source"}</th><th>{locale === "tr" ? "Aksiyon" : "Action"}</th><th>{locale === "tr" ? "Konu" : "Subject"}</th><th>SLA</th><th>{locale === "tr" ? "Öncelik" : "Priority"}</th><th>{locale === "tr" ? "Durum" : "Status"}</th><th>{locale === "tr" ? "İşlem" : "Operation"}</th></tr></thead>
          <tbody>
            {loading && items.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty">{locale === "tr" ? "Aksiyon merkezi yükleniyor…" : "Loading action center…"}</td></tr> : null}
            {!loading && visibleItems.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty"><CheckCircle2 size={17}/>{locale === "tr" ? "Bu görünümde bekleyen aksiyon yok." : "No pending actions in this view."}</td></tr> : null}
            {visibleItems.map((item) => {
              const workflowAction = item.action?.type === "complete-workflow" ? item.action : null;
              const focused = item.kind === "workflow" && (workflowAction?.taskId === initialTaskId || workflowAction?.instanceId === initialInstanceId);
              return <tr key={item.id} id={`action-item-${item.id}`} data-workflow-instance={workflowAction?.instanceId} className={focused ? "focused" : undefined}>
                <td><span className={`workflow-source ${item.kind}`}>{sourceLabel(item.kind)}</span></td>
                <td><strong>{item.title}</strong><small>{item.subtitle}</small></td>
                <td><span>{item.subjectType}</span><small>{item.subjectId}</small></td>
                <td><span className={`workflow-due ${item.urgency}`}>{formatDate(item.dueAt)}</span></td>
                <td><span className={`workflow-urgency ${item.urgency}`}>{urgencyLabel(item.urgency)}</span></td>
                <td><span className="workflow-task-status">{item.status}</span></td>
                <td>{item.action ? <div className="workflow-row-actions"><button className="primary-button compact" type="button" disabled={busyId === item.id} onClick={() => void executeQuickAction(item)}>{busyId === item.id ? quickActionCopy(item)?.busy : quickActionCopy(item)?.label}</button>{item.secondaryAction ? <button className="secondary-button compact" type="button" disabled={busyId === item.id} onClick={() => void executeSecondaryAction(item)}>{busyId === item.id ? secondaryActionCopy(item)?.busy : secondaryActionCopy(item)?.label}</button> : null}</div> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
