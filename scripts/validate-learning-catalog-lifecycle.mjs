import { readFile } from "node:fs/promises";

const files = Object.fromEntries(await Promise.all([
  "prisma/growth.prisma",
  "prisma/migrations/20261013103000_learning_catalog_optimistic_concurrency/migration.sql",
  "app/api/learning/courses/route.ts",
  "app/api/learning/courses/[id]/route.ts",
  "app/api/learning/skills/[id]/route.ts",
  "lib/learning-governance-data.ts",
  "components/learning-governance-console.tsx",
  "components/growth-operations-console.tsx",
  "package.json"
].map(async path => [path, await readFile(path, "utf8")])));

const failures = [];
function expect(path, pattern, message) {
  if (!pattern.test(files[path])) failures.push(`${path}: ${message}`);
}
function reject(path, pattern, message) {
  if (pattern.test(files[path])) failures.push(`${path}: ${message}`);
}

const schema = "prisma/growth.prisma";
expect(schema, /model Skill \{[\s\S]*?updatedAt\s+DateTime\s+@updatedAt[\s\S]*?model EmploymentSkill/, "skills must have Prisma-managed concurrency timestamps");
expect(schema, /model LearningCourse \{[\s\S]*?updatedAt\s+DateTime\s+@updatedAt[\s\S]*?model DevelopmentPlan/, "courses must have Prisma-managed concurrency timestamps");

const migration = "prisma/migrations/20261013103000_learning_catalog_optimistic_concurrency/migration.sql";
expect(migration, /ALTER TABLE "Skill" ADD COLUMN "updatedAt"[\s\S]*UPDATE "Skill"[\s\S]*ALTER COLUMN "updatedAt" SET NOT NULL/, "existing skills must be backfilled before enforcing the timestamp");
expect(migration, /ALTER TABLE "LearningCourse" ADD COLUMN "updatedAt"[\s\S]*UPDATE "LearningCourse"[\s\S]*ALTER COLUMN "updatedAt" SET NOT NULL/, "existing courses must be backfilled before enforcing the timestamp");

const skills = "app/api/learning/skills/[id]/route.ts";
const courseUpdate = "app/api/learning/courses/[id]/route.ts";
for (const path of [skills, courseUpdate]) {
  expect(path, /asIdentifier\(\(await params\)\.id\)/, "mutation path IDs must be validated");
  expect(path, /expectedUpdatedAt/, "all updates must require explicit concurrency evidence");
  expect(path, /updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/, "preconditions must reject stale client state");
  expect(path, /updateMany\(\{[\s\S]*?where:\s*\{\s*id,\s*tenantId:\s*ctx\.tenantId,\s*updatedAt:/, "state-aware mutations must be tenant scoped and compare row version");
  expect(path, /changed\.count !== 1[\s\S]*STALE_STATE/, "racing writes must fail closed");
  expect(path, /if \(code === "STALE_STATE"\)[\s\S]*status:\s*409/, "stale updates must provide a bounded conflict");
  expect(path, /typeof body\.active !== "boolean"/, "lifecycle state must never use string/number coercion");
  reject(path, /Boolean\(body\.(?:active|mandatory|critical)\)/, "catalog state must never silently coerce booleans");
  reject(path, /\.trim\(\)\.slice\(0,\s*250\)/, "catalog updates must not silently truncate text");
}
expect(skills, /asText\(body\.name, 180\)/, "skill names must match bounded catalog creation");
expect(skills, /asOptionalText\(body\.category, 120\)/, "skill categories must match bounded catalog creation");
expect(skills, /typeof body\.critical !== "boolean"/, "skill critical input must be a boolean");

expect(courseUpdate, /asText\(body\.title, 250\)/, "course title must remain bounded");
expect(courseUpdate, /asOptionalText\(body\.provider, 250\)/, "course provider must remain bounded");
expect(courseUpdate, /typeof body\.mandatory !== "boolean"/, "course mandatory input must be a boolean");
expect(courseUpdate, /validityMonths must be between 1 and 120 or blank/, "course validity must remain bounded");

const courseCreate = "app/api/learning/courses/route.ts";
expect(courseCreate, /asText\(body\.code, 64\)/, "course codes must be bounded");
expect(courseCreate, /asText\(body\.title, 250\)/, "course titles must be bounded");
expect(courseCreate, /asOptionalText\(body\.provider, 250\)/, "course providers must be bounded");
expect(courseCreate, /typeof mandatory !== "boolean"/, "course mandatory creation must reject coercion");
expect(courseCreate, /prismaCode === "P2002"/, "duplicate course codes must produce a bounded conflict");
expect(courseCreate, /where:\s*\{\s*tenantId:\s*ctx\.tenantId,\s*active:\s*true\s*\}/, "course reads must be tenant scoped and active only");
expect(courseCreate, /take:\s*300/, "course reads must remain bounded");
expect(courseCreate, /"cache-control":\s*"no-store"/, "course reads must not be cached");

const data = "lib/learning-governance-data.ts";
expect(data, /updatedAt:\s*course\.updatedAt\.toISOString\(\)/, "course concurrency tokens must reach the UI");
expect(data, /updatedAt:\s*skill\.updatedAt\.toISOString\(\)/, "skill concurrency tokens must reach the UI");

const ui = "components/learning-governance-console.tsx";
expect(ui, /expectedUpdatedAt:\s*course\.updatedAt/, "course edits must submit server state version");
expect(ui, /expectedUpdatedAt:\s*skill\.updatedAt/, "skill edits must submit server state version");
expect(ui, /name="name"[^>]*maxLength=\{180\}/, "skill name bounds must match API");
expect(ui, /name="category"[^>]*maxLength=\{120\}/, "skill category bounds must match API");

const createUi = "components/growth-operations-console.tsx";
expect(createUi, /name="validityMonths"[^>]*max="120"/, "course validity creation must match API limits");
expect(createUi, /name="title"[^>]*maxLength=\{250\}/, "course title creation must match API limits");

const pkg = "package.json";
expect(pkg, /learning-catalog:validate/, "catalog gate must be registered in scripts and prebuild");
expect(pkg, /scripts\/learning-catalog-lifecycle\.test\.mjs/, "catalog behavior tests must run in the production prebuild");

if (failures.length) {
  console.error("Learning catalog lifecycle governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Learning catalog lifecycle governance passed.");
