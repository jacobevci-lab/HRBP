import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const ADMIN_USER_ID = "user-yakup-evci";
const now = new Date();
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function seedEngagement() {
  const surveys = [
    ["survey-pulse", "ENG-PULSE", "Quarterly Pulse", "Quarterly employee listening"],
    ["survey-manager", "ENG-MGR", "Manager Effectiveness", "Manager effectiveness listening"],
    ["survey-onboarding", "ENG-ONB", "Onboarding 30-day", "Thirty-day onboarding experience"]
  ];
  for (const [id, code, name, description] of surveys) {
    await db.engagementSurvey.upsert({ where: { id }, update: { tenantId: TENANT_ID, code, name, description, createdById: ADMIN_USER_ID }, create: { id, tenantId: TENANT_ID, code, name, description, createdById: ADMIN_USER_ID } });
  }

  const questions = [
    ["question-pulse-1", "survey-pulse", "engagement", "I would recommend Acme as a place to work.", "SCALE", 1, "Engagement"],
    ["question-manager-1", "survey-manager", "manager-support", "My manager supports my development.", "SCALE", 1, "Manager"],
    ["question-onboarding-1", "survey-onboarding", "onboarding", "My onboarding prepared me for my role.", "SCALE", 1, "Onboarding"]
  ];
  for (const [id, surveyId, questionKey, prompt, type, orderIndex, dimension] of questions) {
    await db.surveyQuestion.upsert({ where: { id }, update: { tenantId: TENANT_ID, surveyId, questionKey, prompt, type, required: true, orderIndex, dimension }, create: { id, tenantId: TENANT_ID, surveyId, questionKey, prompt, type, required: true, orderIndex, dimension } });
  }

  const campaigns = [
    ["campaign-q3-pulse", "survey-pulse", "Q3 Pulse", "OPEN", 7, 10, -10, 10, 8],
    ["campaign-manager", "survey-manager", "Manager Effectiveness", "CLOSED", 7, 10, -45, -20, 9],
    ["campaign-onboarding", "survey-onboarding", "Onboarding 30-day", "OPEN", 5, 10, -7, 14, 3]
  ];
  for (const [id, surveyId, name, status, threshold, targetCount, openOffset, closeOffset, responseCount] of campaigns) {
    const opensAt = addDays(now, openOffset);
    await db.surveyCampaign.upsert({ where: { id }, update: { tenantId: TENANT_ID, surveyId, name, status, anonymous: true, anonymityThreshold: threshold, audienceFilter: { targetCount }, opensAt, closesAt: addDays(now, closeOffset), createdById: ADMIN_USER_ID }, create: { id, tenantId: TENANT_ID, surveyId, name, status, anonymous: true, anonymityThreshold: threshold, audienceFilter: { targetCount }, opensAt, closesAt: addDays(now, closeOffset), createdById: ADMIN_USER_ID } });
    for (let index = 0; index < responseCount; index += 1) {
      const responseId = `${id}-response-${index + 1}`;
      await db.surveyResponse.upsert({ where: { id: responseId }, update: { tenantId: TENANT_ID, campaignId: id, respondentTokenHash: digest(`${id}-${index}`), employmentId: null, submittedAt: addDays(opensAt, Math.min(index + 1, 7)) }, create: { id: responseId, tenantId: TENANT_ID, campaignId: id, respondentTokenHash: digest(`${id}-${index}`), employmentId: null, submittedAt: addDays(opensAt, Math.min(index + 1, 7)) } });
    }
  }
}

