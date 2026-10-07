import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BASELINE_MIGRATION } from "./prisma-migration-contract.mjs";

const migrationsRoot = path.resolve("prisma/migrations");
const entries = (await readdir(migrationsRoot)).sort();
const directories = [];

for (const entry of entries) {
  if (entry === "migration_lock.toml") continue;
  const full = path.join(migrationsRoot, entry);
  if ((await stat(full)).isDirectory()) directories.push(entry);
  else throw new Error(`Unexpected file in Prisma migrations directory: ${entry}`);
}

assert.ok(directories.length >= 1, "At least one committed Prisma migration is required.");
assert.equal(directories[0], BASELINE_MIGRATION, "Baseline migration must remain first lexicographically.");

const migrationName = /^\d{14}_[a-z0-9][a-z0-9_]*$/;
for (const dir of directories) {
  assert.match(dir, migrationName, `Invalid migration directory name: ${dir}`);
  const contents = await readdir(path.join(migrationsRoot, dir));
  assert.deepEqual(contents.sort(), ["migration.sql"], `Migration ${dir} must contain only migration.sql`);

  const sql = await readFile(path.join(migrationsRoot, dir, "migration.sql"), "utf8");
  assert.ok(sql.trim().length > 0, `Migration ${dir} is empty.`);
  assert.ok(!/--accept-data-loss/i.test(sql), `Migration ${dir} contains a forbidden destructive-force flag.`);
  assert.ok(!/\b(?:CREATE|DROP)\s+DATABASE\b/i.test(sql), `Migration ${dir} must not create or drop databases.`);
  assert.ok(!/\bDROP\s+SCHEMA\b/i.test(sql), `Migration ${dir} must not drop schemas.`);
  assert.ok(!/\bTRUNCATE\b/i.test(sql), `Migration ${dir} must not truncate customer data.`);

  if (dir !== BASELINE_MIGRATION) {
    const destructive = [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bDROP\s+TYPE\b/i,
      /\bALTER\s+TABLE\b[\s\S]{0,300}\bALTER\s+COLUMN\b[\s\S]{0,200}\bTYPE\b/i
    ].some((pattern) => pattern.test(sql));

    if (destructive) {
      assert.match(
        sql,
        /^-- HRBP_DESTRUCTIVE_CHANGE_REVIEWED: .+/m,
        `Migration ${dir} contains destructive DDL without an explicit HRBP_DESTRUCTIVE_CHANGE_REVIEWED annotation.`
      );
    }
  }
}

const baselineSql = await readFile(path.join(migrationsRoot, BASELINE_MIGRATION, "migration.sql"));
const gitBlobSha = createHash("sha1")
  .update(`blob ${baselineSql.length}\0`)
  .update(baselineSql)
  .digest("hex");

assert.equal(
  gitBlobSha,
  "eb7b0eeb924d0dfbfdc9afb687e42a5eaf66ed58",
  "Baseline migration is immutable after adoption. Add a new migration instead of editing the baseline."
);

const lock = await readFile(path.join(migrationsRoot, "migration_lock.toml"), "utf8");
assert.match(lock, /^provider\s*=\s*"postgresql"\s*$/m, "Migration lock must pin PostgreSQL.");

console.log(`Validated ${directories.length} Prisma migration(s); baseline is immutable and destructive DDL requires explicit review metadata.`);
