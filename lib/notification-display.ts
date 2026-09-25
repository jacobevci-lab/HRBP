import type { Locale } from "@/lib/i18n";
import { notificationResourceHref, notificationSummary, notificationTitle } from "@/lib/notification-presentation";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const onboardingTitles: Record<string, { en: string; tr: string }> = {
  ONBOARDING_TASK_BLOCKED: { en: "Onboarding task blocked", tr: "İşe başlatma görevi engellendi" },
  ONBOARDING_TASK_DUE_SOON: { en: "Onboarding task due soon", tr: "İşe başlatma görevinin süresi yaklaşıyor" },
  ONBOARDING_TASK_OVERDUE: { en: "Onboarding task overdue", tr: "İşe başlatma görevi gecikti" },
  ONBOARDING_START_READINESS_RISK: { en: "Day-one readiness at risk", tr: "İlk gün hazırlığı risk altında" }
};

export function notificationDisplayTitle(eventType: string, locale: Locale) {
  return onboardingTitles[eventType]?.[locale] ?? notificationTitle(eventType, locale);
}

export function notificationDisplaySummary(payload: unknown, locale: Locale) {
  const data = record(payload);
  const planId = text(data.onboardingPlanId);
  const employeeName = text(data.employeeName);
  const taskName = text(data.taskName);
  const ownerType = text(data.ownerType);
  const reminderState = text(data.reminderState);
  const dueAt = text(data.dueAt);
  const targetStartDate = text(data.targetStartDate);
  const outstandingTaskCount = numberValue(data.outstandingTaskCount);
  const blockedTaskCount = numberValue(data.blockedTaskCount);

  if (planId && employeeName && reminderState === "start-risk" && targetStartDate) {
    const start = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(targetStartDate));
    const outstanding = outstandingTaskCount ?? 0;
    const blocked = blockedTaskCount ?? 0;
    return locale === "tr"
      ? `${employeeName} · başlangıç ${start} · ${outstanding} açık görev${blocked ? ` · ${blocked} engelli` : ""}.`
      : `${employeeName} · starts ${start} · ${outstanding} open task${outstanding === 1 ? "" : "s"}${blocked ? ` · ${blocked} blocked` : ""}.`;
  }

  if (planId && employeeName && taskName && reminderState) {
    const due = dueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dueAt)) : null;
    const owner = ownerType ? ` · ${ownerType}` : "";
    const state = reminderState === "blocked"
      ? (locale === "tr" ? "engel çözümü gerekiyor" : "blocker resolution required")
      : reminderState === "overdue"
        ? (locale === "tr" ? "gecikmiş" : "overdue")
        : (locale === "tr" ? "son tarih yaklaşıyor" : "due soon");
    return `${employeeName} · ${taskName}${owner}${due ? ` · ${locale === "tr" ? "son tarih" : "due"} ${due}` : ""} · ${state}.`;
  }

  return notificationSummary(payload, locale);
}

export function notificationDisplayResourceHref(resourceType: string, resourceId?: string) {
  const id = resourceId?.trim();
  if (resourceType === "OnboardingTask") return id ? `/module/onboarding?task=${encodeURIComponent(id)}` : "/module/onboarding";
  if (resourceType === "OnboardingPlan") return id ? `/module/onboarding?plan=${encodeURIComponent(id)}` : "/module/onboarding";
  return notificationResourceHref(resourceType, resourceId);
}
