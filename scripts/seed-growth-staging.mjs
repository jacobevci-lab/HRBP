import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const ADMIN_USER_ID = "user-yakup-evci";
const now = new Date();
const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 8, 0, 0));
const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 17, 0, 0));

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

const employments = ["maya", "david", "emma", "lucas", "amira", "noah", "sofia", "liam", "ayse", "jonas"].map((value) => `employment-${value}`);

async function seedBenefits() {
  const plans = [
    ["benefit-health-tr", "HEALTH-TR", "Private Health Insurance", "HEALTH", "Acme Health", "TR", "TRY", 4200, 500],
    ["benefit-meal", "MEAL-GLOBAL", "Meal Allowance", "MEAL", "Acme Benefits", null, "EUR", 180, 0],
    ["benefit-life", "LIFE-GLOBAL", "Life Insurance", "LIFE", "Acme Assurance", null, "EUR", 55, 0],
    ["benefit-flex", "FLEX-EU", "Flexible Benefits Wallet", "FLEXIBLE", "Acme Benefits", null, "EUR", 125, 0]
  ];

  for (const [id, code, name, type, provider, countryCode, currency, employerContribution, employeeContribution] of plans) {
    await db.benefitPlan.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, code, name, type, provider, countryCode, currency, employerContribution, employeeContribution, active: true, effectiveFrom: yearStart, effectiveTo: null },
      create: { id, tenantId: TENANT_ID, code, name, type, provider, countryCode, currency, employerContribution, employeeContribution, active: true, effectiveFrom: yearStart }
    });
  }

  for (let employmentIndex = 0; employmentIndex < employments.length; employmentIndex += 1) {
    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      const employmentId = employments[employmentIndex];
      const planId = plans[planIndex][0];
      const id = `benefit-enrollment-${employmentIndex + 1}-${planIndex + 1}`;
      const status = employmentIndex === 9 && planIndex === 3 ? "PENDING" : "ACTIVE";
      await db.benefitEnrollment.upsert({
        where: { id },
        update: { tenantId: TENANT_ID, employmentId, benefitPlanId: planId, status, coverageTier: planIndex === 0 ? "Employee + Family" : "Employee", effectiveFrom: yearStart, effectiveTo: null },
        create: { id, tenantId: TENANT_ID, employmentId, benefitPlanId: planId, status, coverageTier: planIndex === 0 ? "Employee + Family" : "Employee", effectiveFrom: yearStart }
      });
    }
  }
}

async function seedPerformance() {
  await db.reviewCycle.upsert({
    where: { id: "review-cycle-2026" },
    update: { tenantId: TENANT_ID, name: "2026 Annual Performance", status: "OPEN", startsAt: yearStart, endsAt: yearEnd, calibrationAt: addDays(yearEnd, -14) },
    create: { id: "review-cycle-2026", tenantId: TENANT_ID, name: "2026 Annual Performance", status: "OPEN", startsAt: yearStart, endsAt: yearEnd, calibrationAt: addDays(yearEnd, -14) }
  });

  const reviewStates = ["FINALIZED", "FINALIZED", "FINALIZED", "CALIBRATION", "MANAGER_REVIEW", "MANAGER_REVIEW", "SELF_REVIEW", "FINALIZED", "CALIBRATION", "NOT_STARTED"];
  const finalRatings = ["EXCEEDS", "MEETS", "OUTSTANDING", null, null, null, null, "MEETS", null, null];
  for (let index = 0; index < employments.length; index += 1) {
    await db.performanceReview.upsert({
      where: { id: `review-2026-${index + 1}` },
      update: { tenantId: TENANT_ID, cycleId: "review-cycle-2026", employmentId: employments[index], status: reviewStates[index], finalRating: finalRatings[index], summary: "Enterprise staging performance review", classification: "CONFIDENTIAL" },
      create: { id: `review-2026-${index + 1}`, tenantId: TENANT_ID, cycleId: "review-cycle-2026", employmentId: employments[index], status: reviewStates[index], finalRating: finalRatings[index], summary: "Enterprise staging performance review", classification: "CONFIDENTIAL" }
    });
  }

  const goalTitles = [
    "Deliver strategic operating plan", "Improve customer retention", "Raise security posture", "Automate operational controls", "Improve forecast accuracy",
    "Modernize people operations", "Reduce platform toil", "Expand enterprise pipeline", "Strengthen vulnerability management", "Improve process cycle time"
  ];
  for (let index = 0; index < employments.length; index += 1) {
    const status = index === 2 || index === 7 ? "AT_RISK" : index < 3 ? "COMPLETED" : "ACTIVE";
    const progress = status === "COMPLETED" ? 100 : status === "AT_RISK" ? 42 + index : 58 + index * 3;
    await db.goal.upsert({
      where: { id: `goal-2026-${index + 1}` },
      update: { tenantId: TENANT_ID, employmentId: employments[index], title: goalTitles[index], weight: 100, progress: Math.min(progress, 95), status, startsAt: yearStart, dueAt: yearEnd },
      create: { id: `goal-2026-${index + 1}`, tenantId: TENANT_ID, employmentId: employments[index], title: goalTitles[index], weight: 100, progress: Math.min(progress, 95), status, startsAt: yearStart, dueAt: yearEnd }
    });
  }
}

