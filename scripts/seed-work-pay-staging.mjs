import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const ADMIN_USER_ID = "user-yakup-evci";
const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth();
const monthCode = `${year}-${String(month + 1).padStart(2, "0")}`;
const dayStart = new Date(Date.UTC(year, month, now.getUTCDate(), 0, 0, 0));
const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0));
const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function atHour(date, hour, minute = 0) {
  const value = new Date(date);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
}

const activeEmployments = [
  "employment-maya", "employment-david", "employment-emma", "employment-lucas", "employment-amira",
  "employment-noah", "employment-sofia", "employment-liam", "employment-ayse", "employment-jonas"
];

async function seedUsersAndRelationships() {
  const users = [
    ["user-maya-manager", "maya.rao", "Maya Rao", "maya.rao@acme.example", "MANAGER"],
    ["user-david-manager", "david.stein", "David Stein", "david.stein@acme.example", "MANAGER"],
    ["user-lucas-manager", "lucas.chen", "Lucas Chen", "lucas.chen@acme.example", "MANAGER"],
    ["user-ayse-employee", "ayse.demir", "Ayşe Demir", "ayse.demir@acme.example", "EMPLOYEE"],
    ["user-time-admin", "time.admin", "Time Administrator", "time.admin@acme.example", "TIME_ADMIN"],
    ["user-comp-admin", "comp.admin", "Compensation Administrator", "comp.admin@acme.example", "COMPENSATION_ADMIN"],
    ["user-payroll-admin", "payroll.admin", "Payroll Administrator", "payroll.admin@acme.example", "PAYROLL_ADMIN"],
    ["user-hr-ops", "hr.ops", "HR Operations", "hr.ops@acme.example", "HR_OPERATIONS"]
  ];

  for (const [id, subject, displayName, email, role] of users) {
    await db.userAccount.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, subject, displayName, email, role, active: true },
      create: { id, tenantId: TENANT_ID, subject, displayName, email, role, active: true }
    });
  }

  const relationships = [
    ["employment-sofia", "employment-maya"],
    ["employment-liam", "employment-david"],
    ["employment-jonas", "employment-lucas"],
    ["employment-ayse", "employment-emma"]
  ];
  for (const [employmentId, managerEmploymentId] of relationships) {
    await db.employment.updateMany({ where: { id: employmentId, tenantId: TENANT_ID }, data: { managerEmploymentId } });
  }
}

async function seedTime() {
  const schedules = [
    ["schedule-tr-standard", "TR-STD", "Türkiye Standard 40h", "Europe/Istanbul", 2400],
    ["schedule-eu-standard", "EU-STD", "EU Standard 40h", "Europe/Berlin", 2400]
  ];
  for (const [id, code, name, timezone, weeklyMinutes] of schedules) {
    await db.workSchedule.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, code, name, timezone, weeklyMinutes, active: true, effectiveFrom: yearStart, effectiveTo: null },
      create: { id, tenantId: TENANT_ID, code, name, timezone, weeklyMinutes, active: true, effectiveFrom: yearStart }
    });
  }

  for (let index = 0; index < activeEmployments.length; index += 1) {
    const employmentId = activeEmployments[index];
    const scheduleId = ["employment-david", "employment-sofia", "employment-liam"].includes(employmentId) ? "schedule-eu-standard" : "schedule-tr-standard";
    await db.workScheduleAssignment.upsert({
      where: { id: `schedule-assignment-${index + 1}` },
      update: { tenantId: TENANT_ID, employmentId, scheduleId, effectiveFrom: yearStart, effectiveTo: null },
      create: { id: `schedule-assignment-${index + 1}`, tenantId: TENANT_ID, employmentId, scheduleId, effectiveFrom: yearStart }
    });
  }

  const statuses = ["APPROVED", "APPROVED", "SUBMITTED", "APPROVED", "APPROVED", "LOCKED", "APPROVED", "SUBMITTED", "APPROVED", "DRAFT"];
  for (let index = 0; index < activeEmployments.length; index += 1) {
    const employmentId = activeEmployments[index];
    const startAt = atHour(dayStart, 6 + (index % 3), 45 + (index % 2) * 10);
    const hasExit = index !== 9;
    const endAt = hasExit ? new Date(startAt.getTime() + (8 * 60 + 20 + index * 3) * 60_000) : null;
    const minutes = hasExit ? Math.round((endAt.getTime() - startAt.getTime()) / 60_000) : 345;
    await db.timeEntry.upsert({
      where: { id: `time-today-${index + 1}` },
      update: {
        tenantId: TENANT_ID, employmentId, workDate: dayStart, startAt, endAt, minutes,
        overtimeMinutes: Math.max(0, minutes - 480), status: statuses[index], source: index % 2 ? "Mobile" : "Access device",
        approvedById: ["APPROVED", "LOCKED"].includes(statuses[index]) ? "user-time-admin" : null,
        approvedAt: ["APPROVED", "LOCKED"].includes(statuses[index]) ? now : null
      },
      create: {
        id: `time-today-${index + 1}`, tenantId: TENANT_ID, employmentId, workDate: dayStart, startAt, endAt, minutes,
        overtimeMinutes: Math.max(0, minutes - 480), status: statuses[index], source: index % 2 ? "Mobile" : "Access device",
        approvedById: ["APPROVED", "LOCKED"].includes(statuses[index]) ? "user-time-admin" : null,
        approvedAt: ["APPROVED", "LOCKED"].includes(statuses[index]) ? now : null
      }
    });
  }
}

