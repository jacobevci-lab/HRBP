import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const failures = [];
function expect(path, pattern, label) {
  if (!pattern.test(readFileSync(path, "utf8"))) failures.push(path + ": " + label);
}
function reject(path, pattern, label) {
  if (pattern.test(readFileSync(path, "utf8"))) failures.push(path + ": " + label);
}
const monitor = "lib/audit-monitoring.ts";
const budget = "lib/audit-integrity-batching.mjs";
const scheduler = "lib/audit-verification-schedule.ts";
expect(monitor, /db\.tenant\.count\(\)/, "the complete tenant universe must be counted");
expect(monitor, /selectAuditIntegrityBatch\(/, "retain the reviewed hash budget");
expect(monitor, /scheduler\.start\(budget\.tenantBatchSize\)/, "durable selection must use the bounded tenant budget");
expect(monitor, /if \(result\.valid && result\.scope === "EMPTY"\)/, "only valid EMPTY is healthy");
expect(monitor, /failed \+= 1[\s\S]*AUDIT_INTEGRITY_FAILURE/, "invalid ledgers retain the alert/error path");
expect(monitor, /recipientRole: PlatformRole\.TENANT_ADMIN/, "only governed tenant administrators receive integrity alerts");
expect(monitor, /classification: DataClassification\.RESTRICTED/, "keep restricted alert classification");
expect(monitor, /scheduler\.checkpoint\(lease, tenant, async tx =>/, "failure receipt and alert share the cursor transaction");
expect(monitor, /recordSuccessfulAuditVerification\(tx, tenant\.id, now, result\)/, "success receipt shares the cursor transaction");
expect(monitor, /assertAuditIntegrityRun\(/, "invalid outcomes cannot turn maintenance green");
expect(monitor, /scheduler\.release\(lease\)/, "cleanup preserves unfinished cursor progress");
expect(monitor, /\$\{confirmedSequence\}/, "bind the exact MVCC-confirmed sequence");
expect(monitor, /progress\."lastVerifiedSequence" <= EXCLUDED\."lastVerifiedSequence"/, "never regress a known-good receipt");
expect(monitor, /progress\."lastAttemptAt" < EXCLUDED\."lastAttemptAt"/, "reject stale successes atomically");
expect(monitor, /LEAST\(progress\."consecutiveFailures"::bigint \+ 1, 2147483647\)::integer/, "saturate failure counters");
expect(monitor, /AUDIT_VERIFICATION_PROGRESS_CONFLICT/, "receipt conflicts must fail closed");
expect(monitor, /staleOrUnverified24h/, "preserve aggregate freshness gaps");
reject(monitor, /skip:|batchIndex:|quarterHourSlot:/, "wall-clock rotation must not select tenants or masquerade as durable coverage");
reject(monitor, /db\.\$executeRaw`/, "receipts must not escape cursor transactions");
reject(monitor, /if \(result\.scope === "EMPTY"\)/, "invalid EMPTY must not be bypassed");
expect(scheduler, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/, "stable keyset order is required");
expect(scheduler, /take: take \+ 1/, "allow only one metadata lookahead");
expect(scheduler, /FOR UPDATE/, "fence ownership within a short row-locked transaction");
expect(scheduler, /clock_timestamp\(\)/, "lease validity must use the database clock");
expect(scheduler, /const LEASE_MS = 120_000/, "keep lease duration bounded");
expect(scheduler, /const TRANSACTION = \{ maxWait: 2_000, timeout: 5_000 \}/, "short transaction budgets are required");
expect(scheduler, /const value = await persist\(tx\);\s*await fence\(tx, checkpointLease\)/, "expiry after callback work must roll back receipts too");
expect(scheduler, /AUDIT_SCHEDULE_VERSION_UNSUPPORTED/, "unknown schedule versions must never silently reset");
for (const path of [monitor, scheduler]) reject(path, /\$executeRawUnsafe|\$queryRawUnsafe|Prisma\.raw\(/, "use parameter-bound queries only");
expect("prisma/schema.prisma", /model AuditVerificationProgress/, "retain the tenant-owned receipt model");
expect("prisma/audit-verification-schedule.prisma", /model AuditVerificationSchedule/, "reviewed scheduler model is required");
expect("prisma/migrations/20261014190000_audit_verification_schedule/migration.sql", /CREATE TABLE "AuditVerificationSchedule"/, "scheduler state must use committed migrations");
expect(".github/workflows/ci.yml", /scripts\/audit-verification-progress\.postgres\.test\.mjs/, "real scheduler/receipt integration stays in CI");
expect(budget, /10_000 \/ verificationLimit/, "the global hash budget must remain unchanged");
for (const path of [".env.example", ".env.onprem.example"]) expect(path, /^HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE=4$/m, "retain bounded defaults");
expect("package.json", /"audit-integrity:validate":[^\n]*scripts\/audit-integrity-monitoring\.test\.mjs/, "monitor behavior tests remain in the build gate");
expect("package.json", /"audit-integrity:validate":[^\n]*scripts\/audit-full-history-verification\.test\.mjs/, "operator full-history tests remain in the build gate");
expect("package.json", /npm run maintenance:validate && npm run audit-integrity:validate && npm run hire:validate/, "audit validation must gate builds");
if (failures.length) {
  console.error("Audit integrity monitoring validation failed:\n" + failures.map(x => "- " + x).join("\n"));
  process.exit(1);
}
// Keep the new executable scheduler regressions in the existing prebuild gate
// without changing the workflow permissions or weakening any existing checks.
const tests = spawnSync(process.execPath, ["--test", "scripts/audit-verification-schedule.test.mjs"], { stdio: "inherit" });
if (tests.error || tests.status !== 0) process.exit(1);
console.log("Audit integrity monitoring uses bounded, fenced, durable tenant coverage.");