async function seedTalent() {
  const assessments = [
    ["EXCEEDS", "HIGH", true], ["MEETS", "MODERATE", false], ["OUTSTANDING", "HIGH", true], ["MEETS", "HIGH", true], ["MEETS", "MODERATE", false],
    ["EXCEEDS", "HIGH", false], ["MEETS", "MODERATE", false], ["DEVELOPING", "MODERATE", false], ["EXCEEDS", "HIGH", true], ["MEETS", "LIMITED", false]
  ];
  for (let index = 0; index < employments.length; index += 1) {
    const [performance, potential, criticalTalent] = assessments[index];
    await db.talentAssessment.upsert({
      where: { id: `talent-2026-${index + 1}` },
      update: { tenantId: TENANT_ID, employmentId: employments[index], cycleLabel: "2026 Talent Review", performance, potential, criticalTalent, assessedById: ADMIN_USER_ID, notes: "Human-reviewed staging assessment", classification: "CONFIDENTIAL" },
      create: { id: `talent-2026-${index + 1}`, tenantId: TENANT_ID, employmentId: employments[index], cycleLabel: "2026 Talent Review", performance, potential, criticalTalent, assessedById: ADMIN_USER_ID, notes: "Human-reviewed staging assessment", classification: "CONFIDENTIAL" }
    });
  }

  const plans = [
    ["succession-eng-manager", "pos-eng-01", "Engineering leadership continuity", addDays(now, 60)],
    ["succession-sec-architect", "pos-sec-01", "Security leadership continuity", addDays(now, 45)],
    ["succession-ops-manager", "pos-ops-01", "Operations continuity", addDays(now, 90)]
  ];
  for (const [id, positionId, name, reviewDueAt] of plans) {
    await db.successionPlan.upsert({ where: { id }, update: { tenantId: TENANT_ID, positionId, name, active: true, ownerId: ADMIN_USER_ID, reviewDueAt }, create: { id, tenantId: TENANT_ID, positionId, name, active: true, ownerId: ADMIN_USER_ID, reviewDueAt } });
  }

  const candidates = [
    ["succ-cand-1", "succession-eng-manager", "employment-sofia", "READY_LT_1_YEAR", 1, "Broaden people leadership exposure"],
    ["succ-cand-2", "succession-eng-manager", "employment-lucas", "READY_1_2_YEARS", 2, "Build engineering domain depth"],
    ["succ-cand-3", "succession-sec-architect", "employment-ayse", "READY_NOW", 1, "Maintain architecture governance exposure"],
    ["succ-cand-4", "succession-ops-manager", "employment-jonas", "READY_LT_1_YEAR", 1, "Lead cross-functional planning cycles"]
  ];
  for (const [id, planId, employmentId, readiness, rank, developmentGap] of candidates) {
    await db.successionCandidate.upsert({ where: { id }, update: { tenantId: TENANT_ID, planId, employmentId, readiness, rank, developmentGap }, create: { id, tenantId: TENANT_ID, planId, employmentId, readiness, rank, developmentGap } });
  }
}

