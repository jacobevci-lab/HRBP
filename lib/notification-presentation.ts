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
    POLICY_RETIRED: { en: "Policy retired", tr: "Politika yürürlükten kaldırıldı" }
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

  if (requestNumber && reason) {
    return locale === "tr" ? `${requestNumber}: ${reason}` : `${requestNumber}: ${reason}`;
  }
  if (requestNumber) {
    return locale === "tr" ? `${requestNumber} numaralı talep için aksiyon gerekiyor.` : `Action is required for request ${requestNumber}.`;
  }
  if (policyCode && policyTitle) return `${policyCode} · ${policyTitle}`;
  if (policyTitle) return policyTitle;
  if (policyCode) return policyCode;
  return locale === "tr" ? "Yeni bir İK bildirimi oluşturuldu." : "A new HR notification is available.";
}

export function notificationResourceHref(resourceType: string) {
  if (resourceType === "HRServiceRequest") return "/module/hr-service";
  if (resourceType === "PolicyException" || resourceType === "PolicyRecord") return "/module/policies";
  return "/";
}
