import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const ADMIN_USER_ID = "user-yakup-evci";
const ER_USER_ID = "user-er-investigator";
const now = new Date();
const employments = ["maya", "david", "emma", "lucas", "amira", "noah", "sofia", "liam", "ayse", "jonas"].map((value) => `employment-${value}`);

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function seedInvestigatorAndCases() {
  await db.userAccount.upsert({
    where: { id: ER_USER_ID },
    update: { tenantId: TENANT_ID, subject: "er.investigator", displayName: "ER Investigator", email: "er.investigator@acme.example", role: "ER_INVESTIGATOR", active: true },
    create: { id: ER_USER_ID, tenantId: TENANT_ID, subject: "er.investigator", displayName: "ER Investigator", email: "er.investigator@acme.example", role: "ER_INVESTIGATOR", active: true }
  });

  const cases = [
    ["case-001", "ER-2026-001", "Conduct", "Workplace conduct review", "INVESTIGATING", "person-liam", addDays(now, -11)],
    ["case-002", "ER-2026-002", "Grievance", "Manager escalation", "ACTION_REQUIRED", "person-jonas", addDays(now, -18)],
    ["case-003", "ER-2026-003", "Conflict", "Workplace conflict review", "OPEN", "person-sofia", addDays(now, -5)],
    ["case-004", "ER-2026-004", "Policy breach", "Acceptable use investigation", "RESOLVED", "person-ayse", addDays(now, -31)]
  ];

  for (const [id, caseNumber, caseType, title, status, subjectPersonId, openedAt] of cases) {
    await db.employeeCase.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, subjectPersonId, caseNumber, caseType, title, status, classification: "HIGHLY_RESTRICTED", ownerUserId: ER_USER_ID, openedAt, closedAt: status === "RESOLVED" ? addDays(now, -2) : null },
      create: { id, tenantId: TENANT_ID, subjectPersonId, caseNumber, caseType, title, status, classification: "HIGHLY_RESTRICTED", ownerUserId: ER_USER_ID, openedAt, closedAt: status === "RESOLVED" ? addDays(now, -2) : null }
    });
    await db.caseAssignment.upsert({
      where: { caseId_userId: { caseId: id, userId: ER_USER_ID } },
      update: { assignedAt: openedAt },
      create: { caseId: id, userId: ER_USER_ID, assignedAt: openedAt }
    });
  }

  const allegations = [
    ["allegation-001", "case-001", "Conduct", "Reported workplace conduct concern", "HIGH", "INVESTIGATING", "POL-HR-001"],
    ["allegation-002", "case-002", "Grievance", "Employee grievance requiring corrective action", "MEDIUM", "SUBSTANTIATED", "POL-HR-011"],
    ["allegation-003", "case-003", "Conflict", "Interpersonal conflict requiring triage", "MEDIUM", "OPEN", null],
    ["allegation-004", "case-004", "Acceptable Use", "Potential acceptable-use policy breach", "HIGH", "CLOSED", "POL-SEC-004"]
  ];
  for (const [id, caseId, category, description, severity, status, policyCode] of allegations) {
    await db.caseAllegation.upsert({ where: { id }, update: { tenantId: TENANT_ID, caseId, category, description, severity, status, policyCode, classification: "HIGHLY_RESTRICTED" }, create: { id, tenantId: TENANT_ID, caseId, category, description, severity, status, policyCode, classification: "HIGHLY_RESTRICTED" } });
  }

  await db.caseFinding.upsert({
    where: { id: "finding-002" },
    update: { tenantId: TENANT_ID, caseId: "case-002", allegationId: "allegation-002", finding: "SUBSTANTIATED", rationale: "Evidence review completed and human decision recorded.", decidedById: ER_USER_ID, classification: "HIGHLY_RESTRICTED" },
    create: { id: "finding-002", tenantId: TENANT_ID, caseId: "case-002", allegationId: "allegation-002", finding: "SUBSTANTIATED", rationale: "Evidence review completed and human decision recorded.", decidedById: ER_USER_ID, classification: "HIGHLY_RESTRICTED" }
  });
  await db.caseFinding.upsert({
    where: { id: "finding-004" },
    update: { tenantId: TENANT_ID, caseId: "case-004", allegationId: "allegation-004", finding: "POLICY_BREACH", rationale: "Policy breach confirmed by assigned investigator.", decidedById: ER_USER_ID, classification: "HIGHLY_RESTRICTED" },
    create: { id: "finding-004", tenantId: TENANT_ID, caseId: "case-004", allegationId: "allegation-004", finding: "POLICY_BREACH", rationale: "Policy breach confirmed by assigned investigator.", decidedById: ER_USER_ID, classification: "HIGHLY_RESTRICTED" }
  });

  const actions = [
    ["case-action-001", "case-001", "employment-liam", "Investigation follow-up", "Complete remaining witness interviews", "IN_PROGRESS", addDays(now, 3)],
    ["case-action-002", "case-002", "employment-jonas", "Manager action", "Complete corrective-action plan", "OPEN", addDays(now, 5)],
    ["case-action-004", "case-004", "employment-ayse", "Closure", "Document final remediation evidence", "COMPLETED", addDays(now, -3)]
  ];
  for (const [id, caseId, subjectEmploymentId, actionType, description, status, dueAt] of actions) {
    await db.caseAction.upsert({ where: { id }, update: { tenantId: TENANT_ID, caseId, subjectEmploymentId, actionType, description, ownerId: ER_USER_ID, dueAt, status, completedAt: status === "COMPLETED" ? addDays(now, -2) : null }, create: { id, tenantId: TENANT_ID, caseId, subjectEmploymentId, actionType, description, ownerId: ER_USER_ID, dueAt, status, completedAt: status === "COMPLETED" ? addDays(now, -2) : null } });
  }

  await db.caseAppeal.upsert({
    where: { id: "appeal-002" },
    update: { tenantId: TENANT_ID, caseId: "case-002", requestedById: "employment-jonas", grounds: "Request for independent review of corrective action", status: "REVIEWING", reviewerId: ER_USER_ID, classification: "HIGHLY_RESTRICTED" },
    create: { id: "appeal-002", tenantId: TENANT_ID, caseId: "case-002", requestedById: "employment-jonas", grounds: "Request for independent review of corrective action", status: "REVIEWING", reviewerId: ER_USER_ID, classification: "HIGHLY_RESTRICTED" }
  });
}