async function seedLearning() {
  const skills = [
    ["skill-cloud-security", "SK-CLOUDSEC", "Cloud Security", "Security", true],
    ["skill-leadership", "SK-LEAD", "People Leadership", "Leadership", true],
    ["skill-data", "SK-DATA", "Data Literacy", "Digital", false],
    ["skill-risk", "SK-RISK", "Risk Management", "Governance", true],
    ["skill-automation", "SK-AUTO", "Automation", "Digital", false]
  ];
  for (const [id, code, name, category, critical] of skills) {
    await db.skill.upsert({ where: { id }, update: { tenantId: TENANT_ID, code, name, category, critical, active: true }, create: { id, tenantId: TENANT_ID, code, name, category, critical, active: true } });
  }

  const proficiencies = ["EXPERT", "ADVANCED", "PRACTITIONER", "ADVANCED", "FOUNDATION"];
  for (let employmentIndex = 0; employmentIndex < employments.length; employmentIndex += 1) {
    for (let skillIndex = 0; skillIndex < skills.length; skillIndex += 1) {
      if ((employmentIndex + skillIndex) % 2 !== 0 && skillIndex > 1) continue;
      await db.employmentSkill.upsert({
        where: { id: `employment-skill-${employmentIndex + 1}-${skillIndex + 1}` },
        update: { tenantId: TENANT_ID, employmentId: employments[employmentIndex], skillId: skills[skillIndex][0], proficiency: proficiencies[(employmentIndex + skillIndex) % proficiencies.length], source: "Manager assessment", assessedAt: now },
        create: { id: `employment-skill-${employmentIndex + 1}-${skillIndex + 1}`, tenantId: TENANT_ID, employmentId: employments[employmentIndex], skillId: skills[skillIndex][0], proficiency: proficiencies[(employmentIndex + skillIndex) % proficiencies.length], source: "Manager assessment", assessedAt: now }
      });
    }
  }

  const courses = [
    ["course-security", "LRN-SEC-001", "Security & Privacy Essentials", "Acme Academy", true, 12],
    ["course-conduct", "LRN-HR-001", "Code of Conduct", "Acme Academy", true, 12],
    ["course-manager", "LRN-MGR-001", "Manager Foundations", "Acme Academy", false, 24],
    ["course-ai", "LRN-AI-001", "Responsible AI at Work", "Acme Academy", true, 12]
  ];
  for (const [id, code, title, provider, mandatory, validityMonths] of courses) {
    await db.learningCourse.upsert({ where: { id }, update: { tenantId: TENANT_ID, code, title, provider, mandatory, validityMonths, active: true }, create: { id, tenantId: TENANT_ID, code, title, provider, mandatory, validityMonths, active: true } });
  }

  for (let employmentIndex = 0; employmentIndex < employments.length; employmentIndex += 1) {
    for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
      const assignmentId = `learning-${employmentIndex + 1}-${courseIndex + 1}`;
      const status = employmentIndex === 8 && courseIndex === 0 ? "OVERDUE" : employmentIndex + courseIndex < 7 ? "COMPLETED" : "IN_PROGRESS";
      const dueAt = status === "OVERDUE" ? addDays(now, -5) : addDays(now, 14 + courseIndex * 8);
      await db.learningAssignment.upsert({
        where: { id: assignmentId },
        update: { tenantId: TENANT_ID, employmentId: employments[employmentIndex], courseId: courses[courseIndex][0], status, assignedAt: yearStart, dueAt, completedAt: status === "COMPLETED" ? addDays(now, -20) : null, score: status === "COMPLETED" ? 92 : null },
        create: { id: assignmentId, tenantId: TENANT_ID, employmentId: employments[employmentIndex], courseId: courses[courseIndex][0], status, assignedAt: yearStart, dueAt, completedAt: status === "COMPLETED" ? addDays(now, -20) : null, score: status === "COMPLETED" ? 92 : null }
      });
    }
  }
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) throw new Error("Run scripts/seed-staging.mjs before the growth seed.");
  await seedBenefits();
  await seedPerformance();
  await seedTalent();
  await seedLearning();

  const [benefitPlans, goals, reviews, talent, succession, skills, courses] = await Promise.all([
    db.benefitPlan.count({ where: { tenantId: TENANT_ID } }),
    db.goal.count({ where: { tenantId: TENANT_ID } }),
    db.performanceReview.count({ where: { tenantId: TENANT_ID } }),
    db.talentAssessment.count({ where: { tenantId: TENANT_ID } }),
    db.successionPlan.count({ where: { tenantId: TENANT_ID } }),
    db.skill.count({ where: { tenantId: TENANT_ID } }),
    db.learningCourse.count({ where: { tenantId: TENANT_ID } })
  ]);
  console.log({ benefitPlans, goals, reviews, talent, succession, skills, courses });
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
