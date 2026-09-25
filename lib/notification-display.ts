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
  OFFBOARDING_READY_TO_CLOSE: { en: "Separation ready to close", tr: "Ayrılış kapatmaya hazır" }
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

  const separationProcessId = text(data.separationProcessId); const domain = text(data.domain); const lastWorkingDate = text(data.lastWorkingDate);
  if (separationProcessId && reminderState === "ready-to-close" && lastWorkingDate) {
    const lastDay = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(lastWorkingDate));
    return locale === "tr" ? `Tüm çıkış kontrolleri tamamlandı. Ayrılış ${lastDay} tarihinde veya sonrasında bağımsız bir İK operasyon kullanıcısı tarafından kapatılabilir.` : `All exit controls are clear. The separation can be closed by an independent HR operations user on or after ${lastDay}.`;
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
  return notificationResourceHref(resourceType, resourceId);
}