async function seedPlanning() {
  const scenarios = [
    ["scenario-fy27-base", "FY27-BASE", "FY27 Base", "APPROVED", 12, -30],
    ["scenario-cloud-expansion", "FY27-CLOUD", "Cloud Expansion", "REVIEW", 18, -20],
    ["scenario-efficiency", "FY27-EFF", "Efficiency", "DRAFT", 12, -10]
  ];
  for (const [id, code, name, status, horizonMonths, baseOffset] of scenarios) {
    await db.workforceScenario.upsert({ where: { id }, update: { tenantId: TENANT_ID, code, name, description: `${name} governed scenario`, status, baseDate: addDays(now, baseOffset), horizonMonths, currency: "TRY", assumptions: { liveMutation: false }, ownerId: ADMIN_USER_ID, approvedById: status === "APPROVED" ? ADMIN_USER_ID : null, approvedAt: status === "APPROVED" ? addDays(now, -5) : null }, create: { id, tenantId: TENANT_ID, code, name, description: `${name} governed scenario`, status, baseDate: addDays(now, baseOffset), horizonMonths, currency: "TRY", assumptions: { liveMutation: false }, ownerId: ADMIN_USER_ID, approvedById: status === "APPROVED" ? ADMIN_USER_ID : null, approvedAt: status === "APPROVED" ? addDays(now, -5) : null } });
  }

  const lines = [
    ["line-base-eng", "scenario-fy27-base", "org-engineering", "Engineering", 3, 5, 2400000, ["Cloud Architecture", "Platform Engineering"]],
    ["line-base-sec", "scenario-fy27-base", "org-security", "Security", 2, 3, 2700000, ["Cloud Security", "AI Governance"]],
    ["line-base-sales", "scenario-fy27-base", "org-sales", "Sales", 2, 3, 2100000, ["Enterprise Sales"]],
    ["line-cloud-eng", "scenario-cloud-expansion", "org-engineering", "Cloud Platform", 3, 7, 2600000, ["Kubernetes", "SRE"]],
    ["line-cloud-sec", "scenario-cloud-expansion", "org-security", "Cloud Security", 2, 4, 2900000, ["Cloud Security", "AppSec"]],
    ["line-eff-ops", "scenario-efficiency", "org-operations", "Operations", 2, 1.5, 1800000, ["Automation"]]
  ];
  for (const [id, scenarioId, orgUnitId, roleLabel, currentFte, plannedFte, avgAnnualCost, skillsRequired] of lines) {
    await db.workforcePlanLine.upsert({ where: { id }, update: { tenantId: TENANT_ID, scenarioId, orgUnitId, roleLabel, currentFte, plannedFte, avgAnnualCost, demandDriver: "FY27 planning", skillsRequired }, create: { id, tenantId: TENANT_ID, scenarioId, orgUnitId, roleLabel, currentFte, plannedFte, avgAnnualCost, demandDriver: "FY27 planning", skillsRequired } });
  }
}

async function seedAnalytics() {
  const metrics = [
    ["metric-attrition", "VOL_ATTRITION", "Voluntary Attrition", "Retention", "PERCENT", "ROLLING_RATE", 7, 6.8, 10, false],
    ["metric-time-hire", "TIME_TO_HIRE", "Time to Hire", "Recruiting", "DAYS", "MEDIAN", 7, 31, 10, false],
    ["metric-engagement", "ENGAGEMENT_SCORE", "Engagement Score", "Engagement", "SCORE", "AVERAGE", 7, 78.4, 8, false],
    ["metric-small-absence", "SMALL_TEAM_ABSENCE", "Small Team Absence", "Attendance", "PERCENT", "RATE", 7, 12.5, 4, true]
  ];
  for (const [id, key, name, category, unit, aggregation, minPopulation, value, population, suppressed] of metrics) {
    await db.metricDefinition.upsert({ where: { id }, update: { tenantId: TENANT_ID, key, name, description: `${name} governed metric`, category, unit, aggregation, minPopulation, active: true }, create: { id, tenantId: TENANT_ID, key, name, description: `${name} governed metric`, category, unit, aggregation, minPopulation, active: true } });
    await db.metricSnapshot.upsert({ where: { id: `${id}-latest` }, update: { tenantId: TENANT_ID, metricId: id, periodStart: addDays(now, -30), periodEnd: now, value, population, suppressed, generatedAt: now }, create: { id: `${id}-latest`, tenantId: TENANT_ID, metricId: id, periodStart: addDays(now, -30), periodEnd: now, value, population, suppressed, generatedAt: now } });
  }
}

