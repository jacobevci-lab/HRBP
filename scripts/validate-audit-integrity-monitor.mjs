import { readFileSync } from "node:fs";

const failures = [];
function expect(path, pattern, label) {
  const source = readFileSync(path, "utf8");
  if (!pattern.test(source)) failures.push(path + ": " + label);
}
function reject(path, pattern, label) {
  const source = readFileSync(path, "utf8");
  if (pattern.test(source)) failures.push(path + ": " + label);
}
const monitor = "lib/audit-monitoring.ts";
const schedule = "lib/audit-integrity-batching.mjs";
expect(monitor, /db\.tenant\.count\(\)/, "the complete tenant universe must be counted");
expect(monitor, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/, "tenant pages must have a stable tie-breaker");
expect(monitor, /skip: batch\.skip[,\s\S]*take: batch\.take/, "tenant reads must use a bounded rotated page");
expect(monitor, /selectAuditIntegrityBatch\(/, "batching must reuse the tested budget policy");
expect(monitor, /if \(result\.valid && result\.scope === "EMPTY"\)/,
  "only a valid EMPTY ledger can be counted as healthy");
expect(monitor, /failed \+= 1[\s\S]*AUDIT_INTEGRITY_FAILURE/,
  "invalid ledger results must enqueue a privileged integrity alert");
expect(monitor, /recipientRole: PlatformRole\.TENANT_ADMIN/, "integrity alerts must only reach governed tenant admins");
expect(monitor, /classification: DataClassification\.RESTRICTED/,
  "integrity alerts must retain the restricted classification");
expect(monitor, /quarterHourSlot: batch\.quarterHourSlot/, "operational telemetry must expose a bounded selection slot");
reject(monitor, /take:\s*10_000/, "never silently truncate the tenant universe");
reject(monitor, /if \(result\.scope === "EMPTY"\)/,
  "invalid-empty ledger results must not short-circuit the validity flag");
expect(schedule, /10_000 \/ verificationLimit/, "hash checks must respect the global event budget");
expect(schedule, /15 \* 60 \* 1000/, "tenant batches must rotate with the 15-minute scheduler cadence");
expect(schedule, /Math\.ceil\(tenantCount \/ tenantBatchSize\)/,
  "each batch must reflect the actual total tenant count");
for (const path of [".env.example", ".env.onprem.example"]) {
  expect(path, /^HRBP_AUDIT_INTEGRITY_TENANT_BATCH_SIZE=4$/m,
    "on-prem and standard examples must choose the new bounded default");
}
const pkg = "package.json";
expect(pkg, /"audit-integrity:validate": "node scripts\/validate-audit-integrity-monitor\.mjs && node --test scripts\/audit-integrity-monitoring\.test\.mjs/, 
  "bounded audit monitoring behavioral test must stay registered");
expect(pkg, /"audit-integrity:validate":[^\n]*scripts\/audit-full-history-verification\.test\.mjs/, 
  "operator-only genesis-to-tail verification behavioral tests must also run in the audit gate");
expect(pkg, /npm run maintenance:validate && npm run audit-integrity:validate && npm run hire:validate/,
  "audit integrity verification must gate production builds");
if (failures.length) {
  console.error("Audit integrity monitoring validation failed:\n" + failures.map(x => "- " + x).join("\n"));
  process.exit(1);
}
console.log("Audit integrity monitoring is bounded and invalid empty ledgers fail closed.");
