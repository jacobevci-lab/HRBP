import {
  EmploymentAccessEffect,
  EmploymentAccessGrantKind,
  EmploymentAccessScopeType,
  PlatformRole,
  PrismaClient
} from "@prisma/client";

const db = new PrismaClient();
const TENANT_ID = "tenant-acme-global";
const HRBP_USER_ID = "user-hrbp-emea";
const ADMIN_USER_ID = "user-yakup-evci";
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");

async function upsertGrant(scopeType, scopeKey, effect = EmploymentAccessEffect.INCLUDE) {
  await db.employmentAccessGrant.upsert({
    where: {
      tenantId_userId_scopeType_scopeKey_effect: {
        tenantId: TENANT_ID,
        userId: HRBP_USER_ID,
        scopeType,
        scopeKey,
        effect
      }
    },
    update: { validTo: null, employmentId: scopeType === EmploymentAccessScopeType.EMPLOYMENT ? scopeKey : null },
    create: {
      tenantId: TENANT_ID,
      userId: HRBP_USER_ID,
      employmentId: scopeType === EmploymentAccessScopeType.EMPLOYMENT ? scopeKey : null,
      kind: EmploymentAccessGrantKind.HRBP_POPULATION,
      scopeType,
      scopeKey,
      effect,
      createdById: ADMIN_USER_ID
    }
  });
}

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

  const jurisdictionSeeds = [
    ["employment-david", "TR"],
    ["employment-sofia", "DE"],
    ["employment-liam", "DE"],
    ["employment-jonas", "GB"],
    ["employment-lucas", "SG"],
    ["employment-ayse", "TR"],
    ["employment-emma", "GB"],
    ["employment-maya", "US"]
  ];
  const existing = await db.employment.findMany({
    where: { tenantId: TENANT_ID, id: { in: jurisdictionSeeds.map(([employmentId]) => employmentId) } },
    select: { id: true, positionId: true, position: { select: { orgUnitId: true } } }
  });
  const employmentById = new Map(existing.map((employment) => [employment.id, employment]));

  for (const [employmentId, countryCode] of jurisdictionSeeds) {
    if (!employmentById.has(employmentId)) continue;
    await db.employmentJurisdiction.upsert({
      where: { employmentId_effectiveFrom: { employmentId, effectiveFrom: EFFECTIVE_FROM } },
      update: { tenantId: TENANT_ID, countryCode, effectiveTo: null, source: "staging-seed" },
      create: { tenantId: TENANT_ID, employmentId, countryCode, effectiveFrom: EFFECTIVE_FROM, source: "staging-seed" }
    });
  }

  await db.employmentAccessGrant.deleteMany({
    where: { tenantId: TENANT_ID, userId: HRBP_USER_ID, kind: EmploymentAccessGrantKind.HRBP_POPULATION }
  });

  const david = employmentById.get("employment-david");
  if (david?.position?.orgUnitId) await upsertGrant(EmploymentAccessScopeType.ORG_UNIT, david.position.orgUnitId);
  await upsertGrant(EmploymentAccessScopeType.COUNTRY, "DE");

  const sofia = employmentById.get("employment-sofia");
  if (sofia?.positionId) await upsertGrant(EmploymentAccessScopeType.POSITION_TREE, sofia.positionId);

  if (employmentById.has("employment-jonas")) await upsertGrant(EmploymentAccessScopeType.EMPLOYMENT, "employment-jonas");
  if (employmentById.has("employment-liam")) await upsertGrant(EmploymentAccessScopeType.EMPLOYMENT, "employment-liam", EmploymentAccessEffect.EXCLUDE);

  const [grantCount, jurisdictionCount] = await Promise.all([
    db.employmentAccessGrant.count({ where: { tenantId: TENANT_ID, userId: HRBP_USER_ID } }),
    db.employmentJurisdiction.count({ where: { tenantId: TENANT_ID } })
  ]);
  console.log(`Seeded ${grantCount} HRBP scope rules and ${jurisdictionCount} employment jurisdictions.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
