import type { Locale } from "@/lib/i18n";
import { notificationResourceHref, notificationSummary, notificationTitle } from "@/lib/notification-presentation";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

const onboardingTitles: Record<string, { en: string; tr: string }> = {
  ONBOARDING_TASK_BLOCKED: { en: "Onboarding task blocked", tr: "İşe başlatma görevi engellendi" },
  ONBOARDING_TASK_DUE_SOON: { en: "Onboarding task due soon", tr: "İşe başlatma görevinin süresi yaklaşıyor" },
  ONBOARDING_TASK_OVERDUE: { en: "Onboarding task overdue", tr: "İşe başlatma görevi gecikti" },
  ONBOARDING_START_READINESS_RISK: { en: "Day-one readiness at risk", tr: "İlk gün hazırlığı risk altında" },
  ONBOARDING_READY_FOR_ACTIVATION: { en: "Onboarding ready for activation", tr: "İşe başlatma aktivasyona hazır" }
};
const offboardingTitles: Record<string, { en: string; tr: string }> = {
  OFFBOARDING_TASK_BLOCKED: { en: "Exit task blocked", tr: "İşten ayrılış görevi engellendi" },
  OFFBOARDING_TASK_DUE_SOON: { en: "Exit task due soon", tr: "İşten ayrılış görevinin süresi yaklaşıyor" },
  OFFBOARDING_TASK_OVERDUE: { en: "Exit task overdue", tr: "İşten ayrılış görevi gecikti" },
  OFFBOARDING_EXIT_READINESS_RISK: { en: "Exit readiness at risk", tr: "İşten ayrılış hazırlığı risk altında" },
  OFFBOARDING_READY_TO_CLOSE: { en: "Separation ready to close", tr: "Ayrılış kapatmaya hazır" },
  OFFBOARDING_FINAL_SETTLEMENT_APPROVAL_REQUIRED: { en: "Final settlement approval required", tr: "Nihai hesap onayı gerekiyor" },
  OFFBOARDING_FINAL_SETTLEMENT_PAYMENT_REQUIRED: { en: "Final settlement completion required", tr: "Nihai hesap tamamlama işlemi gerekiyor" },
  OFFBOARDING_FINAL_SETTLEMENT_SETTLED: { en: "Final settlement cleared", tr: "Nihai hesap tamamlandı" },
  OFFBOARDING_BACKFILL_DRAFT_CREATED: { en: "Backfill requisition drafted", tr: "Yedek kadro işe alım talebi oluşturuldu" }
};

export function notificationDisplayTitle(eventType: string, locale: Locale) {
  return onboardingTitles[eventType]?.[locale] ?? offboardingTitles[eventType]?.[locale] ?? notificationTitle(eventType, locale);
}

