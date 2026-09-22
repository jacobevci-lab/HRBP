import { EmploymentAccessGrantKind, PlatformRole, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const HRBP_USER_ID = "user-hrbp-emea";
const ADMIN_USER_ID = "user-yakup-evci";

async function main() {
  await db.userAccount.upsert({
    where: { id: HRBP_USER_ID },
    update: {
      tenantId: TENANT_ID,
      subject: "hrbp.emea",
      displayName: "EMEA HR Business Partner",
      email: "hrbp.emea@acme.example",
      role: PlatformRole.HRBP,
      active: true
    },
    create: {
      id: HRBP_USER_ID,
      tenantId: TENANT_ID,
      subject: "hrbp.emea",
      displayName: "EMEA HR Business Partner",
      email: "hrbp.emea@acme.example",
      role: PlatformRole.HRBP,
      active: true
    }
  });

  const employmentIds = ["employment-david", "employment-sofia", "employment-liam", "employment-jonas"];
  const existing = await db.employment.findMany({
    where: { tenantId: TENANT_ID, id: { in: employmentIds } },
    select: { id: true }
  });

  for (const employment of existing) {
    await db.employmentAccessGrant.upsert({
      where: {
        tenantId_userId_employmentId_kind: {
          tenantId: TENANT_ID,
          userId: HRBP_USER_ID,
          employmentId: employment.id,
          kind: EmploymentAccessGrantKind.HRBP_POPULATION
        }
      },
      update: { validTo: null },
      create: {
        tenantId: TENANT_ID,
        userId: HRBP_USER_ID,
        employmentId: employment.id,
        kind: EmploymentAccessGrantKind.HRBP_POPULATION,
        createdById: ADMIN_USER_ID
      }
    });
  }

  console.log(`Seeded ${existing.length} relationship-aware HRBP population grants.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
