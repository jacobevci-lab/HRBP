import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const growth = read("prisma/growth.prisma");
const architecture = read("prisma/job-architecture.prisma");
const migration = read("prisma/migrations/20261102190000_job_architecture_foundation/migration.sql");
const authorization = read("lib/authorization.ts");
const families = read("app/api/job-architecture/families/route.ts");
const levels = read("app/api/job-architecture/levels/route.ts");
const profiles = read("app/api/job-architecture/profiles/route.ts");
const positions = read("app/api/positions/route.ts");
const workspace = read("components/job-architecture-workspace.tsx");
const admin = read("components/job-architecture-admin.tsx");
const jobPage = read("app/module/job-architecture/page.tsx");
const coreWorkspace = read("components/core-hr-live-workspace.tsx");
const newPositionPage = read("app/module/positions/new/page.tsx");
const positionForm = read("components/position-create-form.tsx");
const pkg = JSON.parse(read("package.json"));

for (const model of ["JobFamily", "JobLevel", "JobProfile", "JobProfileSkillRequirement"]) {
  assert.match(architecture, new RegExp("\\bmodel " + model + "\\b"), model + " model must exist");
}
assert.match(architecture, /enum JobProfileStatus[\s\S]*DRAFT[\s\S]*ACTIVE[\s\S]*RETIRED/);
assert.match(architecture, /model JobProfile[\s\S]*effectiveFrom\s+DateTime[\s\S]*effectiveTo\s+DateTime\?/);
assert.match(architecture, /model JobProfileSkillRequirement[\s\S]*targetProficiency\s+SkillProficiency/);
assert.match(architecture, /@@unique\(\[jobProfileId, skillId\]\)/);
assert.match(schema, /model Position[\s\S]*jobFamily\s+String\?[\s\S]*grade\s+String\?[\s\S]*jobProfileId\s+String\?/,
  "legacy text fields must remain while structured profiles are adopted");
assert.match(schema, /jobProfile\s+JobProfile\?\s+@relation/);
assert.match(growth, /model Skill[\s\S]*jobProfileRequirements\s+JobProfileSkillRequirement\[\]/);

for (const capability of ["job-architecture:read", "job-architecture:write"]) {
  assert.match(authorization, new RegExp('\"' + capability + '\"'));
}
for (const source of [families, levels, profiles]) {
  assert.match(source, /can\(ctx, "job-architecture:read"\)/);
  assert.match(source, /can\(ctx, "job-architecture:write"\)/);
  assert.match(source, /mutationOriginAllowed\(request\)/);
  assert.match(source, /tenantId: ctx\.tenantId/);
  assert.match(source, /appendAudit\(/);
  assert.match(source, /cache-control/);
}
assert.match(profiles, /active: true/);
assert.match(profiles, /PROFILE_EFFECTIVE_OVERLAP/);
assert.match(profiles, /skillRequirements/);
assert.match(profiles, /tx\.skill\.findMany/);
assert.match(profiles, /status: status as JobProfileStatus/);

assert.match(positions, /jobProfileRequested/);
assert.match(positions, /status: JobProfileStatus\.ACTIVE/);
assert.match(positions, /effectiveFrom: \{ lte: now \}/);
assert.match(positions, /jobProfileId: jobProfile\?\.id \?\? null/);
assert.match(positions, /jobFamily: jobProfile\?\.family\.name \?\? jobFamily/);
assert.match(positions, /grade: jobProfile\?\.level\.code \?\? grade/);
assert.match(positions, /JOB_PROFILE_NOT_FOUND/);

assert.match(jobPage, /<AppShell><JobArchitectureWorkspace\/><\/AppShell>/);
assert.match(workspace, /getServerRequestContext\(\)/);
assert.match(workspace, /can\(ctx, "job-architecture:read"\)/);
assert.match(workspace, /can\(ctx, "job-architecture:write"\)/);
assert.match(workspace, /tenantId: ctx\.tenantId/);
assert.match(workspace, /JobArchitectureAdmin/);
assert.match(admin, /\/api\/job-architecture\/families/);
assert.match(admin, /\/api\/job-architecture\/levels/);
assert.match(admin, /\/api\/job-architecture\/profiles/);
assert.match(admin, /skillRequirements:/);
assert.match(coreWorkspace, /href="\/module\/job-architecture"/);
assert.match(newPositionPage, /getServerRequestContext\(\)/);
assert.match(newPositionPage, /can\(ctx, "positions:write"\)/);
assert.match(newPositionPage, /tenantId: ctx\.tenantId/);
assert.doesNotMatch(newPositionPage, /workspaceTenantId/);
assert.match(positionForm, /jobProfileId/);
assert.match(positionForm, /selectedProfile/);
assert.match(positionForm, /Legacy job family fallback/);

for (const table of ["JobFamily", "JobLevel", "JobProfile", "JobProfileSkillRequirement"]) {
  assert.match(migration, new RegExp('CREATE TABLE "' + table + '"'));
}
assert.match(migration, /ALTER TABLE "Position" ADD COLUMN "jobProfileId" TEXT/);
assert.match(migration, /FOREIGN KEY \("jobProfileId"\) REFERENCES "JobProfile"\("id"\)/);
assert.match(migration, /JobLevel_rank_check/);
assert.match(migration, /JobProfile_effective_dates_check/);
assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b/i);

assert.equal(pkg.scripts["job-architecture:validate"],
  "node scripts/validate-job-architecture.mjs && node --test scripts/job-architecture-input.test.mjs");
assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run job-architecture:validate"));

console.log("Job architecture validation passed: governed family/level/profile/skill model and Position bridge are mandatory.");
