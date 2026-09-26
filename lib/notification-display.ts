import type { Locale } from "@/lib/i18n";
import { notificationResourceHref, notificationSummary, notificationTitle } from "@/lib/notification-presentation";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function serviceStatus(value: string | undefined, locale: Locale) {
  if (!value) return "—";
  const normalized = value.toUpperCase();
  if (locale !== "tr") return normalized.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  const map: Record<string, string> = {
    OPEN: "Açık", TRIAGE: "Triyaj", IN_PROGRESS: "Devam ediyor", WAITING_EMPLOYEE: "Çalışan bekleniyor",
    WAITING_THIRD_PARTY: "Üçüncü taraf bekleniyor", RESOLVED: "Çözüldü", CLOSED: "Kapalı", CANCELLED: "İptal edildi",
    INVESTIGATING: "Soruşturuluyor", ACTION_REQUIRED: "Aksiyon gerekli", DRAFT: "Taslak", COMPLETED: "Tamamlandı"
  };
  return map[normalized] ?? normalized;
}

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
const hrServiceTitles: Record<string, { en: string; tr: string }> = {
  HR_SERVICE_REQUEST_CREATED: { en: "HR service request received", tr: "İK hizmet talebi alındı" },
  HR_SERVICE_STATUS_CHANGED: { en: "HR service request updated", tr: "İK hizmet talebi güncellendi" },
  HR_SERVICE_ASSIGNED: { en: "HR service request assigned", tr: "İK hizmet talebi atandı" },
  HR_SERVICE_REQUESTOR_REPLIED: { en: "Requestor replied", tr: "Talep sahibi yanıtladı" },
  HR_SERVICE_STAFF_REPLIED: { en: "HR replied to your request", tr: "İK talebinize yanıt verdi" },
  HR_SERVICE_ESCALATED: { en: "HR service SLA escalation", tr: "İK hizmeti SLA eskalasyonu" }
};
const employeeRelationsTitles: Record<string, { en: string; tr: string }> = {
  ER_CASE_STATUS_CHANGED: { en: "Employee Relations case updated", tr: "Çalışan ilişkileri vakası güncellendi" },
  ER_CASE_ACTION_ASSIGNED: { en: "Corrective action assigned", tr: "Düzeltici aksiyon atandı" },
  ER_CASE_ACTION_STATUS_CHANGED: { en: "Corrective action updated", tr: "Düzeltici aksiyon güncellendi" }
};

export function notificationDisplayTitle(eventType: string, locale: Locale) {
  return onboardingTitles[eventType]?.[locale] ?? offboardingTitles[eventType]?.[locale] ?? hrServiceTitles[eventType]?.[locale] ?? employeeRelationsTitles[eventType]?.[locale] ?? notificationTitle(eventType, locale);
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

  const requestNumber = text(data.requestNumber); const notificationState = text(data.notificationState); const fromStatus = text(data.fromStatus); const toStatus = text(data.toStatus); const serviceReason = text(data.reason); const serviceQueue = text(data.queue); const serviceTitle = text(data.title); const escalationLevel = numberValue(data.escalationLevel); const escalationReason = text(data.escalationReason); const slaDueAt = text(data.slaDueAt); const caseNumber = text(data.caseNumber);
  if (caseNumber && notificationState === "case-status-changed" && toStatus) {
    return `${caseNumber} · ${serviceStatus(fromStatus, locale)} → ${serviceStatus(toStatus, locale)}.`;
  }
  if (caseNumber && notificationState === "case-action-assigned") {
    const due = dueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dueAt)) : null;
    return locale === "tr" ? `${caseNumber} · size yeni bir düzeltici aksiyon atandı${due ? ` · son tarih ${due}` : ""}.` : `${caseNumber} · a new corrective action was assigned to you${due ? ` · due ${due}` : ""}.`;
  }
  if (caseNumber && notificationState === "case-action-status-changed" && toStatus) {
    return `${caseNumber} · ${serviceStatus(fromStatus, locale)} → ${serviceStatus(toStatus, locale)}.`;
  }
  if (requestNumber && notificationState === "created") {
    return locale === "tr"
      ? `${requestNumber}${serviceTitle ? ` · ${serviceTitle}` : ""}${serviceQueue ? ` · ${serviceQueue}` : ""}. Talep yönlendirme ve triyaj için kaydedildi.`
      : `${requestNumber}${serviceTitle ? ` · ${serviceTitle}` : ""}${serviceQueue ? ` · ${serviceQueue}` : ""}. The request is recorded for routing and triage.`;
  }
  if (requestNumber && notificationState === "status-changed" && toStatus) {
    const transition = `${serviceStatus(fromStatus, locale)} → ${serviceStatus(toStatus, locale)}`;
    return locale === "tr" ? `${requestNumber} · ${transition}${serviceReason ? ` · ${serviceReason}` : ""}.` : `${requestNumber} · ${transition}${serviceReason ? ` · ${serviceReason}` : ""}.`;
  }
  if (requestNumber && notificationState === "assigned") {
    return locale === "tr" ? `${requestNumber}${serviceQueue ? ` · ${serviceQueue}` : ""} size atandı.` : `${requestNumber}${serviceQueue ? ` · ${serviceQueue}` : ""} was assigned to you.`;
  }
  if (requestNumber && notificationState === "requestor-replied") {
    return locale === "tr" ? `${requestNumber} talebinin sahibi yeni bir yanıt ekledi.` : `The requestor added a new reply to ${requestNumber}.`;
  }
  if (requestNumber && notificationState === "staff-replied") {
    return locale === "tr" ? `${requestNumber} talebinize İK tarafından yeni bir yanıt eklendi.` : `HR added a new reply to your request ${requestNumber}.`;
  }
  if (requestNumber && escalationLevel !== undefined) {
    const due = slaDueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(slaDueAt)) : null;
    return locale === "tr" ? `${requestNumber} · eskalasyon seviye ${escalationLevel}${serviceQueue ? ` · ${serviceQueue}` : ""}${due ? ` · SLA ${due}` : ""}${escalationReason ? ` · ${escalationReason}` : ""}.` : `${requestNumber} · escalation level ${escalationLevel}${serviceQueue ? ` · ${serviceQueue}` : ""}${due ? ` · SLA ${due}` : ""}${escalationReason ? ` · ${escalationReason}` : ""}.`;
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
  if (resourceType === "HRServiceRequest") return id ? `/module/hr-service?request=${encodeURIComponent(id)}` : "/module/hr-service";
  if (resourceType === "EmployeeCase") return id ? `/module/employee-relations?case=${encodeURIComponent(id)}` : "/module/employee-relations";
  if (resourceType === "CaseAction") return id ? `/module/employee-relations?action=${encodeURIComponent(id)}` : "/module/employee-relations";
  if (resourceType === "EmployeeCaseAppeal" || resourceType === "CaseAppeal") return id ? `/module/employee-relations?appeal=${encodeURIComponent(id)}` : "/module/employee-relations";
  return notificationResourceHref(resourceType, resourceId);
}
