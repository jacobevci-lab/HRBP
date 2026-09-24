import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";

const links = [
  {
    assignmentId: "learning-7-3",
    candidateId: "succ-cand-1",
    skillId: "skill-leadership",
    targetProficiency: "ADVANCED",
    developmentPlanId: "dev-plan-succ-1"
  },
  {
    assignmentId: "learning-9-1",
    candidateId: "succ-cand-3",
    skillId: "skill-risk",
    targetProficiency: "EXPERT",
    developmentPlanId: "dev-plan-succ-3"
  },
  {
    assignmentId: "learning-10-4",
    candidateId: "succ-cand-4",
    skillId: "skill-automation",
    targetProficiency: "ADVANCED",
    developmentPlanId: "dev-plan-succ-4"
  }
];

async function main() {
  const fallbackOwner = await db.userAccount.findFirst({
    where: { tenantId: TENANT_ID, active: true },
    orderBy: { id: "asc" },
    select: { id: true }
  });
  if (!fallbackOwner) throw new Error("Connected growth seed requires at least one active user account.");

  for (const link of links) {
    const [assignment, candidate, skill, sourceAssessment] = await Promise.all([
      db.learningAssignment.findFirst({
        where: { id: link.assignmentId, tenantId: TENANT_ID },
        select: { id: true, employmentId: true, assignedAt: true, dueAt: true }
      }),
      db.successionCandidate.findFirst({
        where: { id: link.candidateId, tenantId: TENANT_ID },
        select: {
          id: true,
          employmentId: true,
          developmentGap: true,
          plan: { select: { ownerId: true, positionId: true } }
        }
      }),
      db.skill.findFirst({
        where: { id: link.skillId, tenantId: TENANT_ID, active: true },
        select: { id: true, name: true }
      }),
      db.talentAssessment.findFirst({
        where: { tenantId: TENANT_ID },
        orderBy: { assessedAt: "desc" },
        select: { id: true, employmentId: true }
      })
    ]);
    if (!assignment || !candidate || !skill) throw new Error(`Connected growth seed prerequisite missing for ${link.assignmentId}.`);
    if (assignment.employmentId !== candidate.employmentId) throw new Error(`Assignment ${link.assignmentId} is not owned by candidate ${link.candidateId}.`);

    const position = await db.position.findFirst({
      where: { id: candidate.plan.positionId, tenantId: TENANT_ID },
      select: { title: true }
    });
    if (!position) throw new Error(`Succession position missing for candidate ${candidate.id}.`);

    const targetAt = assignment.dueAt ?? new Date(assignment.assignedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    const developmentPlan = await db.developmentPlan.upsert({
      where: { id: link.developmentPlanId },
      update: {
        employmentId: candidate.employmentId,
        ownerId: candidate.plan.ownerId ?? fallbackOwner.id,
        sourceAssessmentId: sourceAssessment?.employmentId === candidate.employmentId ? sourceAssessment.id : null,
        successionCandidateId: candidate.id,
        focusSkillId: skill.id,
        targetProficiency: link.targetProficiency,
        status: "ACTIVE",
        targetAt
      },
      create: {
        id: link.developmentPlanId,
        tenantId: TENANT_ID,
        employmentId: candidate.employmentId,
        title: `Succession development · ${position.title}`,
        objective: candidate.developmentGap || `Build ${skill.name} capability for ${position.title}.`,
        status: "ACTIVE",
        ownerId: candidate.plan.ownerId ?? fallbackOwner.id,
        sourceAssessmentId: sourceAssessment?.employmentId === candidate.employmentId ? sourceAssessment.id : null,
        successionCandidateId: candidate.id,
        focusSkillId: skill.id,
        targetProficiency: link.targetProficiency,
        startsAt: assignment.assignedAt,
        targetAt
      }
    });

    await db.learningAssignment.update({
      where: { id: assignment.id },
      data: {
        successionCandidateId: candidate.id,
        developmentPlanId: developmentPlan.id,
        developmentSkillId: skill.id,
        targetProficiency: link.targetProficiency
      }
    });
  }

  const [connected, plans] = await Promise.all([
    db.learningAssignment.count({
      where: {
        tenantId: TENANT_ID,
        successionCandidateId: { not: null },
        developmentPlanId: { not: null },
        developmentSkillId: { not: null },
        targetProficiency: { not: null }
      }
    }),
    db.developmentPlan.count({
      where: {
        tenantId: TENANT_ID,
        successionCandidateId: { not: null },
        focusSkillId: { not: null },
        targetProficiency: { not: null }
      }
    })
  ]);
  if (connected < links.length) throw new Error(`Expected at least ${links.length} connected succession development assignments, found ${connected}.`);
  if (plans < links.length) throw new Error(`Expected at least ${links.length} connected development plans, found ${plans}.`);
  console.log({ connectedSuccessionDevelopmentAssignments: connected, connectedDevelopmentPlans: plans });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
