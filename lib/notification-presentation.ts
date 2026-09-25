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
    TIME_ENTRY_APPROVAL_REQUIRED: { en: "Time entry approval required", tr: "Zaman kaydı onayı gerekiyor" },
    TIME_ENTRY_APPROVED: { en: "Time entry approved", tr: "Zaman kaydı onaylandı" },
    TIME_ENTRY_REJECTED: { en: "Time entry rejected", tr: "Zaman kaydı reddedildi" },
    COMPENSATION_APPROVAL_REQUIRED: { en: "Compensation approval required", tr: "Ücret değişikliği onayı gerekiyor" },
    COMPENSATION_CHANGE_APPROVED: { en: "Compensation change approved", tr: "Ücret değişikliği onaylandı" },
    COMPENSATION_CHANGE_REJECTED: { en: "Compensation change rejected", tr: "Ücret değişikliği reddedildi" },
    COMPENSATION_PAYROLL_HANDOFF_READY: { en: "Compensation payroll handoff ready", tr: "Ücret değişikliği bordro devrine hazır" },
    PAYROLL_APPROVAL_REQUIRED: { en: "Payroll approval required", tr: "Bordro onayı gerekiyor" },
    PAYROLL_RUN_APPROVED: { en: "Payroll run approved", tr: "Bordro çalıştırması onaylandı" },
    PAYROLL_RUN_PAID: { en: "Payroll run marked paid", tr: "Bordro ödendi olarak işaretlendi" },
    LEAVE_APPROVAL_REQUIRED: { en: "Leave approval required", tr: "İzin onayı gerekiyor" },
    LEAVE_REQUEST_APPROVED: { en: "Leave request approved", tr: "İzin talebi onaylandı" },
    LEAVE_REQUEST_REJECTED: { en: "Leave request rejected", tr: "İzin talebi reddedildi" },
    RECRUITING_REQUISITION_APPROVAL_REQUIRED: { en: "Requisition approval required", tr: "İşe alım talebi onayı gerekiyor" },
    RECRUITING_REQUISITION_APPROVED: { en: "Requisition approved", tr: "İşe alım talebi onaylandı" },
    RECRUITING_REQUISITION_RETURNED: { en: "Requisition returned", tr: "İşe alım talebi geri gönderildi" },
    RECRUITING_REQUISITION_CANCELLED: { en: "Requisition cancelled", tr: "İşe alım talebi iptal edildi" },
    RECRUITING_OFFER_APPROVAL_REQUIRED: { en: "Offer approval required", tr: "Teklif onayı gerekiyor" },
    RECRUITING_OFFER_APPROVED: { en: "Offer approved", tr: "Teklif onaylandı" },
    RECRUITING_OFFER_RETURNED: { en: "Offer returned", tr: "Teklif geri gönderildi" },
    RECRUITING_OFFER_WITHDRAWN: { en: "Offer withdrawn", tr: "Teklif geri çekildi" },
    RECRUITING_OFFER_EXPIRED: { en: "Offer expired", tr: "Teklifin süresi doldu" },
    PERFORMANCE_SELF_REVIEW_READY: { en: "Self review ready", tr: "Öz değerlendirme hazır" },
    PERFORMANCE_MANAGER_REVIEW_READY: { en: "Manager review ready", tr: "Yönetici değerlendirmesi hazır" },
    LEARNING_ASSIGNMENT_READY: { en: "Learning assignment ready", tr: "Eğitim ataması hazır" },
    LEARNING_ASSIGNMENT_DUE_SOON: { en: "Learning assignment due soon", tr: "Eğitim atamasının süresi yaklaşıyor" },
    LEARNING_ASSIGNMENT_OVERDUE: { en: "Learning assignment overdue", tr: "Eğitim ataması gecikti" },
    SUCCESSION_PLAN_REVIEW_DUE_SOON: { en: "Succession plan review due soon", tr: "Yedekleme planı inceleme tarihi yaklaşıyor" },
    SUCCESSION_PLAN_REVIEW_OVERDUE: { en: "Succession plan review overdue", tr: "Yedekleme planı incelemesi gecikti" },
    SUCCESSION_DEVELOPMENT_REASSESSMENT_REQUIRED: { en: "Succession development evidence ready", tr: "Yedekleme gelişim kanıtı hazır" },
    DEVELOPMENT_PLAN_ACTIVATED: { en: "Development plan activated", tr: "Gelişim planı aktifleştirildi" },
    DEVELOPMENT_PLAN_DUE_SOON: { en: "Development plan target due soon", tr: "Gelişim planı hedef tarihi yaklaşıyor" },
    DEVELOPMENT_PLAN_OVERDUE: { en: "Development plan target overdue", tr: "Gelişim planı hedef tarihi gecikti" },
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
  const targetAt = text(data.targetAt);
  const reminderState = text(data.reminderState);
  const brokenEventId = text(data.brokenEventId);
  const integrityReason = text(data.reason);
  const cycleName = text(data.cycleName);
  const participantName = text(data.participantName);
  const employeeName = text(data.employeeName);
  const timeWorkDate = text(data.workDate);
  const timeMinutes = numberValue(data.minutes);
  const timeOvertimeMinutes = numberValue(data.overtimeMinutes);
  const timeDecision = text(data.decision);
  const compensationEmployeeName = text(data.compensationEmployeeName);
  const compensationCurrency = text(data.compensationCurrency);
  const compensationCurrentAnnualBase = text(data.compensationCurrentAnnualBase);
  const compensationProposedAnnualBase = text(data.compensationProposedAnnualBase);
  const compensationEffectiveAt = text(data.compensationEffectiveAt);
  const compensationDecision = text(data.compensationDecision);
  const payrollPeriodCode = text(data.payrollPeriodCode);
  const payrollCountryCode = text(data.payrollCountryCode);
  const payrollRunNumber = numberValue(data.payrollRunNumber);
  const payrollPayDate = text(data.payrollPayDate);
  const payrollDecision = text(data.payrollDecision);
  const leaveType = text(data.leaveType);
  const leaveStartsAt = text(data.startsAt);
  const leaveEndsAt = text(data.endsAt);
  const leaveUnits = text(data.units);
  const leaveDecision = text(data.decision);
  const recruitingRecordType = text(data.recruitingRecordType);
  const recruitingTitle = text(data.recruitingTitle);
  const recruitingOpenings = numberValue(data.recruitingOpenings);
  const recruitingCandidateName = text(data.recruitingCandidateName);
  const recruitingCurrency = text(data.recruitingCurrency);
  const recruitingAnnualBase = text(data.recruitingAnnualBase);
  const recruitingStartDate = text(data.recruitingStartDate);
  const recruitingExpiresAt = text(data.recruitingExpiresAt);
  const recruitingDecision = text(data.recruitingDecision);
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
  if (recruitingRecordType && recruitingTitle) {
    if (recruitingRecordType === "REQUISITION") {
      const openingText = recruitingOpenings !== undefined ? (locale === "tr" ? `${recruitingOpenings} kadro` : `${recruitingOpenings} opening${recruitingOpenings === 1 ? "" : "s"}`) : null;
      const base = `${recruitingTitle}${openingText ? ` · ${openingText}` : ""}`;
      if (recruitingDecision === "APPROVED") return locale === "tr" ? `${base} · bağımsız onay tamamlandı ve talep açıldı.` : `${base} · independently approved and opened.`;
      if (recruitingDecision === "RETURNED") return locale === "tr" ? `${base} · düzeltme için taslağa geri gönderildi.` : `${base} · returned to draft for revision.`;
      if (recruitingDecision === "CANCELLED") return locale === "tr" ? `${base} · iptal edildi.` : `${base} · cancelled.`;
      return locale === "tr" ? `${base} · bağımsız onay bekliyor.` : `${base} · waiting for independent approval.`;
    }

    const candidate = recruitingCandidateName ? `${recruitingCandidateName} · ` : "";
    let amount = recruitingAnnualBase && recruitingCurrency ? `${recruitingCurrency} ${recruitingAnnualBase}` : null;
    if (recruitingAnnualBase && recruitingCurrency) {
      try {
        amount = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: recruitingCurrency, maximumFractionDigits: 0 }).format(Number(recruitingAnnualBase));
      } catch {}
    }
    const start = recruitingStartDate ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(recruitingStartDate)) : null;
    const expiry = recruitingExpiresAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(recruitingExpiresAt)) : null;
    const base = `${candidate}${recruitingTitle}${amount ? ` · ${amount}` : ""}${start ? ` · ${locale === "tr" ? "başlangıç" : "start"} ${start}` : ""}`;
    if (recruitingDecision === "APPROVED") return locale === "tr" ? `${base} · bağımsız onay tamamlandı ve gönderime hazırlandı.` : `${base} · independently approved and released for sending.`;
    if (recruitingDecision === "RETURNED") return locale === "tr" ? `${base} · düzeltme için taslağa geri gönderildi.` : `${base} · returned to draft for revision.`;
    if (recruitingDecision === "WITHDRAWN") return locale === "tr" ? `${base} · geri çekildi.` : `${base} · withdrawn.`;
    if (recruitingDecision === "EXPIRED") return locale === "tr" ? `${base}${expiry ? ` · son tarih ${expiry}` : ""} · teklifin süresi doldu.` : `${base}${expiry ? ` · expired ${expiry}` : ""} · offer expired.`;
    return locale === "tr" ? `${base} · bağımsız onay bekliyor.` : `${base} · waiting for independent approval.`;
  }
  if (payrollPeriodCode && payrollCountryCode && payrollRunNumber !== undefined) {
    const payDate = payrollPayDate ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(payrollPayDate)) : null;
    const run = `${payrollCountryCode} · ${payrollPeriodCode} · #${payrollRunNumber}`;
    if (payrollDecision === "APPROVED") return locale === "tr" ? `${run}${payDate ? ` · ödeme ${payDate}` : ""} · bağımsız onay tamamlandı.` : `${run}${payDate ? ` · pay date ${payDate}` : ""} · independent approval completed.`;
    if (payrollDecision === "PAID") return locale === "tr" ? `${run}${payDate ? ` · ödeme ${payDate}` : ""} · ödendi olarak işaretlendi.` : `${run}${payDate ? ` · pay date ${payDate}` : ""} · marked paid.`;
    return locale === "tr" ? `${run}${payDate ? ` · ödeme ${payDate}` : ""} · bağımsız bordro onayı bekliyor.` : `${run}${payDate ? ` · pay date ${payDate}` : ""} · waiting for independent payroll approval.`;
  }
  if (compensationEmployeeName && compensationCurrency && compensationProposedAnnualBase && compensationEffectiveAt) {
    const effective = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(compensationEffectiveAt));
    let proposed = `${compensationCurrency} ${compensationProposedAnnualBase}`;
    let current = compensationCurrentAnnualBase ? `${compensationCurrency} ${compensationCurrentAnnualBase}` : null;
    try {
      proposed = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: compensationCurrency, maximumFractionDigits: 0 }).format(Number(compensationProposedAnnualBase));
      current = compensationCurrentAnnualBase ? new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: compensationCurrency, maximumFractionDigits: 0 }).format(Number(compensationCurrentAnnualBase)) : null;
    } catch {}
    const delta = current ? `${current} → ${proposed}` : proposed;
    if (compensationDecision === "APPROVED") return locale === "tr" ? `${compensationEmployeeName} · ${delta} · ${effective} tarihinde geçerli · onaylandı.` : `${compensationEmployeeName} · ${delta} · effective ${effective} · approved.`;
    if (compensationDecision === "REJECTED") return locale === "tr" ? `${compensationEmployeeName} · ${delta} · ${effective} tarihinde geçerli · reddedildi.` : `${compensationEmployeeName} · ${delta} · effective ${effective} · rejected.`;
    if (compensationDecision === "APPLIED") return locale === "tr" ? `${compensationEmployeeName} · ${proposed} · ${effective} tarihinde geçerli · bordro devri hazır.` : `${compensationEmployeeName} · ${proposed} · effective ${effective} · payroll handoff ready.`;
    return locale === "tr" ? `${compensationEmployeeName} · ${delta} · ${effective} tarihinde geçerli · bağımsız onay bekliyor.` : `${compensationEmployeeName} · ${delta} · effective ${effective} · waiting for independent approval.`;
  }
  if (timeWorkDate && timeMinutes !== undefined) {
    const day = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(timeWorkDate));
    const worked = `${Math.floor(timeMinutes / 60)}h ${timeMinutes % 60}m`;
    const overtime = timeOvertimeMinutes ? ` · OT ${Math.floor(timeOvertimeMinutes / 60)}h ${timeOvertimeMinutes % 60}m` : "";
    const owner = employeeName ? `${employeeName} · ` : "";
    if (timeDecision === "APPROVED") return locale === "tr" ? `${owner}${day} · ${worked}${overtime} · onaylandı.` : `${owner}${day} · ${worked}${overtime} · approved.`;
    if (timeDecision === "REJECTED") return locale === "tr" ? `${owner}${day} · ${worked}${overtime} · reddedildi.` : `${owner}${day} · ${worked}${overtime} · rejected.`;
    return locale === "tr" ? `${owner}${day} · ${worked}${overtime} · onayınızı bekliyor.` : `${owner}${day} · ${worked}${overtime} · waiting for your approval.`;
  }
  if (leaveType && leaveStartsAt && leaveEndsAt) {
    const formatter = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" });
    const range = `${formatter.format(new Date(leaveStartsAt))} → ${formatter.format(new Date(leaveEndsAt))}`;
    const owner = employeeName ? `${employeeName} · ` : "";
    const units = leaveUnits ? ` · ${leaveUnits}` : "";
    if (leaveDecision === "APPROVED") return locale === "tr" ? `${owner}${leaveType} · ${range}${units} · onaylandı.` : `${owner}${leaveType} · ${range}${units} · approved.`;
    if (leaveDecision === "REJECTED") return locale === "tr" ? `${owner}${leaveType} · ${range}${units} · reddedildi.` : `${owner}${leaveType} · ${range}${units} · rejected.`;
    return locale === "tr" ? `${owner}${leaveType} · ${range}${units} · onayınızı bekliyor.` : `${owner}${leaveType} · ${range}${units} · waiting for your approval.`;
  }
  if (benefitPlanName) {
    const plan = benefitPlanCode ? `${benefitPlanCode} · ${benefitPlanName}` : benefitPlanName;
    const deadline = benefitPlanEffectiveTo ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(benefitPlanEffectiveTo)) : null;
    const ended = endedEnrollments ?? 0;
    const anomalies = anomalousEnrollments ?? 0;
    if (locale === "tr") return `${plan}${deadline ? ` · ${deadline}` : ""} · ${ended} açık kayıt sonlandırıldı${anomalies ? ` · ${anomalies} anomali inceleme bekliyor` : ""}.`;
    return `${plan}${deadline ? ` · ${deadline}` : ""} · ${ended} open enrollments ended${anomalies ? ` · ${anomalies} anomalies require review` : ""}.`;
  }
  if (planTitle && targetAt && !courseTitle) {
    const deadline = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(new Date(targetAt));
    const skill = skillName ? ` · ${skillCode ? `${skillCode} · ` : ""}${skillName}${targetProficiency ? ` → ${targetProficiency}` : ""}` : "";
    if (reminderState === "overdue") {
      return locale === "tr"
        ? `${planTitle}${skill} · hedef tarih ${deadline} geçti. Plan ve gelişim kanıtları gözden geçirilmeli.`
        : `${planTitle}${skill} · target date ${deadline} has passed. Review the plan and development evidence.`;
    }
    if (reminderState === "due-soon") {
      return locale === "tr"
        ? `${planTitle}${skill} · hedef tarih ${deadline} yaklaşıyor. Açık gelişim aksiyonlarını gözden geçirin.`
        : `${planTitle}${skill} · target date ${deadline} is approaching. Review open development actions.`;
    }
    return locale === "tr"
      ? `${planTitle}${skill} · hedef tarih ${deadline}. Plan Learning self-servisinizde görüntülenebilir.`
      : `${planTitle}${skill} · target date ${deadline}. The plan is available in Learning self-service.`;
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
  if (resourceType === "TimeEntry") return id ? `/module/time-attendance?entry=${encodeURIComponent(id)}` : "/module/time-attendance";
  if (resourceType === "CompensationChange") return id ? `/module/compensation?change=${encodeURIComponent(id)}` : "/module/compensation";
  if (resourceType === "PayrollRun") return id ? `/module/payroll?run=${encodeURIComponent(id)}` : "/module/payroll";
  if (resourceType === "LeaveRequest") return id ? `/module/leave?request=${encodeURIComponent(id)}` : "/module/leave";
  if (resourceType === "Requisition") return id ? `/module/recruiting?requisition=${encodeURIComponent(id)}` : "/module/recruiting";
  if (resourceType === "Offer") return id ? `/module/recruiting?offer=${encodeURIComponent(id)}` : "/module/recruiting";
  if (resourceType === "Candidate") return id ? `/module/recruiting?candidate=${encodeURIComponent(id)}` : "/module/recruiting";
  if (resourceType === "Application") return id ? `/module/recruiting?application=${encodeURIComponent(id)}` : "/module/recruiting";
  if (resourceType === "PerformanceReview") return id ? `/module/performance?review=${encodeURIComponent(id)}` : "/module/performance";
  if (resourceType === "LearningAssignment") return id ? `/module/learning?assignment=${encodeURIComponent(id)}` : "/module/learning";
  if (resourceType === "SuccessionPlan") return id ? `/module/succession?plan=${encodeURIComponent(id)}` : "/module/succession";
  if (resourceType === "SuccessionCandidate") return id ? `/module/succession?candidate=${encodeURIComponent(id)}` : "/module/succession";
  if (resourceType === "DevelopmentPlan") return id ? `/module/talent?developmentPlan=${encodeURIComponent(id)}` : "/module/talent";
  if (resourceType === "DevelopmentPlanParticipant") return id ? `/module/learning?developmentPlan=${encodeURIComponent(id)}` : "/module/learning";
  if (resourceType === "BenefitPlan") return id ? `/module/benefits?plan=${encodeURIComponent(id)}` : "/module/benefits";
  if (resourceType === "AuditEvent") return id ? `/module/audit?q=${encodeURIComponent(id)}` : "/module/audit";
  return "/";
}
