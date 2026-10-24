import { readFileSync } from "node:fs";

const failures = [];
function source(path) { return readFileSync(path, "utf8"); }
function expect(path, pattern, label) {
  if (!pattern.test(source(path))) failures.push(path + ": " + label);
}
function reject(path, pattern, label) {
  if (pattern.test(source(path))) failures.push(path + ": " + label);
}

const monitor = "lib/audit-history-monitoring.ts";
const chunk = "lib/audit-history-chunk.mjs";
const scheduler = "lib/audit-verification-schedule.ts";
const route = "app/api/internal/audit-history/route.ts";
const maintenance = "lib/maintenance-protocol.mjs";
const metrics = "app/api/internal/metrics/route.ts";
const migration = "prisma/migrations/20261025003000_audit_history_resume_progress/migration.sql";
const pkg = "package.json";
const dockerfile = "Dockerfile.onprem";
const compose = "docker-compose.onprem.yml";
const envOnprem = ".env.onprem.example";

expect(monitor, /SCHEDULE_KEY = "audit-full-history"/,
  "full-history verification must have a schedule key independent from the fast tail monitor");
expect(monitor, /scheduler\.persist\(lease,[\s\S]*recordPartial/,
  "partial chunks must persist under the lease fence without advancing the tenant cursor");
expect(monitor, /scheduler\.checkpoint\(lease, tenant,[\s\S]*recordSuccess/,
  "completed history scans must advance the tenant cursor atomically with their success receipt");
expect(monitor, /scheduler\.checkpoint\(lease, tenant,[\s\S]*recordFailure/,
  "invalid history scans must atomically persist failure evidence before tenant cursor advancement");
expect(monitor, /isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/,
  "target capture and bounded history chunks must use repeatable-read snapshots");
expect(monitor, /HRBP_AUDIT_FULL_HISTORY_PAGE_SIZE/,
  "history chunk size must be independently configurable");
expect(monitor, /HRBP_AUDIT_FULL_HISTORY_INTERVAL_HOURS/,
  "full-history re-verification cadence must be explicit and separate");
reject(monitor, /auditEvent\.(?:create|update|updateMany|delete|deleteMany)\(/,
  "resumable verification must never mutate audit events");
reject(monitor, /\$(?:queryRawUnsafe|executeRawUnsafe)|Prisma\.raw\(/,
  "history operational state must use parameter-bound Prisma/raw templates only");

expect(chunk, /ledgerSequence: \{ gt: verifiedSequence, lte: targetSequence \}/,
  "a chunk must stop at the captured fixed target even when new audit events append");
expect(chunk, /RESUME_ANCHOR_MISMATCH/,
  "resume must revalidate the persisted hash anchor before scanning forward");
expect(chunk, /TARGET_HASH_MISMATCH/,
  "completion must match the originally captured target hash");
expect(chunk, /const MAX_PAGE_SIZE = 1000/,
  "history pages must retain an explicit hard upper bound");
reject(chunk, /\.(?:create|update|updateMany|delete|deleteMany)\(/,
  "the dependency-free chunk verifier must remain read-only");

expect(scheduler, /async persist<T>\(lease: Lease/,
  "scheduler must expose fenced persistence without cursor advancement");
expect(scheduler, /owned\(await lock\(tx\), persistenceLease\)[\s\S]*await fence\(tx, persistenceLease\)/,
  "partial progress writes must be fenced before transaction commit");

expect(route, /HRBP_MAINTENANCE_TOKEN/,
  "full-history endpoint must require internal maintenance authentication");
expect(route, /advanceAuditHistoryVerification/,
  "the endpoint must invoke only the bounded resumable history worker");
reject(maintenance, /audit-full-history|auditHistory/,
  "full-history work must not be silently added to the fast all-jobs maintenance protocol");

expect(metrics, /auditHistoryAggregateMetrics\(now\)/,
  "private metrics must expose aggregate full-history coverage");
expect(metrics, /hrbp_audit_history_untracked_tenants/,
  "private metrics must expose measurable untracked tenant backlog");
expect(metrics, /hrbp_audit_history_backlog_events/,
  "private metrics must expose aggregate event backlog");
reject(metrics, /hrbp_audit_history_[^\n]*tenantId|hrbp_audit_history_[^\n]*tailHash/,
  "Prometheus metric labels/lines must not expose tenant identifiers or hashes");

expect(migration, /CREATE TABLE "AuditHistoryVerificationProgress"/,
  "migration must persist resumable per-tenant operational progress");
expect(migration, /CREATE TABLE "AuditHistoryVerificationStats"/,
  "migration must persist aggregate monotonic throughput counters");
expect(migration, /CHECK \("status" IN \('RUNNING', 'VALID', 'INVALID'\)\)/,
  "database state must constrain resumable scan status");
reject(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+"AuditEvent"|\bDROP\s+(?:TABLE|COLUMN)/i,
  "history-progress migration must never rewrite/delete audit evidence or perform destructive DDL");

expect(pkg, /"audit-integrity:validate":[^\n]*audit-history-chunk\.test\.mjs/,
  "bounded history chunk tests must gate production prebuild validation");
expect(pkg, /"audit-integrity:validate":[^\n]*audit-verification-schedule\.test\.mjs/,
  "durable scheduler/fence tests must gate production prebuild validation");
expect(pkg, /"audit-integrity:validate":[^\n]*validate-audit-history-resume\.mjs/,
  "static resumable-history contract must gate production prebuild validation");

expect(pkg, /"onprem:validate":[^\n]*audit-history-scheduler\.test\.mjs/,
  "independent history scheduler protocol tests must gate on-prem validation");
expect(dockerfile, /COPY scripts\/onprem-audit-history-scheduler\.mjs/,
  "on-prem scheduler image must include the independent history scheduler");
expect(dockerfile, /COPY scripts\/onprem-audit-history-health\.mjs/,
  "on-prem scheduler image must include the independent history health check");
expect(compose, /audit-history-scheduler:[\s\S]*onprem-audit-history-scheduler\.mjs/,
  "compose must run full-history verification in a process separate from fast maintenance");
expect(compose, /audit_history_scheduler_state:\/var\/lib\/hrbp-audit-history-scheduler/,
  "full-history scheduler health evidence must have a separate persistent state volume");
expect(compose, /HRBP_AUDIT_HISTORY_SCHEDULER_INTERVAL_SECONDS/,
  "full-history scheduler cadence must be independently configurable");
expect(envOnprem, /HRBP_AUDIT_FULL_HISTORY_PAGE_SIZE=250/,
  "on-prem example must declare a bounded history page budget");
expect(envOnprem, /HRBP_AUDIT_FULL_HISTORY_INTERVAL_HOURS=168/,
  "on-prem example must declare the full-history rescan interval");
expect(envOnprem, /HRBP_AUDIT_HISTORY_SCHEDULER_INTERVAL_SECONDS=900/,
  "on-prem example must declare a separate history scheduler cadence");

if (failures.length) {
  console.error("Audit history resume validation failed:\n" + failures.map(x => "- " + x).join("\n"));
  process.exit(1);
}
console.log("Audit history verification is bounded, resumable, separately scheduled and payload-free in operational metrics.");
