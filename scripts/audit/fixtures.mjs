import { PrismaClient, PlatformRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadTs, requireDisposableDatabase } from './load-ts.mjs';
requireDisposableDatabase();
const password = process.env.HRBP_TEST_ADMIN_PASSWORD;
if (!password || password.length < 24) throw new Error('An ephemeral audit password is required.');
const staging = await readFile('.github/workflows/staging-db-sync.yml', 'utf8');
const seeds = [...staging.matchAll(/run: node (scripts\/seed-[\w-]+\.mjs)/g)].map(m => m[1]);
for (const script of seeds) {
  const run = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`Synthetic seed failed: ${script}`);
}
const db = new PrismaClient();
const tenantId = 'tenant-acme-global', prefix = `qa-${randomUUID().slice(0, 8)}`;
const { hashLocalPassword, verifyLocalPassword } = loadTs('lib/local-auth.ts');
const { can } = loadTs('lib/authorization.ts');
const { navigation } = loadTs('lib/navigation.ts');
const accounts = [];
try {
  for (const role of Object.values(PlatformRole)) {
    const subject = `${prefix}-${role.toLowerCase()}`, id = `${subject}-user`, personId = `${subject}-person`, employmentId = `${subject}-employment`;
    const email = `${subject}@audit.invalid`;
    await db.userAccount.create({ data: { id, tenantId, subject, displayName: `Synthetic ${role}`, email, role, active: true, localAuthEnabled: true, localPasswordHash: hashLocalPassword(password) } });
    await db.person.create({ data: { id: personId, tenantId, givenName: 'Synthetic', familyName: role, employeeNumber: subject, workEmail: email } });
    await db.employment.create({ data: { id: employmentId, tenantId, personId, startDate: new Date('2026-01-01T00:00:00Z'), status: 'ACTIVE' } });
    const context = { tenantId, actorId: id, role, employmentId };
    const expectedModules = navigation.flatMap(g => g.items).filter(n => !n.requiredCapability || can(context, n.requiredCapability)).map(n => n.slug);
    accounts.push({ role, subject, id, employmentId, expectedModules });
  }
  const localAdmin = await db.userAccount.findFirst({ where: { tenantId, subject: 'local.admin' } });
  const seedPasswordVerified = verifyLocalPassword(password, localAdmin?.localPasswordHash);
  const planPerson = `${prefix}-preboarding-person`, planEmployment = `${prefix}-preboarding-employment`, planId = `${prefix}-plan`, taskId = `${prefix}-task`;
  await db.person.create({ data: { id: planPerson, tenantId, givenName: 'Synthetic', familyName: 'Planning', employeeNumber: `${prefix}-preboard` } });
  await db.employment.create({ data: { id: planEmployment, tenantId, personId: planPerson, status: 'PREBOARDING', startDate: new Date(Date.now() + 3 * 86400000) } });
  await db.onboardingPlan.create({ data: { id: planId, tenantId, personId: planPerson, employmentId: planEmployment, status: 'NOT_STARTED', targetStartDate: new Date(Date.now() + 3 * 86400000), ownerId: accounts.find(a => a.role === 'TENANT_ADMIN').id } });
  await db.onboardingTask.create({ data: { id: taskId, tenantId, planId, title: 'Synthetic missing deadline', ownerType: 'IT', status: 'NOT_STARTED' } });
  const report = { prefix, tenantId, seeds, seedPasswordVerified, accounts, planId, taskId };
  await mkdir('audit-results', { recursive: true });
  await writeFile('audit-results/fixtures.json', JSON.stringify(report, null, 2));
  console.log('AUDIT_FIXTURES ' + JSON.stringify({ roles: accounts.length, seeds: seeds.length, seedPasswordVerified }));
} finally { await db.$disconnect(); }
