import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const TENANT_ID = "tenant-acme-global";
const ADMIN_USER_ID = "user-yakup-evci";
const effectiveFrom = new Date("2026-01-01T00:00:00.000Z");
const now = new Date();

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthsAgo(months, day = 1) {
  const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day, 9, 0, 0));
  return value;
}

async function main() {
  await db.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: "Acme Global", region: "EU" },
    create: { id: TENANT_ID, name: "Acme Global", region: "EU" }
  });

  await db.userAccount.upsert({
    where: { id: ADMIN_USER_ID },
    update: {
      tenantId: TENANT_ID,
      subject: "yakup.evci",
      displayName: "Yakup Evci",
      email: "yakup.evci@example.com",
      role: "TENANT_ADMIN",
      active: true
    },
    create: {
      id: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      subject: "yakup.evci",
      displayName: "Yakup Evci",
      email: "yakup.evci@example.com",
      role: "TENANT_ADMIN",
      active: true
    }
  });

  const orgUnits = [
    { id: "org-acme-global", code: "ACME", name: "Acme Global", type: "LEGAL_ENTITY", parentId: null },
    { id: "org-engineering", code: "ENG", name: "Engineering", type: "DEPARTMENT", parentId: "org-acme-global" },
    { id: "org-sales", code: "SALES", name: "Sales", type: "DEPARTMENT", parentId: "org-acme-global" },
    { id: "org-operations", code: "OPS", name: "Operations", type: "DEPARTMENT", parentId: "org-acme-global" },
    { id: "org-finance", code: "FIN", name: "Finance", type: "DEPARTMENT", parentId: "org-acme-global" },
    { id: "org-people", code: "PEOPLE", name: "People", type: "DEPARTMENT", parentId: "org-acme-global" },
    { id: "org-security", code: "SEC", name: "Security", type: "DEPARTMENT", parentId: "org-acme-global" }
  ];

  for (const unit of orgUnits) {
    await db.organizationUnit.upsert({
      where: { id: unit.id },
      update: { tenantId: TENANT_ID, code: unit.code, name: unit.name, type: unit.type, parentId: unit.parentId, validFrom: effectiveFrom, validTo: null },
      create: { ...unit, tenantId: TENANT_ID, validFrom: effectiveFrom }
    });
  }

  const positions = [
    ["pos-eng-01", "ENG-001", "Engineering Manager", "org-engineering", "Engineering", "M3", "Istanbul", "FILLED", true],
    ["pos-eng-02", "ENG-002", "Senior Software Engineer", "org-engineering", "Engineering", "IC4", "Istanbul", "FILLED", false],
    ["pos-eng-03", "ENG-003", "Platform Engineer", "org-engineering", "Engineering", "IC3", "Berlin", "FILLED", false],
    ["pos-sales-01", "SAL-001", "Regional Sales Lead", "org-sales", "Sales", "M2", "Amsterdam", "FILLED", false],
    ["pos-sales-02", "SAL-002", "Account Executive", "org-sales", "Sales", "IC3", "London", "FILLED", false],
    ["pos-ops-01", "OPS-001", "Operations Manager", "org-operations", "Operations", "M2", "Istanbul", "FILLED", false],
    ["pos-ops-02", "OPS-002", "Business Operations Analyst", "org-operations", "Operations", "IC3", "Istanbul", "FILLED", false],
    ["pos-fin-01", "FIN-001", "Finance Business Partner", "org-finance", "Finance", "IC4", "Istanbul", "FILLED", false],
    ["pos-people-01", "PPL-001", "HR Business Partner", "org-people", "People", "IC4", "Istanbul", "FILLED", false],
    ["pos-sec-01", "SEC-001", "Security Architect", "org-security", "Security", "IC5", "Istanbul", "FILLED", true],
    ["pos-sec-02", "SEC-002", "Security Engineer", "org-security", "Security", "IC4", "Istanbul", "FILLED", false],
    ["pos-eng-04", "ENG-004", "Senior Backend Engineer", "org-engineering", "Engineering", "IC4", "Remote EU", "OPEN", true],
    ["pos-sec-03", "SEC-003", "Head of Cyber Security", "org-security", "Security", "M4", "Istanbul", "OPEN", true],
    ["pos-sales-03", "SAL-003", "Enterprise Account Manager", "org-sales", "Sales", "IC4", "Munich", "OPEN", false]
  ];

  for (const [id, positionCode, title, orgUnitId, jobFamily, grade, location, status, critical] of positions) {
    await db.position.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, orgUnitId, positionCode, title, jobFamily, grade, location, status, critical, validFrom: effectiveFrom, validTo: null },
      create: { id, tenantId: TENANT_ID, orgUnitId, positionCode, title, jobFamily, grade, location, status, critical, validFrom: effectiveFrom }
    });
  }

  const people = [
    ["person-maya", "E0001", "Maya", "Rao", "maya.rao@acme.example", "pos-eng-01", "ACTIVE", monthsAgo(28)],
    ["person-david", "E0002", "David", "Stein", "david.stein@acme.example", "pos-sales-01", "ACTIVE", monthsAgo(24)],
    ["person-emma", "E0003", "Emma", "Aydın", "emma.aydin@acme.example", "pos-sec-01", "ACTIVE", monthsAgo(22)],
    ["person-lucas", "E0004", "Lucas", "Chen", "lucas.chen@acme.example", "pos-ops-01", "ACTIVE", monthsAgo(20)],
    ["person-amira", "E0005", "Amira", "Hassan", "amira.hassan@acme.example", "pos-fin-01", "ACTIVE", monthsAgo(18)],
    ["person-noah", "E0006", "Noah", "Williams", "noah.williams@acme.example", "pos-people-01", "ACTIVE", monthsAgo(16)],
    ["person-sofia", "E0007", "Sofia", "Marin", "sofia.marin@acme.example", "pos-eng-02", "ACTIVE", monthsAgo(12)],
    ["person-liam", "E0008", "Liam", "Brooks", "liam.brooks@acme.example", "pos-sales-02", "ACTIVE", monthsAgo(9)],
    ["person-ayse", "E0009", "Ayşe", "Demir", "ayse.demir@acme.example", "pos-sec-02", "ACTIVE", monthsAgo(6)],
    ["person-jonas", "E0010", "Jonas", "Keller", "jonas.keller@acme.example", "pos-ops-02", "ACTIVE", monthsAgo(3)],
    ["person-elena", "E0011", "Elena", "Rossi", "elena.rossi@acme.example", "pos-eng-03", "PREBOARDING", addDays(now, 7)],
    ["person-clara", "E0012", "Clara", "Moretti", "clara.moretti@acme.example", "pos-eng-02", "PREBOARDING", addDays(now, 18)]
  ];

  for (const [personId, employeeNumber, givenName, familyName, workEmail, positionId, status, startDate] of people) {
    await db.person.upsert({
      where: { id: personId },
      update: { tenantId: TENANT_ID, employeeNumber, givenName, familyName, workEmail, classification: "CONFIDENTIAL" },
      create: { id: personId, tenantId: TENANT_ID, employeeNumber, givenName, familyName, workEmail, classification: "CONFIDENTIAL" }
    });

    const employmentId = `employment-${personId.replace("person-", "")}`;
    await db.employment.upsert({
      where: { id: employmentId },
      update: { tenantId: TENANT_ID, personId, positionId, status, startDate, endDate: null },
      create: { id: employmentId, tenantId: TENANT_ID, personId, positionId, status, startDate }
    });
  }

  const preboarders = [
    ["onboarding-elena", "person-elena", "employment-elena", addDays(now, 7)],
    ["onboarding-clara", "person-clara", "employment-clara", addDays(now, 18)]
  ];

  for (const [id, personId, employmentId, targetStartDate] of preboarders) {
    await db.onboardingPlan.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, personId, employmentId, status: "IN_PROGRESS", targetStartDate, ownerId: ADMIN_USER_ID },
      create: { id, tenantId: TENANT_ID, personId, employmentId, status: "IN_PROGRESS", targetStartDate, ownerId: ADMIN_USER_ID }
    });
  }

  const cases = [
    ["case-001", "ER-2026-001", "Employee Relations", "Workplace conduct review", "ACTION_REQUIRED", "person-liam"],
    ["case-002", "ER-2026-002", "Employee Relations", "Manager escalation", "INVESTIGATING", "person-jonas"]
  ];

  for (const [id, caseNumber, caseType, title, status, subjectPersonId] of cases) {
    await db.employeeCase.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, subjectPersonId, caseNumber, caseType, title, status, classification: "HIGHLY_RESTRICTED", ownerUserId: ADMIN_USER_ID },
      create: { id, tenantId: TENANT_ID, subjectPersonId, caseNumber, caseType, title, status, classification: "HIGHLY_RESTRICTED", ownerUserId: ADMIN_USER_ID }
    });
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 8, 0, 0));
  const lifecycleEvents = [
    ["life-001", "person-maya", "employment-maya", "PROMOTED", addDays(monthStart, 3), "Promoted to Engineering Manager"],
    ["life-002", "person-david", "employment-david", "MANAGER_CHANGED", addDays(monthStart, 6), "Manager assignment updated"],
    ["life-003", "person-emma", "employment-emma", "COMPENSATION_CHANGED", addDays(monthStart, 9), "Annual compensation review completed"],
    ["life-004", "person-lucas", "employment-lucas", "TRANSFERRED", addDays(monthStart, 12), "Transferred into Operations"],
    ["life-005", "person-jonas", "employment-jonas", "HIRED", addDays(monthStart, 1), "Joined Acme Global"],
    ["life-006", "person-elena", "employment-elena", "HIRED", addDays(now, 7), "Scheduled to join Engineering"],
    ["life-007", "person-clara", "employment-clara", "HIRED", addDays(now, 18), "Scheduled to join Engineering"]
  ];

  for (const [id, personId, employmentId, type, effectiveAt, summary] of lifecycleEvents) {
    await db.employeeLifecycleEvent.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, personId, employmentId, type, effectiveAt, summary, actorId: ADMIN_USER_ID },
      create: { id, tenantId: TENANT_ID, personId, employmentId, type, effectiveAt, summary, actorId: ADMIN_USER_ID }
    });
  }

  const counts = await Promise.all([
    db.person.count({ where: { tenantId: TENANT_ID } }),
    db.employment.count({ where: { tenantId: TENANT_ID, status: "ACTIVE" } }),
    db.position.count({ where: { tenantId: TENANT_ID, status: "OPEN" } }),
    db.employeeCase.count({ where: { tenantId: TENANT_ID, status: { in: ["OPEN", "INVESTIGATING", "ACTION_REQUIRED"] } } })
  ]);

  console.log(`Staging seed ready: people=${counts[0]}, active=${counts[1]}, openPositions=${counts[2]}, openCases=${counts[3]}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
