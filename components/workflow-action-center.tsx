"use client";

import Link from "next/link";
import { AlertTriangle, BadgeDollarSign, BookOpenCheck, BriefcaseBusiness, CalendarCheck2, CheckCircle2, ClipboardCheck, Clock3, ExternalLink, FileClock, HeartHandshake, ReceiptText, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Target, TimerReset, UserMinus, UserPlus, UsersRound, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { LeaveDecisionButtons, type LeaveDecisionRegistry } from "@/components/leave-decision-buttons";
import { TimeDecisionButtons, type TimeDecisionRegistry } from "@/components/time-decision-buttons";
import { CompensationActionButtons, type CompensationAttemptRegistry } from "@/components/compensation-action-buttons";
import { PayrollActionButton, type PayrollAttemptRegistry } from "@/components/payroll-action-button";
import { actionCenterLeaveControl, isActionCenterLeaveItem } from "@/lib/action-center-leave-control";
import { actionCenterTimeControl, isActionCenterTimeItem } from "@/lib/action-center-time-control";
import { actionCenterCompensationControl, isActionCenterCompensationItem } from "@/lib/action-center-compensation-control";
import { actionCenterPayrollControl, isActionCenterPayrollItem } from "@/lib/action-center-payroll-control";
import { createActionQueueLoader, queueFailureMessage, actionQueueSourceHealth, sourceHealthMessage, type QueueSourceHealth } from "@/lib/action-center-queue";
import type { ActionKind, Urgency, LifecycleActionItem, ActionSummary } from "@/lib/action-center-queue-types";

type Filter = "all" | "critical" | "overdue" | "due-soon" | ActionKind;

const allowedFilters = new Set<Filter>(["all", "critical", "overdue", "due-soon", "workflow", "hr-service", "employee-relations", "documents", "onboarding", "offboarding", "leave", "time-attendance", "compensation", "payroll", "benefits", "performance", "learning", "development-plan", "succession", "recruiting", "policies", "workforce-planning", "privacy", "engagement"]);

function normalizeFilter(value?: string): Filter {
  return value && allowedFilters.has(value as Filter) ? value as Filter : "all";
}

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
  if (action?.type === "approve-workforce-scenario") return { resourceType: "WorkforceScenario", resourceId: action.scenarioId };
  if (action?.type === "activate-workflow-definition") return { resourceType: "WorkflowDefinition", resourceId: action.definitionId };
  if (action?.type === "open-engagement-campaign" || action?.type === "close-engagement-campaign") return { resourceType: "SurveyCampaign", resourceId: action.campaignId };
  if (action?.type === "begin-dsr-verification" || action?.type === "verify-dsr" || action?.type === "wait-dsr" || action?.type === "resume-dsr") return { resourceType: "DataSubjectRequest", resourceId: action.dsrId };
  if (action?.type === "start-privacy-assessment" || action?.type === "wait-privacy-assessment" || action?.type === "resume-privacy-assessment") return { resourceType: "PrivacyRiskAssessment", resourceId: action.assessmentId };
  if (action?.type === "advance-hr-service") return { resourceType: "HRServiceRequest", resourceId: action.requestId };
  if (action?.type === "advance-onboarding-task") return { resourceType: "OnboardingTask", resourceId: action.taskId };
  if (action?.type === "activate-benefit-enrollment") return { resourceType: "BenefitEnrollment", resourceId: action.enrollmentId };
  if (action?.type === "start-learning-assignment") return { resourceType: "LearningAssignment", resourceId: action.assignmentId };
  if (action?.type === "start-performance-self-review") return { resourceType: "PerformanceReview", resourceId: action.reviewId };
  if (action?.type === "activate-onboarding-employment") return { resourceType: "OnboardingPlan", resourceId: action.planId };
  if (action?.type === "advance-offboarding-task") return { resourceType: "SeparationTask", resourceId: action.taskId };
  if (action?.type === "start-er-corrective-action") return { resourceType: "CaseAction", resourceId: action.actionId };
  if (action?.type === "activate-development-plan") return { resourceType: "DevelopmentPlan", resourceId: action.planId };
  if (action?.type === "start-er-appeal-review") return { resourceType: "CaseAppeal", resourceId: action.appealId };

  const secondary = item.secondaryAction;
  if (secondary?.type === "reject-leave") return { resourceType: "LeaveRequest", resourceId: secondary.requestId };
  if (secondary?.type === "reject-time") return { resourceType: "TimeEntry", resourceId: secondary.entryId };
  if (secondary?.type === "reject-compensation") return { resourceType: "CompensationChange", resourceId: secondary.changeId };
  if (secondary?.type === "return-requisition") return { resourceType: "Requisition", resourceId: secondary.requisitionId };
  if (secondary?.type === "return-offer") return { resourceType: "Offer", resourceId: secondary.offerId };
  if (secondary?.type === "request-policy-changes") return { resourceType: "PolicyRecord", resourceId: secondary.policyId };
  if (secondary?.type === "request-workforce-changes") return { resourceType: "WorkforceScenario", resourceId: secondary.scenarioId };
  if (secondary?.type === "retire-workflow-definition") return { resourceType: "WorkflowDefinition", resourceId: secondary.definitionId };
  if (secondary?.type === "return-engagement-draft") return { resourceType: "SurveyCampaign", resourceId: secondary.campaignId };
  return null;
}