async function seedHRService() {
  const requests = [
    ["hr-request-001", "HR-2026-1842", "Employment letter", "Employment verification letter", "IN_PROGRESS", "MEDIUM", "HR Operations", addHours(now, -1), addHours(now, 20), addHours(now, -0.4), null],
    ["hr-request-002", "HR-2026-1839", "Payroll", "Payroll query", "WAITING_EMPLOYEE", "HIGH", "Payroll", addHours(now, -3), addHours(now, 5), addHours(now, -2.4), null],
    ["hr-request-003", "HR-2026-1837", "Benefits", "Dependent coverage change", "IN_PROGRESS", "MEDIUM", "Total Rewards", addHours(now, -7), addHours(now, 17), addHours(now, -6.2), null],
    ["hr-request-004", "HR-2026-1828", "Policy", "Remote work policy question", "OPEN", "LOW", "HRBP", addHours(now, -12), addHours(now, 60), null, null],
    ["hr-request-005", "HR-2026-1811", "Leave", "Annual leave balance correction", "RESOLVED", "MEDIUM", "HR Operations", addDays(now, -4), addDays(now, -3), addHours(addDays(now, -4), 1), addHours(addDays(now, -4), 8)],
    ["hr-request-006", "HR-2026-1804", "Payroll", "Payslip clarification", "RESOLVED", "MEDIUM", "Payroll", addDays(now, -5), addDays(now, -4), addHours(addDays(now, -5), 2), addHours(addDays(now, -5), 14)],
    ["hr-request-007", "HR-2026-1791", "Benefits", "Pension enrollment", "RESOLVED", "LOW", "Total Rewards", addDays(now, -7), addDays(now, -4), addHours(addDays(now, -7), 3), addDays(now, -5)],
    ["hr-request-008", "HR-2026-1788", "Employment", "Contract copy request", "CLOSED", "LOW", "HR Operations", addDays(now, -8), addDays(now, -5), addHours(addDays(now, -8), 1), addDays(now, -6)]
  ];

  for (let index = 0; index < requests.length; index += 1) {
    const [id, requestNumber, category, title, status, priority, queue, createdAt, slaDueAt, firstResponseAt, resolvedAt] = requests[index];
    await db.hRServiceRequest.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, requestNumber, requestorId: ADMIN_USER_ID, subjectEmploymentId: employments[index % employments.length], category, title, description: `${title} - staging service request`, status, priority, assigneeId: ADMIN_USER_ID, queue, slaDueAt, firstResponseAt, resolvedAt, closedAt: status === "CLOSED" ? resolvedAt : null, classification: "CONFIDENTIAL", createdAt },
      create: { id, tenantId: TENANT_ID, requestNumber, requestorId: ADMIN_USER_ID, subjectEmploymentId: employments[index % employments.length], category, title, description: `${title} - staging service request`, status, priority, assigneeId: ADMIN_USER_ID, queue, slaDueAt, firstResponseAt, resolvedAt, closedAt: status === "CLOSED" ? resolvedAt : null, classification: "CONFIDENTIAL", createdAt }
    });
  }
}