async function seedAI() {
  const interactions = [
    ["ai-interaction-001", "Explain leave policy", "policies", "COMPLETED", "INTERNAL", false, null],
    ["ai-interaction-002", "Summarize workforce scenario", "workforce-planning", "COMPLETED", "CONFIDENTIAL", false, null],
    ["ai-interaction-003", "Prepare HRBP meeting brief", "people", "COMPLETED", "CONFIDENTIAL", false, null],
    ["ai-interaction-004", "Request restricted ER narrative", "employee-relations", "BLOCKED", "RESTRICTED", true, "General assistant cannot access highly restricted ER case content"]
  ];
  for (let index = 0; index < interactions.length; index += 1) {
    const [id, purpose, module, status, classification, restrictedDataAccess, blockedReason] = interactions[index];
    await db.aIInteraction.upsert({ where: { id }, update: { tenantId: TENANT_ID, actorId: ADMIN_USER_ID, purpose, module, status, promptHash: digest(`${purpose}-${index}`), responseHash: status === "COMPLETED" ? digest(`response-${purpose}-${index}`) : null, sourceRefs: { governed: true }, classification, restrictedDataAccess, decisionSupportOnly: true, modelProvider: status === "COMPLETED" ? "openai" : null, modelName: status === "COMPLETED" ? "gpt-enterprise" : null, blockedReason, createdAt: addDays(now, -index), completedAt: status === "COMPLETED" ? addDays(now, -index) : null }, create: { id, tenantId: TENANT_ID, actorId: ADMIN_USER_ID, purpose, module, status, promptHash: digest(`${purpose}-${index}`), responseHash: status === "COMPLETED" ? digest(`response-${purpose}-${index}`) : null, sourceRefs: { governed: true }, classification, restrictedDataAccess, decisionSupportOnly: true, modelProvider: status === "COMPLETED" ? "openai" : null, modelName: status === "COMPLETED" ? "gpt-enterprise" : null, blockedReason, createdAt: addDays(now, -index), completedAt: status === "COMPLETED" ? addDays(now, -index) : null } });
  }
}