export function WorkflowActionCenter({ initialTaskId, initialInstanceId, initialFilter }: { initialTaskId?: string; initialInstanceId?: string; initialFilter?: string }) {
  const { locale } = useLocale();
  const [items, setItems] = useState<LifecycleActionItem[]>([]);
  const [summary, setSummary] = useState<ActionSummary>(emptySummary);
  const [filter, setFilter] = useState<Filter>(() => normalizeFilter(initialFilter));
  const [query, setQuery] = useState("");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const leaveAttempts = useRef<LeaveDecisionRegistry>(new Map());
  const timeAttempts = useRef<TimeDecisionRegistry>(new Map());
  const compensationAttempts = useRef<CompensationAttemptRegistry>(new Map());
  const payrollAttempts = useRef<PayrollAttemptRegistry>(new Map());

  const queueLoader = useRef<ReturnType<typeof createActionQueueLoader> | null>(null);
  const quickActionBusy = useRef(false);
  const [queueFailure, setQueueFailure] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [sourceHealth, setSourceHealth] = useState<QueueSourceHealth | null>(null);
  const hasIncompleteSources = sourceHealth !== null && sourceHealth.state !== "reported";

  const refresh = useCallback(async () => {
    queueLoader.current ??= createActionQueueLoader();
    setLoading(true);
    setQueueFailure(false);
    setError(null);
    const result = await queueLoader.current.load();
    if (result.outcome === "ignored") return;
    if (result.outcome === "loaded") {
      setItems(result.data.items);
      setSummary(result.data.summary);
      setLoadedAt(result.data.generatedAt);
      setSourceHealth(actionQueueSourceHealth(result.data));
    } else {
      setQueueFailure(true);
      setError(queueFailureMessage(result.reason, locale));
      // Do not retain protected records after an explicit access failure.
      if (result.reason === "session" || result.reason === "access") {
        setItems([]);
        setSummary(emptySummary);
        setLoadedAt(null);
        setSourceHealth(null);
      }
    }
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void refresh();
    return () => queueLoader.current?.invalidate();
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
    let filtered = items;
    if (filter === "critical") filtered = filtered.filter((item) => item.urgency === "critical");
    else if (filter === "overdue") filtered = filtered.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now);
    else if (filter === "due-soon") filtered = filtered.filter((item) => {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt).getTime();
      return due >= now && due <= soon;
    });
    else if (filter !== "all") filtered = filtered.filter((item) => item.kind === filter);

    if (actionableOnly) filtered = filtered.filter((item) => Boolean(item.action || item.secondaryAction));

    const normalizedQuery = query.trim().toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US");
    if (normalizedQuery) {
      filtered = filtered.filter((item) => [
        item.title,
        item.subtitle,
        item.status,
        item.subjectType,
        item.subjectId,
        sourceLabel(item.kind)
      ].some((value) => value.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US").includes(normalizedQuery)));
    }

    return filtered;
  }, [actionableOnly, filter, items, locale, query]);

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
    if (item.action.type === "approve-workforce-scenario") return {
      label: locale === "tr" ? "Planı onayla" : "Approve plan",
      busy: locale === "tr" ? "Onaylanıyor…" : "Approving…",
      confirm: locale === "tr" ? `“${item.title}” senaryosu için bağımsız onayı vermek istiyor musun?` : `Give independent approval for “${item.title}”?`,
      success: locale === "tr" ? "İşgücü planı bağımsız olarak onaylandı." : "Workforce plan independently approved."
    };
    if (item.action.type === "activate-workflow-definition") return {
      label: locale === "tr" ? "Tanımı aktifleştir" : "Activate definition",
      busy: locale === "tr" ? "Aktifleştiriliyor…" : "Activating…",
      confirm: locale === "tr" ? `“${item.title}” tanımını bağımsız olarak aktifleştirmek istiyor musun?` : `Independently activate “${item.title}”?`,
      success: locale === "tr" ? "İş akışı tanımı aktifleştirildi." : "Workflow definition activated."
    };
    if (item.action.type === "open-engagement-campaign") return {
      label: locale === "tr" ? "Kampanyayı aç" : "Open campaign",
      busy: locale === "tr" ? "Açılıyor…" : "Opening…",
      confirm: locale === "tr" ? `“${item.title}” kampanyasını açmak istiyor musun?` : `Open “${item.title}”?`,
      success: locale === "tr" ? "Bağlılık kampanyası açıldı." : "Engagement campaign opened."
    };
    if (item.action.type === "close-engagement-campaign") return {
      label: locale === "tr" ? "Kampanyayı kapat" : "Close campaign",
      busy: locale === "tr" ? "Kapatılıyor…" : "Closing…",
      confirm: locale === "tr" ? `“${item.title}” kampanyasını kapatmak istiyor musun?` : `Close “${item.title}”?`,
      success: locale === "tr" ? "Bağlılık kampanyası kapatıldı." : "Engagement campaign closed."
    };
    if (item.action.type === "begin-dsr-verification") return {
      label: locale === "tr" ? "Kimlik doğrulamayı başlat" : "Begin verification",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” için kimlik doğrulama aşamasını başlatmak istiyor musun?` : `Begin identity verification for “${item.title}”?`,
      success: locale === "tr" ? "DSR kimlik doğrulama aşamasına alındı." : "DSR moved to identity verification."
    };
    if (item.action.type === "verify-dsr") return {
      label: locale === "tr" ? "Kimliği doğrula" : "Verify identity",
      busy: locale === "tr" ? "Doğrulanıyor…" : "Verifying…",
      confirm: locale === "tr" ? `“${item.title}” kaydında kimliğin doğrulandığını onaylıyor musun?` : `Confirm identity verification for “${item.title}”?`,
      success: locale === "tr" ? "DSR kimliği doğrulandı ve işleme alındı." : "DSR identity verified and moved in progress."
    };
    if (item.action.type === "wait-dsr") return {
      label: locale === "tr" ? "Beklemeye al" : "Put on hold",
      busy: locale === "tr" ? "Güncelleniyor…" : "Updating…",
      confirm: locale === "tr" ? `“${item.title}” kaydını beklemeye almak istiyor musun?` : `Put “${item.title}” on hold?`,
      success: locale === "tr" ? "DSR beklemeye alındı." : "DSR put on hold."
    };
    if (item.action.type === "resume-dsr") return {
      label: locale === "tr" ? "Devam ettir" : "Resume",
      busy: locale === "tr" ? "Devam ettiriliyor…" : "Resuming…",
      confirm: locale === "tr" ? `“${item.title}” kaydını yeniden işleme almak istiyor musun?` : `Resume “${item.title}”?`,
      success: locale === "tr" ? "DSR yeniden işleme alındı." : "DSR resumed."
    };
    if (item.action.type === "start-privacy-assessment") return {
      label: locale === "tr" ? "Değerlendirmeyi başlat" : "Start assessment",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” değerlendirmesini başlatmak istiyor musun?` : `Start “${item.title}”?`,
      success: locale === "tr" ? "Gizlilik değerlendirmesi başlatıldı." : "Privacy assessment started."
    };
    if (item.action.type === "wait-privacy-assessment") return {
      label: locale === "tr" ? "Beklemeye al" : "Put on hold",
      busy: locale === "tr" ? "Güncelleniyor…" : "Updating…",
      confirm: locale === "tr" ? `“${item.title}” değerlendirmesini beklemeye almak istiyor musun?` : `Put “${item.title}” on hold?`,
      success: locale === "tr" ? "Gizlilik değerlendirmesi beklemeye alındı." : "Privacy assessment put on hold."
    };
    if (item.action.type === "resume-privacy-assessment") return {
      label: locale === "tr" ? "Değerlendirmeye devam et" : "Resume assessment",
      busy: locale === "tr" ? "Devam ettiriliyor…" : "Resuming…",
      confirm: locale === "tr" ? `“${item.title}” değerlendirmesine devam etmek istiyor musun?` : `Resume “${item.title}”?`,
      success: locale === "tr" ? "Gizlilik değerlendirmesi yeniden işleme alındı." : "Privacy assessment resumed."
    };
    if (item.action.type === "advance-hr-service") return {
      label: item.action.status === "TRIAGE" ? (locale === "tr" ? "Triyaja al" : "Move to triage") : (locale === "tr" ? "İşleme al" : "Start work"),
      busy: locale === "tr" ? "Güncelleniyor…" : "Updating…",
      confirm: locale === "tr" ? `“${item.title}” talebini ${item.action.status === "TRIAGE" ? "triyaja" : "işleme"} almak istiyor musun?` : `Move “${item.title}” to ${item.action.status === "TRIAGE" ? "triage" : "in progress"}?`,
      success: item.action.status === "TRIAGE" ? (locale === "tr" ? "İK hizmet talebi triyaja alındı." : "HR service request moved to triage.") : (locale === "tr" ? "İK hizmet talebi işleme alındı." : "HR service request moved in progress.")
    };
    if (item.action.type === "advance-onboarding-task") return {
      label: item.action.status === "COMPLETED" ? (locale === "tr" ? "Görevi tamamla" : "Complete task") : (locale === "tr" ? "Görevi başlat" : "Start task"),
      busy: locale === "tr" ? "Güncelleniyor…" : "Updating…",
      confirm: locale === "tr" ? `“${item.title}” görevini ${item.action.status === "COMPLETED" ? "tamamlamak" : "işleme almak"} istiyor musun?` : `${item.action.status === "COMPLETED" ? "Complete" : "Start"} “${item.title}”?`,
      success: item.action.status === "COMPLETED" ? (locale === "tr" ? "Onboarding görevi tamamlandı." : "Onboarding task completed.") : (locale === "tr" ? "Onboarding görevi işleme alındı." : "Onboarding task moved in progress.")
    };
    if (item.action.type === "activate-benefit-enrollment") return {
      label: locale === "tr" ? "Yan hakkı aktifleştir" : "Activate benefit",
      busy: locale === "tr" ? "Aktifleştiriliyor…" : "Activating…",
      confirm: locale === "tr" ? `“${item.title}” seçimini aktif kapsama almak istiyor musun?` : `Activate “${item.title}” coverage?`,
      success: locale === "tr" ? "Yan hak seçimi aktif kapsama alındı." : "Benefit enrollment activated."
    };
    if (item.action.type === "start-learning-assignment") return {
      label: locale === "tr" ? "Eğitime başla" : "Start learning",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” eğitimini devam ediyor durumuna almak istiyor musun?` : `Start “${item.title}” learning?`,
      success: locale === "tr" ? "Eğitim devam ediyor durumuna alındı." : "Learning assignment moved in progress."
    };
    if (item.action.type === "start-performance-self-review") return {
      label: locale === "tr" ? "Öz değerlendirmeyi başlat" : "Start self review",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” öz değerlendirmesini başlatmak istiyor musun?` : `Start “${item.title}” self review?`,
      success: locale === "tr" ? "Öz değerlendirme başlatıldı." : "Self review started."
    };
    if (item.action.type === "activate-onboarding-employment") return {
      label: locale === "tr" ? "Çalışanı aktifleştir" : "Activate employee",
      busy: locale === "tr" ? "Aktifleştiriliyor…" : "Activating…",
      confirm: locale === "tr" ? `“${item.title}” için onboarding devrini tamamlayıp istihdamı ACTIVE yapmak istiyor musun?` : `Complete the onboarding handoff and activate employment for “${item.title}”?`,
      success: locale === "tr" ? "Onboarding devri tamamlandı ve çalışan aktifleştirildi." : "Onboarding handoff completed and employment activated."
    };
    if (item.action.type === "advance-offboarding-task") return {
      label: item.action.status === "COMPLETED" ? (locale === "tr" ? "Görevi tamamla" : "Complete task") : (locale === "tr" ? "Görevi başlat" : "Start task"),
      busy: locale === "tr" ? "Güncelleniyor…" : "Updating…",
      confirm: locale === "tr" ? `“${item.title}” görevini ${item.action.status === "COMPLETED" ? "tamamlamak" : "işleme almak"} istiyor musun?` : `${item.action.status === "COMPLETED" ? "Complete" : "Start"} “${item.title}”?`,
      success: item.action.status === "COMPLETED" ? (locale === "tr" ? "Offboarding görevi tamamlandı." : "Offboarding task completed.") : (locale === "tr" ? "Offboarding görevi işleme alındı." : "Offboarding task moved in progress.")
    };
    if (item.action.type === "start-er-corrective-action") return {
      label: locale === "tr" ? "Aksiyonu başlat" : "Start action",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” düzeltici aksiyonunu işleme almak istiyor musun?` : `Start corrective action “${item.title}”?`,
      success: locale === "tr" ? "Düzeltici aksiyon işleme alındı." : "Corrective action moved in progress."
    };
    if (item.action.type === "activate-development-plan") return {
      label: locale === "tr" ? "Planı aktifleştir" : "Activate plan",
      busy: locale === "tr" ? "Aktifleştiriliyor…" : "Activating…",
      confirm: locale === "tr" ? `“${item.title}” gelişim planını aktifleştirmek istiyor musun?` : `Activate development plan “${item.title}”?`,
      success: locale === "tr" ? "Gelişim planı aktifleştirildi." : "Development plan activated."
    };
    if (item.action.type === "start-er-appeal-review") return {
      label: locale === "tr" ? "İtiraz incelemesini başlat" : "Start appeal review",
      busy: locale === "tr" ? "Başlatılıyor…" : "Starting…",
      confirm: locale === "tr" ? `“${item.title}” için itiraz incelemesini başlatmak istiyor musun?` : `Start review for “${item.title}”?`,
      success: locale === "tr" ? "İtiraz incelemesi başlatıldı." : "Appeal review started."
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
    if (item.secondaryAction.type === "return-requisition") return {
      label: locale === "tr" ? "Taslağa döndür" : "Return to draft",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını düzeltme için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for revision?`,
      success: locale === "tr" ? "İşe alım talebi taslağa döndürüldü." : "Requisition returned to draft."
    };
    if (item.secondaryAction.type === "return-offer") return {
      label: locale === "tr" ? "Taslağa döndür" : "Return to draft",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını düzeltme için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft?`,
      success: locale === "tr" ? "Teklif taslağa döndürüldü." : "Offer returned to draft."
    };
    if (item.secondaryAction.type === "request-policy-changes") return {
      label: locale === "tr" ? "Düzeltme iste" : "Request changes",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kaydını kontrollü revizyon için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for controlled revision?`,
      success: locale === "tr" ? "Politika düzeltme için taslağa döndürüldü." : "Policy returned to draft for revision."
    };
    if (item.secondaryAction.type === "request-workforce-changes") return {
      label: locale === "tr" ? "Düzeltme iste" : "Request changes",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” senaryosunu kontrollü revizyon için taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft for controlled revision?`,
      success: locale === "tr" ? "İşgücü planı düzeltme için taslağa döndürüldü." : "Workforce plan returned to draft for revision."
    };
    if (item.secondaryAction.type === "retire-workflow-definition") return {
      label: locale === "tr" ? "Taslağı emekliye ayır" : "Retire draft",
      busy: locale === "tr" ? "Emekliye ayrılıyor…" : "Retiring…",
      confirm: locale === "tr" ? `“${item.title}” taslağını emekliye ayırmak istiyor musun?` : `Retire “${item.title}” draft?`,
      success: locale === "tr" ? "İş akışı taslağı emekliye ayrıldı." : "Workflow definition draft retired."
    };
    if (item.secondaryAction.type === "return-engagement-draft") return {
      label: locale === "tr" ? "Taslağa döndür" : "Return to draft",
      busy: locale === "tr" ? "Döndürülüyor…" : "Returning…",
      confirm: locale === "tr" ? `“${item.title}” kampanyasını taslağa döndürmek istiyor musun?` : `Return “${item.title}” to draft?`,
      success: locale === "tr" ? "Bağlılık kampanyası taslağa döndürüldü." : "Engagement campaign returned to draft."
    };
    return {
      label: locale === "tr" ? "Reddet" : "Reject",
      busy: locale === "tr" ? "Reddediliyor…" : "Rejecting…",
      confirm: locale === "tr" ? "Bu ücret değişikliğini reddetmek istiyor musun?" : "Reject this compensation change?",
      success: locale === "tr" ? "Ücret değişikliği reddedildi." : "Compensation change rejected."
    };
  }

  async function executeSecondaryAction(item: LifecycleActionItem) {
    if (!item.secondaryAction || isActionCenterLeaveItem(item) || isActionCenterTimeItem(item) || isActionCenterCompensationItem(item) || isActionCenterPayrollItem(item) || !queueLoader.current?.ready || quickActionBusy.current || loading || error !== null) return;
    const copy = secondaryActionCopy(item);
    if (!copy || !window.confirm(copy.confirm)) return;
    if (!queueLoader.current?.ready || quickActionBusy.current) return;
    quickActionBusy.current = true;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      let endpoint = "";
      let payload: Record<string, unknown> = {};
      if (item.secondaryAction.type === "return-requisition") {
        endpoint = `/api/recruiting/requisitions/${encodeURIComponent(item.secondaryAction.requisitionId)}/status`;
        payload = { status: "DRAFT" };
      } else if (item.secondaryAction.type === "return-offer") {
        endpoint = `/api/recruiting/offers/${encodeURIComponent(item.secondaryAction.offerId)}/status`;
        payload = { status: "DRAFT" };
      } else if (item.secondaryAction.type === "request-policy-changes") {
        endpoint = `/api/policies/${encodeURIComponent(item.secondaryAction.policyId)}/review`;
        payload = { action: "REQUEST_CHANGES" };
      } else if (item.secondaryAction.type === "request-workforce-changes") {
        endpoint = `/api/workforce-planning/scenarios/${encodeURIComponent(item.secondaryAction.scenarioId)}/review`;
        payload = { action: "REQUEST_CHANGES" };
      } else if (item.secondaryAction.type === "retire-workflow-definition") {
        endpoint = `/api/workflows/definitions/${encodeURIComponent(item.secondaryAction.definitionId)}/lifecycle`;
        payload = { action: "RETIRE" };
      } else if (item.secondaryAction.type === "return-engagement-draft") {
        endpoint = `/api/engagement/campaigns/${encodeURIComponent(item.secondaryAction.campaignId)}/lifecycle`;
        payload = { action: "RETURN_DRAFT" };
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
      quickActionBusy.current = false;
      setBusyId(null);
    }
  }

  async function executeQuickAction(item: LifecycleActionItem) {
    if (!item.action || isActionCenterLeaveItem(item) || isActionCenterTimeItem(item) || isActionCenterCompensationItem(item) || isActionCenterPayrollItem(item) || !queueLoader.current?.ready || quickActionBusy.current || loading || error !== null) return;
    const copy = quickActionCopy(item);
    if (!copy || !window.confirm(copy.confirm)) return;
    if (!queueLoader.current?.ready || quickActionBusy.current) return;
    quickActionBusy.current = true;

    setBusyId(item.id);
    setError(null);
    setSuccess(null);
    try {
      let endpoint = "";
      let payload: Record<string, unknown> = {};
      if (item.action.type === "complete-workflow") {
        endpoint = `/api/workflows/instances/${encodeURIComponent(item.action.instanceId)}/tasks/${encodeURIComponent(item.action.taskId)}/complete`;
        payload = { result: { source: "lifecycle-action-center", completedAt: new Date().toISOString() } };
      } else if (item.action.type === "approve-requisition") {
        endpoint = `/api/recruiting/requisitions/${encodeURIComponent(item.action.requisitionId)}/status`;
        payload = { status: "OPEN" };
      } else if (item.action.type === "approve-offer") {
        endpoint = `/api/recruiting/offers/${encodeURIComponent(item.action.offerId)}/status`;
        payload = { status: "SENT" };
      } else if (item.action.type === "approve-policy") {
        endpoint = `/api/policies/${encodeURIComponent(item.action.policyId)}/review`;
        payload = { action: "APPROVE" };
      } else if (item.action.type === "approve-workforce-scenario") {
        endpoint = `/api/workforce-planning/scenarios/${encodeURIComponent(item.action.scenarioId)}/review`;
        payload = { action: "APPROVE" };
      } else if (item.action.type === "activate-workflow-definition") {
        endpoint = `/api/workflows/definitions/${encodeURIComponent(item.action.definitionId)}/lifecycle`;
        payload = { action: "ACTIVATE" };
      } else if (item.action.type === "open-engagement-campaign") {
        endpoint = `/api/engagement/campaigns/${encodeURIComponent(item.action.campaignId)}/lifecycle`;
        payload = { action: "OPEN" };
      } else if (item.action.type === "close-engagement-campaign") {
        endpoint = `/api/engagement/campaigns/${encodeURIComponent(item.action.campaignId)}/lifecycle`;
        payload = { action: "CLOSE" };
      } else if (item.action.type === "begin-dsr-verification") {
        endpoint = `/api/privacy/dsrs/${encodeURIComponent(item.action.dsrId)}/lifecycle`;
        payload = { action: "BEGIN_VERIFICATION" };
      } else if (item.action.type === "verify-dsr") {
        endpoint = `/api/privacy/dsrs/${encodeURIComponent(item.action.dsrId)}/lifecycle`;
        payload = { action: "VERIFY" };
      } else if (item.action.type === "wait-dsr") {
        endpoint = `/api/privacy/dsrs/${encodeURIComponent(item.action.dsrId)}/lifecycle`;
        payload = { action: "WAIT" };
      } else if (item.action.type === "resume-dsr") {
        endpoint = `/api/privacy/dsrs/${encodeURIComponent(item.action.dsrId)}/lifecycle`;
        payload = { action: "RESUME" };
      } else if (item.action.type === "start-privacy-assessment") {
        endpoint = `/api/privacy/assessments/${encodeURIComponent(item.action.assessmentId)}/lifecycle`;
        payload = { action: "START" };
      } else if (item.action.type === "wait-privacy-assessment") {
        endpoint = `/api/privacy/assessments/${encodeURIComponent(item.action.assessmentId)}/lifecycle`;
        payload = { action: "WAIT" };
      } else if (item.action.type === "resume-privacy-assessment") {
        endpoint = `/api/privacy/assessments/${encodeURIComponent(item.action.assessmentId)}/lifecycle`;
        payload = { action: "START" };
      } else if (item.action.type === "advance-hr-service") {
        endpoint = `/api/hr-service/requests/${encodeURIComponent(item.action.requestId)}/status`;
        payload = { status: item.action.status };
      } else if (item.action.type === "advance-onboarding-task") {
        endpoint = `/api/onboarding/tasks/${encodeURIComponent(item.action.taskId)}/status`;
        payload = { status: item.action.status };
      } else if (item.action.type === "activate-benefit-enrollment") {
        endpoint = `/api/benefits/enrollments/${encodeURIComponent(item.action.enrollmentId)}/transition`;
        payload = { status: "ACTIVE" };
      } else if (item.action.type === "start-learning-assignment") {
        endpoint = `/api/learning/assignments/${encodeURIComponent(item.action.assignmentId)}/self-transition`;
        payload = { status: "IN_PROGRESS" };
      } else if (item.action.type === "start-performance-self-review") {
        endpoint = `/api/performance/reviews/${encodeURIComponent(item.action.reviewId)}/self-start`;
        payload = {};
      } else if (item.action.type === "activate-onboarding-employment") {
        endpoint = `/api/onboarding/plans/${encodeURIComponent(item.action.planId)}/activate`;
        payload = {};
      } else if (item.action.type === "advance-offboarding-task") {
        endpoint = `/api/offboarding/processes/${encodeURIComponent(item.action.processId)}/tasks/${encodeURIComponent(item.action.taskId)}/complete`;
        payload = { status: item.action.status };
      } else if (item.action.type === "start-er-corrective-action") {
        endpoint = `/api/employee-relations/cases/${encodeURIComponent(item.action.caseId)}/actions/${encodeURIComponent(item.action.actionId)}/status`;
        payload = { status: "IN_PROGRESS" };
      } else if (item.action.type === "activate-development-plan") {
        endpoint = `/api/talent/development-plans/${encodeURIComponent(item.action.planId)}`;
        payload = { status: "ACTIVE" };
      } else if (item.action.type === "start-er-appeal-review") {
        endpoint = `/api/employee-relations/cases/${encodeURIComponent(item.action.caseId)}/appeals/${encodeURIComponent(item.action.appealId)}/review`;
        payload = {};
      }

      const method = item.action.type === "activate-development-plan" ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
        method,
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
      quickActionBusy.current = false;
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
    <section className="workflow-action-center card" aria-busy={loading} data-queue-state={loading ? "loading" : queueFailure ? "unavailable" : "ready"} data-source-state={loading || queueFailure ? "unverified" : sourceHealth?.state ?? "unknown"}>
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
          <Workflow size={17}/><span>{locale === "tr" ? "Tüm açık işler" : "All open work"}</span><strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.total}</strong>
        </button>
        <button type="button" className={`${filter === "critical" ? "active" : ""} ${summary.critical ? "danger" : ""}`} onClick={() => setFilter("critical")}>
          <ShieldAlert size={17}/><span>{locale === "tr" ? "Kritik" : "Critical"}</span><strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.critical}</strong>
        </button>
        <button type="button" className={`${filter === "overdue" ? "active" : ""} ${summary.overdue ? "danger" : ""}`} onClick={() => setFilter("overdue")}>
          <AlertTriangle size={17}/><span>{locale === "tr" ? "Geciken" : "Overdue"}</span><strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.overdue}</strong>
        </button>
        <button type="button" className={filter === "due-soon" ? "active" : ""} onClick={() => setFilter("due-soon")}>
          <Clock3 size={17}/><span>{locale === "tr" ? "24 saat içinde" : "Due in 24h"}</span><strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.dueSoon}</strong>
        </button>
      </div>

      <div className="workflow-action-source-filters" role="group" aria-label={locale === "tr" ? "Kaynak filtresi" : "Source filter"}>
        <button type="button" className={filter === "workflow" ? "active" : ""} onClick={() => setFilter("workflow")}>{locale === "tr" ? "İş akışı" : "Workflow"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.workflow}</strong></button>
        <button type="button" className={filter === "recruiting" ? "active" : ""} onClick={() => setFilter("recruiting")}><BriefcaseBusiness size={14}/>{locale === "tr" ? "İşe Alım" : "Recruiting"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.recruiting}</strong></button>
        <button type="button" className={filter === "policies" ? "active" : ""} onClick={() => setFilter("policies")}><BookOpenCheck size={14}/>{locale === "tr" ? "Politikalar" : "Policies"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.policies}</strong></button>
        <button type="button" className={filter === "workforce-planning" ? "active" : ""} onClick={() => setFilter("workforce-planning")}><Target size={14}/>{locale === "tr" ? "İşgücü Planlama" : "Workforce Planning"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.workforcePlanning}</strong></button>
        <button type="button" className={filter === "privacy" ? "active" : ""} onClick={() => setFilter("privacy")}><ShieldAlert size={14}/>{locale === "tr" ? "Gizlilik" : "Privacy"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.privacy}</strong></button>
        <button type="button" className={filter === "engagement" ? "active" : ""} onClick={() => setFilter("engagement")}><UsersRound size={14}/>{locale === "tr" ? "Bağlılık" : "Engagement"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.engagement}</strong></button>
        <button type="button" className={filter === "hr-service" ? "active" : ""} onClick={() => setFilter("hr-service")}>{locale === "tr" ? "İK Hizmeti" : "HR Service"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.hrService}</strong></button>
        <button type="button" className={filter === "employee-relations" ? "active" : ""} onClick={() => setFilter("employee-relations")}><span>{locale === "tr" ? "Çalışan İlişkileri" : "Employee Relations"}</span> <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.employeeRelations}</strong></button>
        <button type="button" className={filter === "documents" ? "active" : ""} onClick={() => setFilter("documents")}><FileClock size={14}/>{locale === "tr" ? "Dokümanlar" : "Documents"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.documents}</strong></button>
        <button type="button" className={filter === "onboarding" ? "active" : ""} onClick={() => setFilter("onboarding")}><UserPlus size={14}/>{locale === "tr" ? "İşe Başlatma" : "Onboarding"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.onboarding}</strong></button>
        <button type="button" className={filter === "offboarding" ? "active" : ""} onClick={() => setFilter("offboarding")}><UserMinus size={14}/>{locale === "tr" ? "İşten Ayrılış" : "Offboarding"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.offboarding}</strong></button>
        <button type="button" className={filter === "leave" ? "active" : ""} onClick={() => setFilter("leave")}><CalendarCheck2 size={14}/>{locale === "tr" ? "İzin" : "Leave"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.leave}</strong></button>
        <button type="button" className={filter === "time-attendance" ? "active" : ""} onClick={() => setFilter("time-attendance")}><TimerReset size={14}/>{locale === "tr" ? "Zaman" : "Time"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.timeAttendance}</strong></button>
        <button type="button" className={filter === "compensation" ? "active" : ""} onClick={() => setFilter("compensation")}><BadgeDollarSign size={14}/>{locale === "tr" ? "Ücret" : "Compensation"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.compensation}</strong></button>
        <button type="button" className={filter === "payroll" ? "active" : ""} onClick={() => setFilter("payroll")}><ReceiptText size={14}/>{locale === "tr" ? "Bordro" : "Payroll"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.payroll}</strong></button>
        <button type="button" className={filter === "benefits" ? "active" : ""} onClick={() => setFilter("benefits")}><HeartHandshake size={14}/>{locale === "tr" ? "Yan Haklar" : "Benefits"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.benefits}</strong></button>
        <button type="button" className={filter === "performance" ? "active" : ""} onClick={() => setFilter("performance")}><ClipboardCheck size={14}/>{locale === "tr" ? "Performans" : "Performance"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.performance}</strong></button>
        <button type="button" className={filter === "learning" ? "active" : ""} onClick={() => setFilter("learning")}><BookOpenCheck size={14}/>{locale === "tr" ? "Eğitim" : "Learning"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.learning}</strong></button>
        <button type="button" className={filter === "development-plan" ? "active" : ""} onClick={() => setFilter("development-plan")}><Target size={14}/>{locale === "tr" ? "Gelişim" : "Development"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.developmentPlans}</strong></button>
        <button type="button" className={filter === "succession" ? "active" : ""} onClick={() => setFilter("succession")}><UsersRound size={14}/>{locale === "tr" ? "Yedekleme" : "Succession"} <strong>{loading || queueFailure || hasIncompleteSources ? "—" : summary.succession}</strong></button>
      </div>

      <div className="workflow-action-refine">
        <label className="workflow-action-search">
          <Search size={15}/>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 160))}
            placeholder={locale === "tr" ? "Başlık, konu, durum veya kaynak ara…" : "Search title, subject, status or source…"}
            aria-label={locale === "tr" ? "Aksiyon merkezinde ara" : "Search action center"}
            maxLength={160}
          />
        </label>
        <button
          type="button"
          className={`workflow-action-toggle ${actionableOnly ? "active" : ""}`}
          aria-pressed={actionableOnly}
          onClick={() => setActionableOnly((value) => !value)}
        >
          <SlidersHorizontal size={14}/>
          <span>{locale === "tr" ? "Yalnız hızlı işlem" : "Quick actions only"}</span>
          <strong>{loading || queueFailure ? "—" : items.filter((item) => Boolean(item.action || item.secondaryAction)).length}</strong>
        </button>
        {(query || actionableOnly) ? <button type="button" className="secondary-button compact" onClick={() => { setQuery(""); setActionableOnly(false); }}>{locale === "tr" ? "Temizle" : "Clear"}</button> : null}
        <span className="workflow-action-result-count">{loading || queueFailure ? "—" : `${hasIncompleteSources ? (locale === "tr" ? "Yüklenmiş kayıtlar: " : "Loaded records: ") : ""}${visibleItems.length} / ${items.length}`}</span>
      </div>

      {!loading && !queueFailure && hasIncompleteSources && sourceHealth ? <div className="workflow-action-message" role="status" data-queue-source-health={sourceHealth.state}>
        <AlertTriangle size={15} style={{ flexShrink: 0 }}/><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{sourceHealthMessage(sourceHealth, locale)}</span>
      </div> : null}
      {error ? <div className="workflow-action-message error" role="alert"><AlertTriangle size={15}/>{error}</div> : null}
      {loading && items.length > 0 ? <div className="workflow-action-message" role="status">{locale === "tr" ? "Liste yenileniyor; önceki kayıtlar gösteriliyor. Hızlı işlemler geçici olarak kapalı." : "Refreshing the queue; previous records are shown. Quick actions are temporarily disabled."}</div> : null}
      {!loading && queueFailure && items.length > 0 ? <div className="workflow-action-message" role="status">{locale === "tr" ? "Önceki liste gösteriliyor; kayıtların güncelliği doğrulanamadı. Yenile düğmesi yalnızca listeyi okur, işlem tekrarlamaz." : "Showing the previous list; its freshness could not be verified. Refresh only reads the queue and never repeats an action."}</div> : null}
      {!loading && !queueFailure && loadedAt ? <div className="workflow-action-result-count" data-queue-generated-at={loadedAt}>{locale === "tr" ? "Liste zamanı: " : "Queue generated: "}{formatDate(loadedAt)}</div> : null}
      {success ? <div className="workflow-action-message success"><CheckCircle2 size={15}/>{success}</div> : null}

      <div className="workflow-action-table-wrap">
        <table className="workflow-action-table">
          <thead><tr><th>{locale === "tr" ? "Kaynak" : "Source"}</th><th>{locale === "tr" ? "Aksiyon" : "Action"}</th><th>{locale === "tr" ? "Konu" : "Subject"}</th><th>SLA</th><th>{locale === "tr" ? "Öncelik" : "Priority"}</th><th>{locale === "tr" ? "Durum" : "Status"}</th><th>{locale === "tr" ? "İşlem" : "Operation"}</th></tr></thead>
          <tbody>
            {loading && items.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty">{locale === "tr" ? "Aksiyon merkezi yükleniyor…" : "Loading action center…"}</td></tr> : null}
            {!loading && !queueFailure && visibleItems.length === 0 ? <tr><td colSpan={7} className="workflow-action-empty">{hasIncompleteSources ? <span data-queue-incomplete-empty>{locale === "tr" ? "Bu görünümde yüklenmiş kayıt yok. Eksik veya durumu bilinmeyen kaynaklarda bekleyen işler olabilir." : "No loaded records match this view. Unavailable or unreported sources may still contain pending work."}</span> : <><CheckCircle2 size={17}/>{locale === "tr" ? "Bu görünümde bekleyen aksiyon yok." : "No pending actions in this view."}</>}</td></tr> : null}
            {visibleItems.map((item) => {
              const leaveControl = actionCenterLeaveControl(item);
              const timeControl = actionCenterTimeControl(item);
              const compensationControl = actionCenterCompensationControl(item);
              const payrollControl = actionCenterPayrollControl(item);
              const workflowAction = item.action?.type === "complete-workflow" ? item.action : null;
              const focused = item.kind === "workflow" && (workflowAction?.taskId === initialTaskId || workflowAction?.instanceId === initialInstanceId);
              return <tr key={item.id} id={`action-item-${item.id}`} data-workflow-instance={workflowAction?.instanceId} className={focused ? "focused" : undefined}>
                <td><span className={`workflow-source ${item.kind}`}>{sourceLabel(item.kind)}</span></td>
                <td><strong>{item.title}</strong><small>{item.subtitle}</small></td>
                <td><span>{item.subjectType}</span><small>{item.subjectId}</small></td>
                <td><span className={`workflow-due ${item.urgency}`}>{formatDate(item.dueAt)}</span></td>
                <td><span className={`workflow-urgency ${item.urgency}`}>{urgencyLabel(item.urgency)}</span></td>
                <td><span className="workflow-task-status">{item.status}</span></td>
                <td>{isActionCenterLeaveItem(item) ? (leaveControl ? <LeaveDecisionButtons
                  requestId={leaveControl.requestId}
                  allowedDecisions={leaveControl.allowedDecisions}
                  attemptRegistry={leaveAttempts.current}
                  disabled={loading || queueFailure || error !== null || busyId !== null}
                /> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>) : isActionCenterTimeItem(item) ? (timeControl ? <TimeDecisionButtons
                  entryId={timeControl.entryId}
                  allowedDecisions={timeControl.allowedDecisions}
                  attemptRegistry={timeAttempts.current}
                  disabled={loading || queueFailure || error !== null || busyId !== null}
                /> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>) : isActionCenterCompensationItem(item) ? (compensationControl ? <CompensationActionButtons changeId={compensationControl.changeId} allowedActions={compensationControl.allowedActions} attemptRegistry={compensationAttempts.current} disabled={loading || queueFailure || error !== null || busyId !== null}/> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>) : isActionCenterPayrollItem(item) ? (payrollControl ? <PayrollActionButton runId={payrollControl.runId} action={payrollControl.action} attemptRegistry={payrollAttempts.current} disabled={loading || queueFailure || error !== null || busyId !== null}/> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>) : item.action ? <div className="workflow-row-actions"><button className="primary-button compact" type="button" disabled={loading || queueFailure || error !== null || busyId !== null} onClick={() => void executeQuickAction(item)}>{busyId === item.id ? quickActionCopy(item)?.busy : quickActionCopy(item)?.label}</button>{item.secondaryAction ? <button className="secondary-button compact" type="button" disabled={loading || queueFailure || error !== null || busyId !== null} onClick={() => void executeSecondaryAction(item)}>{busyId === item.id ? secondaryActionCopy(item)?.busy : secondaryActionCopy(item)?.label}</button> : null}</div> : <Link className="secondary-button compact" href={item.href}>{locale === "tr" ? "Aç" : "Open"}<ExternalLink size={13}/></Link>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
