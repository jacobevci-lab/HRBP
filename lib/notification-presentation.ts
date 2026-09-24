import type { Locale } from "@/lib/i18n";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    PERFORMANCE_SELF_REVIEW_READY: { en: "Self review ready", tr: "Öz değerlendirme hazır" },
    PERFORMANCE_MANAGER_REVIEW_READY: { en: "Manager review ready", tr: "Yönetici değerlendirmesi hazır" },
    LEARNING_ASSIGNMENT_READY: { en: "Learning assignment ready", tr: "Eğitim ataması hazır" },
    LEARNING_ASSIGNMENT_DUE_SOON: { en: "Learning assignment due soon", tr: "Eğitim atamasının süresi yaklaşıyor" },
    LEARNING_ASSIGNMENT_OVERDUE: { en: "Learning assignment overdue", tr: "Eğitim ataması gecikti" },
    SUCCESSION_PLAN_REVIEW_DUE_SOON: { en: "Succession plan review due soon", tr: "Yedekleme planı inceleme tarihi yaklaşıyor" },
    SUCCESSION_PLAN_REVIEW_OVERDUE: { en: "Succession plan review overdue", tr: "Yedekleme planı incelemesi gecikti" },
    SUCCESSION_DEVELOPMENT_REASSESSMENT_REQUIRED: { en: "Succession development evidence ready", tr: "Yedekleme gelişim kanıtı hazır" },
    DEVELOPMENT_PLAN_REASSESSMENT_REQUIRED: { en: "Development plan evidence ready", tr: "Gelişim planı kanıtı hazır" },
    BENEFIT_PLAN_EXPIRED: { en: "Benefit plan expired", tr: "Yan hak planının süresi doldu" },
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
  const cycleName = text(data.cycleName);
  const participantName = text(data.participantName);
  const positionCode = text(data.positionCode);
  const positionTitle = text(data.positionTitle);
  const reviewDueAt = text(data.reviewDueAt);
  const planTitle = text(data.planTitle);
  const courseCode = text(data.courseCode);
  const courseTitle = text(data.courseTitle);
  const skillCode = text(data.skillCode);
  const skillName = text(data.skillName);
  const targetProficiency = text(data.targetProficiency);
  const benefitPlanCode = text(data.benefitPlanCode);
  const benefitPlanName = text(data.benefitPlanName);
  const benefitPlanEffectiveTo = text(data.benefitPlanEffectiveTo);
  const endedEnrollments = numberValue(data.endedEnrollments);
  const anomalousEnrollments = numberValue(data.anomalousEnrollments);

  if (brokenEventId) {
    const detail = integrityReason ?? (locale === "tr" ? "Hash-zinciri doğrulaması başarısız oldu." : "Hash-chain verification failed.");
    return `${brokenEventId}: ${detail}`;
  }
  if (benefitPlanName) {
    const plan = benefitPlanCode ? `${benefitPlanCode} · ${benefitPlanName}` : benefitPlanName;
    const deadline = benefitPlanEffectiveTo ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(benefitPlanEffectiveTo)) : null;
    const ended = endedEnrollments ?? 0;
    const anomalies = anomalousEnrollments ?? 0;
    if (locale === "tr") return `${plan}${deadline ? ` · ${deadline}` : ""} · ${ended} açık kayıt sonlandırıldı${anomalies ? ` · ${anomalies} anomali inceleme bekliyor` : ""}.`;
    return `${plan}${deadline ? ` · ${deadline}` : ""} · ${ended} open enrollments ended${anomalies ? ` · ${anomalies} anomalies require review` : ""}.`;
  }
  if (courseTitle && skillName && targetProficiency) {
    const course = courseCode ? `${courseCode} · ${courseTitle}` : courseTitle;
    const skill = skillCode ? `${skillCode} · ${skillName}` : skillName;
    const position = positionTitle ? (positionCode ? `${positionCode} · ${positionTitle}` : positionTitle) : null;
    const context = planTitle ? ` · ${planTitle}` : position ? ` · ${position}` : "";
    return locale === "tr"
      ? `${course} tamamlandı · ${skill} hedefi ${targetProficiency}${context}. İnsan değerlendirmesi gerekiyor.`
      : `${course} completed · ${skill} target ${targetProficiency}${context}. Human reassessment is required.`;
  }
  if (courseTitle) {
    const course = courseCode ? `${courseCode} · ${courseTitle}` : courseTitle;
    if (dueAt) {
      const deadline = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(dueAt));
      return locale === "tr" ? `${course} · son tarih ${deadline}` : `${course} · due ${deadline}`;
    }
    return course;
  }
  if (positionTitle && reviewDueAt) {
    const deadline = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(reviewDueAt));
    const position = positionCode ? `${positionCode} · ${positionTitle}` : positionTitle;
    return locale === "tr" ? `${position} · inceleme tarihi ${deadline}` : `${position} · review due ${deadline}`;
  }
  if (cycleName && participantName) {
    return locale === "tr"
      ? `${cycleName}: ${participantName} için değerlendirme aksiyonu bekliyor.`
      : `${cycleName}: a review action is waiting for ${participantName}.`;
  }
  if (cycleName) {
    return locale === "tr"
      ? `${cycleName} için performans değerlendirme aksiyonu bekliyor.`
      : `A performance review action is waiting for ${cycleName}.`;
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
  if (resourceType === "PerformanceReview") return id ? `/module/performance?review=${encodeURIComponent(id)}` : "/module/performance";
  if (resourceType === "LearningAssignment") return id ? `/module/learning?assignment=${encodeURIComponent(id)}` : "/module/learning";
  if (resourceType === "SuccessionPlan") return id ? `/module/succession?plan=${encodeURIComponent(id)}` : "/module/succession";
  if (resourceType === "SuccessionCandidate") return id ? `/module/succession?candidate=${encodeURIComponent(id)}` : "/module/succession";
  if (resourceType === "DevelopmentPlan") return id ? `/module/talent?developmentPlan=${encodeURIComponent(id)}` : "/module/talent";
  if (resourceType === "BenefitPlan") return id ? `/module/benefits?plan=${encodeURIComponent(id)}` : "/module/benefits";
  if (resourceType === "AuditEvent") return id ? `/module/audit?q=${encodeURIComponent(id)}` : "/module/audit";
  return "/";
}