async function seedPrivacy() {
  const activities = [
    ["processing-core-hr", "ROPA-HR-001", "Core Employment Administration", "Manage the employment relationship", "CONTRACT", [], "Low"],
    ["processing-payroll", "ROPA-HR-002", "Payroll Administration", "Calculate and administer payroll", "LEGAL_OBLIGATION", [], "Medium"],
    ["processing-health", "ROPA-HR-004", "Occupational Health Accommodation", "Manage legally required workplace accommodations", "LEGAL_OBLIGATION", ["health"], "High"],
    ["processing-security", "ROPA-SEC-001", "Identity and Access Lifecycle", "Provision and revoke workforce access", "LEGITIMATE_INTEREST", [], "Medium"]
  ];
  for (const [id, code, name, purpose, legalBasis, specialCategories, riskRating] of activities) {
    const legitimateInterest = legalBasis === "LEGITIMATE_INTEREST" ? "Protect company systems and information" : null;
    await db.processingActivity.upsert({ where: { id }, update: { tenantId: TENANT_ID, code, name, purpose, legalBasis, legitimateInterest, dataSubjects: ["employees"], dataCategories: ["identity", "employment"], specialCategories, recipients: ["authorized internal functions"], systems: ["HRBP One"], countries: ["TR", "EU"], ownerId: ADMIN_USER_ID, riskRating, active: true }, create: { id, tenantId: TENANT_ID, code, name, purpose, legalBasis, legitimateInterest, dataSubjects: ["employees"], dataCategories: ["identity", "employment"], specialCategories, recipients: ["authorized internal functions"], systems: ["HRBP One"], countries: ["TR", "EU"], ownerId: ADMIN_USER_ID, riskRating, active: true } });
  }

  const dsrs = [
    ["dsr-014", "DSR-2026-014", "person-liam", "ACCESS", "IN_PROGRESS", -12, 8, -11],
    ["dsr-013", "DSR-2026-013", "person-sofia", "RECTIFICATION", "RECEIVED", -4, 26, null],
    ["dsr-012", "DSR-2026-012", "person-ayse", "PORTABILITY", "IDENTITY_VERIFICATION", -2, 28, null],
    ["dsr-011", "DSR-2026-011", "person-david", "ACCESS", "COMPLETED", -40, -10, -39]
  ];
  for (const [id, requestNumber, subjectPersonId, type, status, createdOffset, dueOffset, verifiedOffset] of dsrs) {
    await db.dataSubjectRequest.upsert({ where: { id }, update: { tenantId: TENANT_ID, requestNumber, subjectPersonId, type, status, channel: "Privacy Portal", verifiedAt: verifiedOffset === null ? null : addDays(now, verifiedOffset), ownerId: ADMIN_USER_ID, dueAt: addDays(now, dueOffset), completedAt: status === "COMPLETED" ? addDays(now, -12) : null, createdAt: addDays(now, createdOffset) }, create: { id, tenantId: TENANT_ID, requestNumber, subjectPersonId, type, status, channel: "Privacy Portal", verifiedAt: verifiedOffset === null ? null : addDays(now, verifiedOffset), ownerId: ADMIN_USER_ID, dueAt: addDays(now, dueOffset), completedAt: status === "COMPLETED" ? addDays(now, -12) : null, createdAt: addDays(now, createdOffset) } });
  }

  const transfers = [
    ["transfer-eu-us", "EU analytics processor", "DE", "US", "Analytics Processor Inc.", "SCC", "SCC-2026-01", 75],
    ["transfer-tr-eu", "Turkey to EU payroll support", "TR", "DE", "Payroll Services GmbH", "SCC", "SCC-2026-02", 120],
    ["transfer-eu-eu", "EU internal processing", "DE", "NL", "Acme EU B.V.", "LOCAL", "Intra-group EU processing", null]
  ];
  for (const [id, name, sourceCountry, destinationCountry, recipient, mechanism, safeguardReference, tiaOffset] of transfers) {
    await db.dataTransferRegister.upsert({ where: { id }, update: { tenantId: TENANT_ID, name, sourceCountry, destinationCountry, recipient, dataCategories: ["employment", "analytics"], purpose: "Governed HR processing", mechanism, safeguardReference, transferImpactDueAt: tiaOffset === null ? null : addDays(now, tiaOffset), active: true }, create: { id, tenantId: TENANT_ID, name, sourceCountry, destinationCountry, recipient, dataCategories: ["employment", "analytics"], purpose: "Governed HR processing", mechanism, safeguardReference, transferImpactDueAt: tiaOffset === null ? null : addDays(now, tiaOffset), active: true } });
  }

  const assessments = [
    ["privacy-risk-health", "processing-health", "Occupational health DPIA", "HIGH", true, "IN_PROGRESS", 20],
    ["privacy-risk-ai", null, "HR AI assistant DPIA", "HIGH", true, "REVIEW", 35],
    ["privacy-risk-analytics", null, "People analytics privacy assessment", "MEDIUM", false, "COMPLETED", -5]
  ];
  for (const [id, processingActivityId, name, riskLevel, requiresDpia, status, dueOffset] of assessments) {
    await db.privacyRiskAssessment.upsert({ where: { id }, update: { tenantId: TENANT_ID, processingActivityId, name, riskLevel, requiresDpia, status, ownerId: ADMIN_USER_ID, dueAt: addDays(now, dueOffset), completedAt: status === "COMPLETED" ? addDays(now, -10) : null, findings: { staging: true } }, create: { id, tenantId: TENANT_ID, processingActivityId, name, riskLevel, requiresDpia, status, ownerId: ADMIN_USER_ID, dueAt: addDays(now, dueOffset), completedAt: status === "COMPLETED" ? addDays(now, -10) : null, findings: { staging: true } } });
  }
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) throw new Error("Run scripts/seed-staging.mjs before the governance-planning seed.");
  await seedEngagement();
  await seedPlanning();
  await seedAnalytics();
  await seedAI();
  await seedPrivacy();
  const [campaigns, scenarios, metrics, ai, processing, dsrs] = await Promise.all([
    db.surveyCampaign.count({ where: { tenantId: TENANT_ID } }),
    db.workforceScenario.count({ where: { tenantId: TENANT_ID } }),
    db.metricDefinition.count({ where: { tenantId: TENANT_ID } }),
    db.aIInteraction.count({ where: { tenantId: TENANT_ID } }),
    db.processingActivity.count({ where: { tenantId: TENANT_ID } }),
    db.dataSubjectRequest.count({ where: { tenantId: TENANT_ID } })
  ]);
  console.log(`Governance-planning staging seed ready: campaigns=${campaigns}, scenarios=${scenarios}, metrics=${metrics}, ai=${ai}, processing=${processing}, dsrs=${dsrs}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
