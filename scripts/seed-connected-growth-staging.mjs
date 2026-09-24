import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";

const links = [
  {
    assignmentId: "learning-7-3",
    candidateId: "succ-cand-1",
    skillId: "skill-leadership",
    targetProficiency: "ADVANCED"
  },
  {
    assignmentId: "learning-9-1",
    candidateId: "succ-cand-3",
    skillId: "skill-risk",
    targetProficiency: "EXPERT"
  },
  {
    assignmentId: "learning-10-4",
    candidateId: "succ-cand-4",
    skillId: "skill-automation",
    targetProficiency: "ADVANCED"
  }
];

async function main() {
  for (const link of links) {
    const [assignment, candidate, skill] = await Promise.all([
      db.learningAssignment.findFirst({ where: { id: link.assignmentId, tenantId: TENANT_ID }, select: { id: true, employmentId: true } }),
      db.successionCandidate.findFirst({ where: { id: link.candidateId, tenantId: TENANT_ID }, select: { id: true, employmentId: true } }),
      db.skill.findFirst({ where: { id: link.skillId, tenantId: TENANT_ID, active: true }, select: { id: true } })
    ]);
    if (!assignment || !candidate || !skill) throw new Error(`Connected growth seed prerequisite missing for ${link.assignmentId}.`);
    if (assignment.employmentId !== candidate.employmentId) throw new Error(`Assignment ${link.assignmentId} is not owned by candidate ${link.candidateId}.`);

    await db.learningAssignment.update({
      where: { id: assignment.id },
      data: {
        successionCandidateId: candidate.id,
        developmentSkillId: skill.id,
        targetProficiency: link.targetProficiency
      }
    });
  }

  const connected = await db.learningAssignment.count({
    where: {
      tenantId: TENANT_ID,
      successionCandidateId: { not: null },
      developmentSkillId: { not: null },
      targetProficiency: { not: null }
    }
  });
  if (connected < links.length) throw new Error(`Expected at least ${links.length} connected succession development assignments, found ${connected}.`);
  console.log({ connectedSuccessionDevelopmentAssignments: connected });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