async function seedLeave() {
  const types = [
    ["leave-type-annual", "ANNUAL", "Annual Leave", "DAYS", true, true, 20],
    ["leave-type-medical", "MEDICAL", "Medical Leave", "DAYS", true, false, null],
    ["leave-type-personal", "PERSONAL", "Personal Leave", "HOURS", false, true, 16]
  ];
  for (const [id, code, name, unit, paid, requiresApproval, annualAllowance] of types) {
    await db.leaveType.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, code, name, unit, paid, requiresApproval, annualAllowance, active: true },
      create: { id, tenantId: TENANT_ID, code, name, unit, paid, requiresApproval, annualAllowance, active: true }
    });
  }

  for (let index = 0; index < activeEmployments.length; index += 1) {
    await db.leaveBalance.upsert({
      where: { id: `leave-balance-${index + 1}` },
      update: { tenantId: TENANT_ID, employmentId: activeEmployments[index], leaveTypeId: "leave-type-annual", periodYear: year, opening: 5, accrued: 15, used: index % 5, adjustment: 0 },
      create: { id: `leave-balance-${index + 1}`, tenantId: TENANT_ID, employmentId: activeEmployments[index], leaveTypeId: "leave-type-annual", periodYear: year, opening: 5, accrued: 15, used: index % 5, adjustment: 0 }
    });
  }

  const requests = [
    ["leave-req-sofia", "employment-sofia", "leave-type-annual", addDays(dayStart, 3), addDays(dayStart, 5), 3, "PENDING", null],
    ["leave-req-liam", "employment-liam", "leave-type-annual", addDays(dayStart, 8), addDays(dayStart, 12), 5, "PENDING", null],
    ["leave-req-ayse", "employment-ayse", "leave-type-medical", dayStart, dayStart, 1, "APPROVED", "user-hr-ops"],
    ["leave-req-jonas", "employment-jonas", "leave-type-annual", addDays(dayStart, -10), addDays(dayStart, -8), 3, "TAKEN", "user-hr-ops"]
  ];
  for (const [id, employmentId, leaveTypeId, startsAt, endsAt, units, status, approverId] of requests) {
    await db.leaveRequest.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, employmentId, leaveTypeId, startsAt, endsAt, units, status, reason: "Enterprise staging leave request", approverId, decidedAt: approverId ? now : null },
      create: { id, tenantId: TENANT_ID, employmentId, leaveTypeId, startsAt, endsAt, units, status, reason: "Enterprise staging leave request", approverId, decidedAt: approverId ? now : null }
    });
  }
}

async function seedCompensation() {
  const salaryRows = [
    ["maya", "TRY", 3000000], ["david", "EUR", 112000], ["emma", "TRY", 2700000], ["lucas", "TRY", 2300000], ["amira", "TRY", 2100000],
    ["noah", "TRY", 2000000], ["sofia", "EUR", 92000], ["liam", "GBP", 76000], ["ayse", "TRY", 1800000], ["jonas", "EUR", 70000]
  ];
  for (const [name, currency, annualBase] of salaryRows) {
    const employmentId = `employment-${name}`;
    await db.compensationHistory.upsert({
      where: { id: `comp-history-${name}-current` },
      update: { employmentId, currency, annualBase, effectiveFrom: yearStart, effectiveTo: null },
      create: { id: `comp-history-${name}-current`, employmentId, currency, annualBase, effectiveFrom: yearStart }
    });
  }

  const changes = [
    ["comp-change-ayse-review", "employment-ayse", "TRY", 1800000, 2050000, addDays(now, 30), "APPROVAL", "Annual market review", "user-comp-admin", null],
    ["comp-change-sofia-approved", "employment-sofia", "EUR", 92000, 98000, addDays(now, 45), "APPROVED", "Promotion adjustment", "user-comp-admin", ADMIN_USER_ID],
    ["comp-change-jonas-applied", "employment-jonas", "EUR", 65000, 70000, yearStart, "APPLIED", "Annual compensation review", "user-comp-admin", ADMIN_USER_ID]
  ];
  for (const [id, employmentId, currency, currentAnnualBase, proposedAnnualBase, effectiveAt, status, reason, requestedById, approvedById] of changes) {
    await db.compensationChange.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, employmentId, currency, currentAnnualBase, proposedAnnualBase, effectiveAt, status, reason, requestedById, approvedById, approvedAt: approvedById ? now : null },
      create: { id, tenantId: TENANT_ID, employmentId, currency, currentAnnualBase, proposedAnnualBase, effectiveAt, status, reason, requestedById, approvedById, approvedAt: approvedById ? now : null }
    });
  }
}