async function seedPolicies() {
  const policies = [
    ["policy-conduct", "POL-HR-001", "Code of Conduct", "4.2", "PUBLISHED", "Global", "All employees", addDays(now, 100)],
    ["policy-remote", "POL-HR-006", "Remote Work", "3.1", "PUBLISHED", "Global", "Eligible employees", addDays(now, 45)],
    ["policy-aup", "POL-SEC-004", "Acceptable Use", "5.0", "PUBLISHED", "Global", "All workforce", addDays(now, 130)],
    ["policy-disciplinary", "POL-HR-011", "Disciplinary Process", "2.4", "REVIEW", "TR/EU", "Managers & HR", addDays(now, 25)]
  ];

  for (const [id, code, title, version, status, jurisdiction, audience, reviewDueAt] of policies) {
    const contentMarkdown = `# ${title}\n\nEnterprise staging policy ${code} version ${version}.`;
    await db.policyRecord.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, code, title, version, status, jurisdiction, audience, ownerId: ADMIN_USER_ID, contentMarkdown, contentHash: hash(contentMarkdown), effectiveFrom: addDays(now, -180), reviewDueAt, approvedById: ADMIN_USER_ID, approvedAt: addDays(now, -185), publishedAt: status === "PUBLISHED" ? addDays(now, -180) : null },
      create: { id, tenantId: TENANT_ID, code, title, version, status, jurisdiction, audience, ownerId: ADMIN_USER_ID, contentMarkdown, contentHash: hash(contentMarkdown), effectiveFrom: addDays(now, -180), reviewDueAt, approvedById: ADMIN_USER_ID, approvedAt: addDays(now, -185), publishedAt: status === "PUBLISHED" ? addDays(now, -180) : null }
    });
  }

  for (let policyIndex = 0; policyIndex < policies.length; policyIndex += 1) {
    const policyId = policies[policyIndex][0];
    for (let employmentIndex = 0; employmentIndex < employments.length; employmentIndex += 1) {
      if (policyId === "policy-disciplinary" && employmentIndex > 5) continue;
      const status = employmentIndex === 9 && policyIndex < 2 ? "OVERDUE" : employmentIndex >= 8 ? "PENDING" : "ACKNOWLEDGED";
      const assignmentId = `policy-assignment-${policyIndex + 1}-${employmentIndex + 1}`;
      await db.policyAssignment.upsert({
        where: { id: assignmentId },
        update: { tenantId: TENANT_ID, policyId, employmentId: employments[employmentIndex], dueAt: addDays(now, -2 + policyIndex * 3), status },
        create: { id: assignmentId, tenantId: TENANT_ID, policyId, employmentId: employments[employmentIndex], dueAt: addDays(now, -2 + policyIndex * 3), status }
      });
      if (status === "ACKNOWLEDGED") {
        const acknowledgementId = `policy-ack-${policyIndex + 1}-${employmentIndex + 1}`;
        await db.policyAcknowledgement.upsert({
          where: { id: acknowledgementId },
          update: { tenantId: TENANT_ID, policyId, employmentId: employments[employmentIndex], policyVersion: policies[policyIndex][3], acknowledgedBy: employments[employmentIndex], acknowledgedAt: addDays(now, -20 + employmentIndex) },
          create: { id: acknowledgementId, tenantId: TENANT_ID, policyId, employmentId: employments[employmentIndex], policyVersion: policies[policyIndex][3], acknowledgedBy: employments[employmentIndex], acknowledgedAt: addDays(now, -20 + employmentIndex) }
        });
      }
    }
  }

  await db.policyException.upsert({
    where: { id: "policy-exception-001" },
    update: { tenantId: TENANT_ID, policyId: "policy-remote", employmentId: "employment-david", reason: "Temporary cross-border work arrangement", compensatingControl: "Manager approval and restricted duration", requestedById: ADMIN_USER_ID, approvedById: ADMIN_USER_ID, expiresAt: addDays(now, 30), active: true },
    create: { id: "policy-exception-001", tenantId: TENANT_ID, policyId: "policy-remote", employmentId: "employment-david", reason: "Temporary cross-border work arrangement", compensatingControl: "Manager approval and restricted duration", requestedById: ADMIN_USER_ID, approvedById: ADMIN_USER_ID, expiresAt: addDays(now, 30), active: true }
  });
}