export function notificationDisplaySummary(payload: unknown, locale: Locale) {
  const data = record(payload);
  const planId = text(data.onboardingPlanId); const employeeName = text(data.employeeName); const taskName = text(data.taskName); const ownerType = text(data.ownerType); const reminderState = text(data.reminderState); const dueAt = text(data.dueAt); const targetStartDate = text(data.targetStartDate); const outstandingTaskCount = numberValue(data.outstandingTaskCount); const blockedTaskCount = numberValue(data.blockedTaskCount);
  if (planId && employeeName && reminderState === "activation-ready" && targetStartDate) {
    const start = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(targetStartDate));
    return locale === "tr" ? `${employeeName} için tüm onboarding kontrolleri tamamlandı. İstihdam ${start} tarihinde veya sonrasında aktifleştirilebilir.` : `All onboarding controls are clear for ${employeeName}. Employment can be activated on or after ${start}.`;
  }
  if (planId && employeeName && reminderState === "start-risk" && targetStartDate) {
    const start = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(targetStartDate)); const outstanding = outstandingTaskCount ?? 0; const blocked = blockedTaskCount ?? 0;
    return locale === "tr" ? `${employeeName} · başlangıç ${start} · ${outstanding} açık görev${blocked ? ` · ${blocked} engelli` : ""}.` : `${employeeName} · starts ${start} · ${outstanding} open task${outstanding === 1 ? "" : "s"}${blocked ? ` · ${blocked} blocked` : ""}.`;
  }
  if (planId && employeeName && taskName && reminderState) {
    const due = dueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dueAt)) : null; const owner = ownerType ? ` · ${ownerType}` : "";
    const state = reminderState === "blocked" ? (locale === "tr" ? "engel çözümü gerekiyor" : "blocker resolution required") : reminderState === "overdue" ? (locale === "tr" ? "gecikmiş" : "overdue") : (locale === "tr" ? "son tarih yaklaşıyor" : "due soon");
    return `${employeeName} · ${taskName}${owner}${due ? ` · ${locale === "tr" ? "son tarih" : "due"} ${due}` : ""} · ${state}.`;
  }

  const separationProcessId = text(data.separationProcessId); const domain = text(data.domain); const lastWorkingDate = text(data.lastWorkingDate); const replacementRequisitionId = text(data.replacementRequisitionId); const positionTitle = text(data.positionTitle); const targetHireDate = text(data.targetHireDate);
  if (separationProcessId && replacementRequisitionId && reminderState === "backfill-draft") {
    const target = targetHireDate ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(targetHireDate)) : null;
    if (locale === "tr") return `${positionTitle ?? "Pozisyon"} için yedek kadro talebi Taslak olarak oluşturuldu${employeeName ? ` · kaynak ayrılış: ${employeeName}` : ""}${target ? ` · hedef: ${target}` : ""}. İşe Alım talebi incelemeli ve normal onay süreciyle açmalıdır.`;
    return `A backfill requisition for ${positionTitle ?? "the position"} was created as Draft${employeeName ? ` · source separation: ${employeeName}` : ""}${target ? ` · target: ${target}` : ""}. Recruiting must review it and open it through the normal approval flow.`;
  }
  if (separationProcessId && reminderState?.startsWith("final-settlement-") && lastWorkingDate) {
    const lastDay = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(lastWorkingDate));
    if (reminderState === "final-settlement-prepared") return locale === "tr" ? `Nihai hesap hazırlandı. Son çalışma günü ${lastDay}. Hazırlayan kişiden farklı bir bordro onaylayıcısının kararı gerekiyor.` : `Final settlement is prepared. Last working day ${lastDay}. An independent payroll approver must review it.`;
    if (reminderState === "final-settlement-approved") return locale === "tr" ? `Nihai hesap bağımsız olarak onaylandı. Son çalışma günü ${lastDay}. Onaylayandan farklı bir ödeme yetkilisinin tamamlama teyidi gerekiyor.` : `Final settlement was independently approved. Last working day ${lastDay}. A different payroll payment authority must confirm completion.`;
    if (reminderState === "final-settlement-settled") return locale === "tr" ? `Nihai hesap tamamlandı. Son çalışma günü ${lastDay}. Diğer çıkış kontrolleri de temizse ayrılış kapanışa ilerleyebilir.` : `Final settlement is cleared. Last working day ${lastDay}. The separation can advance when the remaining exit controls are clear.`;
  }
  if (separationProcessId && reminderState === "ready-to-close" && lastWorkingDate) {
    const lastDay = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(lastWorkingDate));
    return locale === "tr" ? `Tüm çıkış kontrolleri ve nihai hesap tamamlandı. Ayrılış ${lastDay} tarihinde veya sonrasında bağımsız bir İK operasyon kullanıcısı tarafından kapatılabilir.` : `All exit controls and final settlement are clear. The separation can be closed by an independent HR operations user on or after ${lastDay}.`;
  }
  if (separationProcessId && reminderState === "exit-risk" && lastWorkingDate) {
    const lastDay = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(lastWorkingDate)); const tasks = numberValue(data.openBlockingTasks) ?? 0; const assets = numberValue(data.openAssets) ?? 0; const access = numberValue(data.openAccess) ?? 0; const handover = numberValue(data.openKnowledgeTransfers) ?? 0;
    return locale === "tr" ? `Son çalışma günü ${lastDay} · ${tasks} açık bloke görev · ${handover} bilgi devri · ${assets} varlık · ${access} erişim kontrolü açık.` : `Last working day ${lastDay} · ${tasks} blocking task${tasks === 1 ? "" : "s"} · ${handover} handover item${handover === 1 ? "" : "s"} · ${assets} asset${assets === 1 ? "" : "s"} · ${access} access control${access === 1 ? "" : "s"} open.`;
  }
  if (separationProcessId && taskName && reminderState) {
    const due = dueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dueAt)) : null;
    const state = reminderState === "blocked" ? (locale === "tr" ? "engel çözümü gerekiyor" : "blocker resolution required") : reminderState === "overdue" ? (locale === "tr" ? "gecikmiş" : "overdue") : (locale === "tr" ? "son tarih yaklaşıyor" : "due soon");
    return `${taskName}${domain ? ` · ${domain}` : ""}${due ? ` · ${locale === "tr" ? "son tarih" : "due"} ${due}` : ""} · ${state}.`;
  }
  return notificationSummary(payload, locale);
}

export function notificationDisplayResourceHref(resourceType: string, resourceId?: string) {
  const id = resourceId?.trim();
  if (resourceType === "OnboardingTask") return id ? `/module/onboarding?task=${encodeURIComponent(id)}` : "/module/onboarding";
  if (resourceType === "OnboardingPlan") return id ? `/module/onboarding?plan=${encodeURIComponent(id)}` : "/module/onboarding";
  if (resourceType === "SeparationTask") return id ? `/module/offboarding?task=${encodeURIComponent(id)}` : "/module/offboarding";
  if (resourceType === "KnowledgeTransfer") return id ? `/module/offboarding?transfer=${encodeURIComponent(id)}` : "/module/offboarding";
  if (resourceType === "SeparationProcess") return id ? `/module/offboarding?process=${encodeURIComponent(id)}` : "/module/offboarding";
  if (resourceType === "Requisition") return "/module/recruiting";
  return notificationResourceHref(resourceType, resourceId);
}