async function seedPayroll() {
  const packs = [
    ["pay-pack-tr", "TR", "Türkiye Payroll", "2026.1", "TRY"],
    ["pay-pack-de", "DE", "Germany Payroll", "2026.1", "EUR"],
    ["pay-pack-nl", "NL", "Netherlands Payroll", "2026.1", "EUR"]
  ];
  for (const [id, countryCode, name, version, currency] of packs) {
    await db.payrollCountryPack.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, countryCode, name, version, currency, active: true, effectiveFrom: yearStart, effectiveTo: null },
      create: { id, tenantId: TENANT_ID, countryCode, name, version, currency, active: true, effectiveFrom: yearStart }
    });
  }

  const periodDefs = [
    ["pay-period-tr-current", "pay-pack-tr", `TR-${monthCode}`, "REVIEW"],
    ["pay-period-de-current", "pay-pack-de", `DE-${monthCode}`, "CALCULATING"],
    ["pay-period-nl-current", "pay-pack-nl", `NL-${monthCode}`, "APPROVED"]
  ];
  for (const [id, countryPackId, code, status] of periodDefs) {
    await db.payrollPeriod.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, countryPackId, code, startsAt: monthStart, endsAt: monthEnd, payDate: monthEnd, status },
      create: { id, tenantId: TENANT_ID, countryPackId, code, startsAt: monthStart, endsAt: monthEnd, payDate: monthEnd, status }
    });
  }

  const runs = [
    ["pay-run-tr-current", "pay-period-tr-current", "APPROVAL"],
    ["pay-run-de-current", "pay-period-de-current", "CALCULATED"],
    ["pay-run-nl-current", "pay-period-nl-current", "APPROVED"]
  ];
  for (const [id, payrollPeriodId, status] of runs) {
    await db.payrollRun.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, payrollPeriodId, runNumber: 1, status, calculatedAt: status === "CALCULATED" || status === "APPROVAL" || status === "APPROVED" ? now : null, approvedById: status === "APPROVED" ? "user-payroll-admin" : null, approvedAt: status === "APPROVED" ? now : null },
      create: { id, tenantId: TENANT_ID, payrollPeriodId, runNumber: 1, status, calculatedAt: status === "CALCULATED" || status === "APPROVAL" || status === "APPROVED" ? now : null, approvedById: status === "APPROVED" ? "user-payroll-admin" : null, approvedAt: status === "APPROVED" ? now : null }
    });
  }

  const resultDefs = [
    ["pay-result-tr-maya", "pay-run-tr-current", "employment-maya", "TRY", 250000, 230000, 42000, 18000, 190000, 315000],
    ["pay-result-tr-emma", "pay-run-tr-current", "employment-emma", "TRY", 225000, 207000, 37500, 15000, 172500, 283000],
    ["pay-result-tr-ayse", "pay-run-tr-current", "employment-ayse", "TRY", 150000, 138000, 25000, 11000, 114000, 189000],
    ["pay-result-de-sofia", "pay-run-de-current", "employment-sofia", "EUR", 7667, 7200, 1650, 450, 5567, 9200],
    ["pay-result-nl-david", "pay-run-nl-current", "employment-david", "EUR", 9333, 8800, 2100, 500, 6733, 11200]
  ];
  for (const [id, payrollRunId, employmentId, currency, grossPay, taxablePay, taxAmount, deductions, netPay, employerCost] of resultDefs) {
    await db.payrollResult.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, payrollRunId, employmentId, currency, grossPay, taxablePay, taxAmount, deductions, netPay, employerCost, classification: "RESTRICTED", calculatedAt: now },
      create: { id, tenantId: TENANT_ID, payrollRunId, employmentId, currency, grossPay, taxablePay, taxAmount, deductions, netPay, employerCost, classification: "RESTRICTED", calculatedAt: now }
    });
  }
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) throw new Error("Run scripts/seed-staging.mjs before the work/pay seed.");

  await seedUsersAndRelationships();
  await seedTime();
  await seedLeave();
  await seedCompensation();
  await seedPayroll();

  const counts = await Promise.all([
    db.workSchedule.count({ where: { tenantId: TENANT_ID } }),
    db.timeEntry.count({ where: { tenantId: TENANT_ID } }),
    db.leaveRequest.count({ where: { tenantId: TENANT_ID } }),
    db.compensationChange.count({ where: { tenantId: TENANT_ID } }),
    db.payrollRun.count({ where: { tenantId: TENANT_ID } }),
    db.payrollResult.count({ where: { tenantId: TENANT_ID } })
  ]);

  console.log(`Work/pay staging ready: schedules=${counts[0]}, timeEntries=${counts[1]}, leaveRequests=${counts[2]}, compChanges=${counts[3]}, payrollRuns=${counts[4]}, payrollResults=${counts[5]}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