async function seedWorkflows() {
  const definitions = [
    ["wf-new-hire", "new-hire", "New hire orchestration", 3, "offer.accepted", "ACTIVE"],
    ["wf-job-change", "job-change", "Job change", 2, "employment.change-approved", "ACTIVE"],
    ["wf-leave", "leave-approval", "Leave approval", 4, "leave.requested", "ACTIVE"],
    ["wf-policy", "policy-attestation", "Policy attestation", 2, "policy.published", "ACTIVE"]
  ];

  for (const [id, key, name, version, triggerType, status] of definitions) {
    await db.workflowDefinition.upsert({ where: { id }, update: { tenantId: TENANT_ID, key, name, version, description: `${name} staging definition`, triggerType, status, createdById: ADMIN_USER_ID }, create: { id, tenantId: TENANT_ID, key, name, version, description: `${name} staging definition`, triggerType, status, createdById: ADMIN_USER_ID } });
    const steps = [
      ["validate", "Validate context", 1, "VALIDATE", "HR_OPERATIONS", null, 60],
      ["approve", "Human approval", 2, "APPROVAL", "HRBP", "SINGLE", 480],
      ["execute", "Execute governed action", 3, "ACTION", "HR_OPERATIONS", null, 1_440]
    ];
    for (const [stepKey, stepName, orderIndex, actionType, assigneeRole, approvalMode, slaMinutes] of steps) {
      const stepId = `${id}-${stepKey}`;
      await db.workflowStepDefinition.upsert({ where: { id: stepId }, update: { tenantId: TENANT_ID, definitionId: id, stepKey, name: stepName, orderIndex, actionType, assigneeRole, approvalMode, slaMinutes }, create: { id: stepId, tenantId: TENANT_ID, definitionId: id, stepKey, name: stepName, orderIndex, actionType, assigneeRole, approvalMode, slaMinutes } });
    }
  }

  const instances = [
    ["wf-instance-001", "wf-new-hire", "Person", "person-elena", "RUNNING", addDays(now, -2)],
    ["wf-instance-002", "wf-new-hire", "Person", "person-clara", "WAITING", addDays(now, -1)],
    ["wf-instance-003", "wf-job-change", "Employment", "employment-maya", "COMPLETED", addDays(now, -7)],
    ["wf-instance-004", "wf-job-change", "Employment", "employment-david", "FAILED", addDays(now, -3)],
    ["wf-instance-005", "wf-leave", "Employment", "employment-emma", "RUNNING", addHours(now, -8)],
    ["wf-instance-006", "wf-leave", "Employment", "employment-lucas", "WAITING", addHours(now, -5)],
    ["wf-instance-007", "wf-policy", "PolicyRecord", "policy-conduct", "RUNNING", addDays(now, -1)],
    ["wf-instance-008", "wf-policy", "PolicyRecord", "policy-aup", "COMPLETED", addDays(now, -6)]
  ];

  for (const [id, definitionId, subjectType, subjectId, status, startedAt] of instances) {
    await db.workflowInstance.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, definitionId, subjectType, subjectId, status, startedById: ADMIN_USER_ID, context: { source: "staging-seed" }, startedAt, completedAt: status === "COMPLETED" ? addHours(startedAt, 10) : null, failedAt: status === "FAILED" ? addHours(startedAt, 4) : null, failureReason: status === "FAILED" ? "Simulated connector handoff failure" : null },
      create: { id, tenantId: TENANT_ID, definitionId, subjectType, subjectId, status, startedById: ADMIN_USER_ID, context: { source: "staging-seed" }, startedAt, completedAt: status === "COMPLETED" ? addHours(startedAt, 10) : null, failedAt: status === "FAILED" ? addHours(startedAt, 4) : null, failureReason: status === "FAILED" ? "Simulated connector handoff failure" : null }
    });

    const taskStatus = status === "COMPLETED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : status === "WAITING" ? "READY" : "IN_PROGRESS";
    await db.workflowTask.upsert({
      where: { id: `${id}-task` },
      update: { tenantId: TENANT_ID, instanceId: id, stepKey: status === "WAITING" ? "approve" : "execute", name: status === "WAITING" ? "Human approval" : "Execute governed action", assigneeId: ADMIN_USER_ID, assigneeRole: status === "WAITING" ? "HRBP" : "HR_OPERATIONS", status: taskStatus, dueAt: status === "FAILED" ? addHours(now, -2) : addHours(now, status === "WAITING" ? 4 : 12), startedAt },
      create: { id: `${id}-task`, tenantId: TENANT_ID, instanceId: id, stepKey: status === "WAITING" ? "approve" : "execute", name: status === "WAITING" ? "Human approval" : "Execute governed action", assigneeId: ADMIN_USER_ID, assigneeRole: status === "WAITING" ? "HRBP" : "HR_OPERATIONS", status: taskStatus, dueAt: status === "FAILED" ? addHours(now, -2) : addHours(now, status === "WAITING" ? 4 : 12), startedAt }
    });
  }
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) throw new Error("Run scripts/seed-staging.mjs before the employee-services seed.");
  await seedInvestigatorAndCases();
  await seedHRService();
  await seedPolicies();
  await seedWorkflows();

  const [cases, serviceRequests, policies, workflows] = await Promise.all([
    db.employeeCase.count({ where: { tenantId: TENANT_ID } }),
    db.hRServiceRequest.count({ where: { tenantId: TENANT_ID } }),
    db.policyRecord.count({ where: { tenantId: TENANT_ID } }),
    db.workflowDefinition.count({ where: { tenantId: TENANT_ID } })
  ]);
  console.log(`Employee-services staging seed ready: cases=${cases}, serviceRequests=${serviceRequests}, policies=${policies}, workflows=${workflows}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
