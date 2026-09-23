import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const AUTHOR_ID = "user-policy-author";
const APPROVER_ID = "user-policy-approver";
const HRBP_ID = "user-hrbp-emea";
const now = new Date();

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

async function ensureGovernanceUsers() {
  await db.userAccount.upsert({
    where: { id: AUTHOR_ID },
    update: { tenantId: TENANT_ID, subject: "policy.author", displayName: "Policy Author", email: "policy.author@acme.example", role: "HR_OPERATIONS", active: true },
    create: { id: AUTHOR_ID, tenantId: TENANT_ID, subject: "policy.author", displayName: "Policy Author", email: "policy.author@acme.example", role: "HR_OPERATIONS", active: true }
  });
  await db.userAccount.upsert({
    where: { id: APPROVER_ID },
    update: { tenantId: TENANT_ID, subject: "policy.approver", displayName: "Policy Approver", email: "policy.approver@acme.example", role: "LEGAL", active: true },
    create: { id: APPROVER_ID, tenantId: TENANT_ID, subject: "policy.approver", displayName: "Policy Approver", email: "policy.approver@acme.example", role: "LEGAL", active: true }
  });
}

async function seedQueues() {
  const queues = [
    ["queue-hr-operations", "HR_OPERATIONS", "HR Operations", 1440],
    ["queue-payroll", "PAYROLL", "Payroll", 480],
    ["queue-total-rewards", "TOTAL_REWARDS", "Total Rewards", 1440],
    ["queue-hrbp", "HRBP", "HR Business Partner", 1440]
  ];
  for (const [id, key, name, defaultSlaMinutes] of queues) {
    await db.hRServiceQueue.upsert({
      where: { id },
      update: { tenantId: TENANT_ID, key, name, defaultSlaMinutes, active: true, createdById: AUTHOR_ID },
      create: { id, tenantId: TENANT_ID, key, name, defaultSlaMinutes, active: true, createdById: AUTHOR_ID }
    });
    await db.hRServiceQueueMembership.upsert({
      where: { queueId_userId: { queueId: id, userId: AUTHOR_ID } },
      update: { tenantId: TENANT_ID, role: "OWNER" },
      create: { tenantId: TENANT_ID, queueId: id, userId: AUTHOR_ID, role: "OWNER" }
    });
  }

  const hrbp = await db.userAccount.findFirst({ where: { id: HRBP_ID, tenantId: TENANT_ID, active: true }, select: { id: true } });
  if (hrbp) {
    await db.hRServiceQueueMembership.upsert({
      where: { queueId_userId: { queueId: "queue-hrbp", userId: hrbp.id } },
      update: { tenantId: TENANT_ID, role: "AGENT" },
      create: { tenantId: TENANT_ID, queueId: "queue-hrbp", userId: hrbp.id, role: "AGENT" }
    });
  }

  const mapping = new Map([
    ["HR Operations", "HR_OPERATIONS"], ["HR_OPERATIONS", "HR_OPERATIONS"],
    ["Payroll", "PAYROLL"], ["PAYROLL", "PAYROLL"],
    ["Total Rewards", "TOTAL_REWARDS"], ["TOTAL_REWARDS", "TOTAL_REWARDS"],
    ["HRBP", "HRBP"]
  ]);
  const requests = await db.hRServiceRequest.findMany({ where: { tenantId: TENANT_ID }, select: { id: true, queue: true } });
  for (const request of requests) {
    const key = request.queue ? mapping.get(request.queue) : undefined;
    if (!key) continue;
    await db.hRServiceRequest.update({ where: { id: request.id }, data: { queue: key, assigneeId: AUTHOR_ID } });
  }
}

async function seedPolicySeparation() {
  const policies = await db.policyRecord.findMany({ where: { tenantId: TENANT_ID } });
  for (const policy of policies) {
    await db.policyRecord.update({
      where: { id: policy.id },
      data: {
        ownerId: AUTHOR_ID,
        ...(policy.status === "PUBLISHED" ? { approvedById: APPROVER_ID, approvedAt: policy.approvedAt ?? addDays(now, -30) } : {}),
        ...(policy.status === "REVIEW" ? { approvedById: null, approvedAt: null } : {})
      }
    });
  }

  const existing = await db.policyException.findFirst({ where: { id: "policy-exception-001", tenantId: TENANT_ID } });
  if (existing) {
    await db.policyException.update({ where: { id: existing.id }, data: { status: "APPROVED", active: true, approvedById: APPROVER_ID, decidedAt: existing.decidedAt ?? addDays(now, -2) } });
  }

  const policy = await db.policyRecord.findFirst({ where: { id: "policy-aup", tenantId: TENANT_ID, status: "PUBLISHED" }, select: { id: true } });
  const employment = await db.employment.findFirst({ where: { id: "employment-sofia", tenantId: TENANT_ID }, select: { id: true } });
  if (policy && employment) {
    await db.policyException.upsert({
      where: { id: "policy-exception-002" },
      update: { tenantId: TENANT_ID, policyId: policy.id, employmentId: employment.id, reason: "Temporary development-tool exception", compensatingControl: "Restricted duration, manager review and enhanced logging", requestedById: AUTHOR_ID, approvedById: null, status: "REQUESTED", active: false, decidedAt: null, decisionNote: null, expiresAt: addDays(now, 14) },
      create: { id: "policy-exception-002", tenantId: TENANT_ID, policyId: policy.id, employmentId: employment.id, reason: "Temporary development-tool exception", compensatingControl: "Restricted duration, manager review and enhanced logging", requestedById: AUTHOR_ID, status: "REQUESTED", active: false, expiresAt: addDays(now, 14) }
    });
  }
}

async function seedDocumentGrant() {
  const [document, hrbp] = await Promise.all([
    db.documentRecord.findFirst({ where: { tenantId: TENANT_ID, caseId: null, status: "ACTIVE", classification: { not: "HIGHLY_RESTRICTED" } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    db.userAccount.findFirst({ where: { id: HRBP_ID, tenantId: TENANT_ID, active: true }, select: { id: true } })
  ]);
  if (!document || !hrbp) return;
  const existing = await db.documentAccessGrant.findFirst({ where: { documentId: document.id, principalType: "USER", principalId: hrbp.id, permission: "DOWNLOAD" } });
  if (existing) {
    await db.documentAccessGrant.update({ where: { id: existing.id }, data: { tenantId: TENANT_ID, purpose: "Staging delegated vault access", expiresAt: addDays(now, 30), grantedById: APPROVER_ID } });
  } else {
    await db.documentAccessGrant.create({ data: { tenantId: TENANT_ID, documentId: document.id, principalType: "USER", principalId: hrbp.id, permission: "DOWNLOAD", purpose: "Staging delegated vault access", expiresAt: addDays(now, 30), grantedById: APPROVER_ID } });
  }
}

async function main() {
  await ensureGovernanceUsers();
  await seedQueues();
  await seedPolicySeparation();
  await seedDocumentGrant();
  const [queues, memberships, exceptions, grants] = await Promise.all([
    db.hRServiceQueue.count({ where: { tenantId: TENANT_ID } }),
    db.hRServiceQueueMembership.count({ where: { tenantId: TENANT_ID } }),
    db.policyException.count({ where: { tenantId: TENANT_ID } }),
    db.documentAccessGrant.count({ where: { tenantId: TENANT_ID } })
  ]);
  console.log(`Service governance staging ready: queues=${queues}, memberships=${memberships}, exceptions=${exceptions}, documentGrants=${grants}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
