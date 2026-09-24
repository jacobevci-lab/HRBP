import type { Locale } from "@/lib/i18n";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function notificationTitle(eventType: string, locale: Locale) {
  const titles: Record<string, { en: string; tr: string }> = {
    HR_SERVICE_ESCALATED: { en: "HR service request escalated", tr: "İK hizmet talebi eskale edildi" },
    POLICY_EXCEPTION_EXPIRED: { en: "Policy exception expired", tr: "Politika istisnasının süresi doldu" },
    POLICY_EXCEPTION_CLOSED_ON_RETIREMENT: { en: "Policy exception closed", tr: "Politika istisnası kapatıldı" },
    POLICY_RETIRED: { en: "Policy retired", tr: "Politika yürürlükten kaldırıldı" },
    WORKFLOW_TASK_READY: { en: "Workflow task ready", tr: "İş akışı görevi hazır" },
    WORKFLOW_TASK_DUE_SOON: { en: "Workflow task due soon", tr: "İş akışı görevinin süresi yaklaşıyor" },
    WORKFLOW_TASK_OVERDUE: { en: "Workflow task overdue", tr: "İş akışı görevi gecikti" },
    AUDIT_INTEGRITY_FAILURE: { en: "Audit ledger integrity failure", tr: "Denetim defteri bütünlük hatası" }
  };
  const known = titles[eventType];
  if (known) return known[locale];
  return eventType
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function notificationSummary(payload: unknown, locale: Locale) {
  const data = record(payload);
  const requestNumber = text(data.requestNumber);
  const reason = text(data.escalationReason);
  const policyCode = text(data.policyCode);
  const policyTitle = text(data.policyTitle);
  const workflowName = text(data.workflowName);
  const taskName = text(data.taskName);
  const dueAt = text(data.dueAt);
  const brokenEventId = text(data.brokenEventId);
  const integrityReason = text(data.reason);

  if (brokenEventId) {
    const detail = integrityReason ?? (locale === "tr" ? "Hash-zinciri doğrulaması başarısız oldu." : "Hash-chain verification failed.");
    return locale === "tr" ? `${brokenEventId}: ${detail}` : `${brokenEventId}: ${detail}`;
  }
  if (workflowName && taskName) {
    const deadline = dueAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dueAt)) : null;
    if (deadline) return `${workflowName}: ${taskName} · SLA ${deadline}`;
    return locale === "tr" ? `${workflowName}: ${taskName} aksiyonunu bekliyor.` : `${workflowName}: ${taskName} is waiting for your action.`;
  }
  if (taskName) return locale === "tr" ? `${taskName} aksiyonunu bekliyor.` : `${taskName} is waiting for your action.`;
  if (requestNumber && reason) return `${requestNumber}: ${reason}`;
  if (requestNumber) {
    return locale === "tr" ? `${requestNumber} numaralı talep için aksiyon gerekiyor.` : `Action is required for request ${requestNumber}.`;
  }
  if (policyCode && policyTitle) return `${policyCode} · ${policyTitle}`;
  if (policyTitle) return policyTitle;
  if (policyCode) return policyCode;
  return locale === "tr" ? "Yeni bir İK bildirimi oluşturuldu." : "A new HR notification is available.";
}

export function notificationResourceHref(resourceType: string, resourceId?: string) {
  const id = resourceId?.trim();
  if (resourceType === "HRServiceRequest") return id ? `/module/hr-service?record=${encodeURIComponent(id)}` : "/module/hr-service";
  if (resourceType === "PolicyException" || resourceType === "PolicyRecord") return id ? `/module/policies?record=${encodeURIComponent(id)}` : "/module/policies";
  if (resourceType === "WorkflowTask") return id ? `/module/workflows?task=${encodeURIComponent(id)}` : "/module/workflows";
  if (resourceType === "WorkflowInstance") return id ? `/module/workflows?instance=${encodeURIComponent(id)}` : "/module/workflows";
  if (resourceType === "AuditEvent") return id ? `/module/audit?q=${encodeURIComponent(id)}` : "/module/audit";
  return "/";
}
