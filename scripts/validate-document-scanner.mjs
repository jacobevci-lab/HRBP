import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  schema,
  migration,
  route,
  upload,
  worker,
  clamd,
  health,
  compose,
  dockerfile,
  env,
  docs
] = await Promise.all([
  readFile("prisma/platform.prisma", "utf8"),
  readFile("prisma/migrations/20261007143000_document_scan_queue/migration.sql", "utf8"),
  readFile("app/api/internal/document-scan/route.ts", "utf8"),
  readFile("app/api/documents/[id]/versions/[versionId]/upload/route.ts", "utf8"),
  readFile("scripts/document-scan-worker.mjs", "utf8"),
  readFile("scripts/clamd-client.mjs", "utf8"),
  readFile("scripts/document-scan-health.mjs", "utf8"),
  readFile("docker-compose.onprem.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile(".env.onprem.example", "utf8"),
  readFile("docs/ONPREM-DEPLOYMENT.md", "utf8")
]);

for (const token of [
  "SCANNING",
  "scanAttempts       Int @default(0)",
  "scanLockedAt       DateTime?",
  "scanNextAttemptAt  DateTime @default(now())",
  "@@index([scanStatus, scanNextAttemptAt, createdAt])"
]) assert.ok(schema.includes(token), "Document scan schema contract missing: " + token);

for (const token of [
  "ALTER TYPE \"VaultScanStatus\" ADD VALUE",
  "\"scanAttempts\" INTEGER NOT NULL DEFAULT 0",
  "\"scanLockedAt\" TIMESTAMP(3)",
  "\"scanNextAttemptAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP",
  "DocumentVersion_scanAttempts_nonnegative",
  "DocumentVersion_scanStatus_scanNextAttemptAt_createdAt_idx"
]) assert.ok(migration.includes(token), "Document scan migration contract missing: " + token);

for (const token of [
  'internalBearerAuthorized(request, "HRBP_DOCUMENT_SCAN_TOKEN")',
  'body.action === "claim"',
  "recoverStaleScanLocks",
  "scanAttempts: { increment: 1 }",
  "scanStatus: VaultScanStatus.SCANNING",
  'body.action === "download"',
  "claimAttempt(body.attempt)",
  "current.scanAttempts !== attempt",
  "fetchPrivateObject(current.objectKey)",
  '"x-content-sha256"',
  'body.action === "release"',
  "releaseScanJob(versionId, attempt",
  "retryDelayMs",
  "RETRY_BUDGET_EXHAUSTED",
  "finalScanStatuses.includes",
  "current.scanAttempts !== 0",
  "idempotent: true",
  "Document scan state changed concurrently"
]) assert.ok(route.includes(token), "Internal scan protocol missing: " + token);
assert.ok(!route.includes("OBJECT_STORAGE_SECRET_KEY"), "Internal scan API must not expose storage credentials.");

for (const token of [
  "scanStatus: VaultScanStatus.PENDING",
  "scanAttempts: 0",
  "scanLockedAt: null",
  "scanNextAttemptAt: now"
]) assert.ok(upload.includes(token), "Upload-to-scan queue handoff missing: " + token);

for (const token of [
  'http://app:3000/api/internal/document-scan',
  "HRBP_DOCUMENT_SCAN_TOKEN",
  'action: "claim"',
  'action: "download"',
  "attempt: job.attempt",
  "x-content-sha256",
  'action: "release"',
  'createHash("sha256")',
  "CONTENT_INTEGRITY_MISMATCH",
  '"QUARANTINED"',
  "clamdPing",
  "clamdVersion",
  "clamdScanBuffer",
  "SCAN_COMPLETION_UNKNOWN",
  "heartbeat"
]) assert.ok(worker.includes(token), "Document scanner worker contract missing: " + token);
for (const forbidden of [
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_ENDPOINT"
]) assert.ok(!worker.includes(forbidden), "Scanner worker must not receive storage credential surface: " + forbidden);

for (const token of [
  'clamdCommand("PING")',
  'clamdCommand("VERSION")',
  'Buffer.from("z" + command + "\\0", "utf8")',
  'Buffer.from("zINSTREAM\\0", "utf8")',
  "writeUInt32BE",
  "CLAMD_REPLY_TOO_LARGE",
  "CLAMD_INPUT_INVALID",
  "FOUND"
]) assert.ok(clamd.includes(token), "ClamD client safety contract missing: " + token);

for (const token of [
  "heartbeat.json",
  "HEARTBEAT_STALE",
  "claim-unavailable",
  "clamdPing",
  "DOCUMENT_SCANNER_UNHEALTHY"
]) assert.ok(health.includes(token), "Scanner health contract missing: " + token);

const engineBlock = (compose.split("\n  document-scanner-engine:\n")[1] ?? "").split("\n  document-scanner:\n")[0];
const workerBlock = (compose.split("\n  document-scanner:\n")[1] ?? "").split("\n  maintenance-scheduler:\n")[0];
assert.ok(engineBlock, "Document scanner engine service must be present.");
assert.ok(workerBlock, "Document scanner worker service must be present.");
assert.ok(engineBlock.includes("clamav/clamav:1.5.4-debian"), "ClamAV image must be pinned to the reviewed patch release.");
assert.ok(engineBlock.includes("clamav_db:/var/lib/clamav"), "ClamAV signatures must persist across restarts.");
assert.ok(engineBlock.includes('["CMD", "clamdscan", "--ping=5"]'), "ClamAV engine health must use the bounded clamdscan ping probe.");
assert.ok(!/\n\s+ports:/.test(engineBlock), "ClamAV TCP socket must never be published to the host.");
assert.ok(!/\n\s+ports:/.test(workerBlock), "Scanner worker must never publish a host port.");
for (const token of [
  "target: scanner",
  "read_only: true",
  "no-new-privileges:true",
  "cap_drop:",
  "HRBP_DOCUMENT_SCAN_URL: http://app:3000/api/internal/document-scan",
  "HRBP_CLAMD_HOST: document-scanner-engine",
  "condition: service_healthy"
]) assert.ok(workerBlock.includes(token), "Scanner worker Compose contract missing: " + token);
assert.ok(!workerBlock.includes("OBJECT_STORAGE_SECRET_KEY"), "Scanner worker must not inherit explicit object-storage credentials.");
assert.ok(!workerBlock.includes("env_file:"), "Scanner worker must not inherit the full application secret file.");
assert.ok(compose.includes("clamav_db:"), "ClamAV signature database must use a named volume.");

for (const token of [
  "FROM base AS scanner",
  "document-scan-worker.mjs",
  "document-scan-health.mjs",
  "/var/run/hrbp-scanner",
  'CMD ["node", "scripts/document-scan-worker.mjs"]'
]) assert.ok(dockerfile.includes(token), "Scanner image contract missing: " + token);
assert.ok(/FROM base AS scanner[\s\S]*USER node[\s\S]*CMD \["node", "scripts\/document-scan-worker\.mjs"\]/.test(dockerfile),
  "Scanner image must run as the unprivileged node user.");

for (const token of [
  "DOCUMENT_SCANNER_IMAGE=clamav/clamav:1.5.4-debian",
  "HRBP_DOCUMENT_SCAN_POLL_SECONDS=10",
  "HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS=5",
  "HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS=30",
  "HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS=600",
  "HRBP_DOCUMENT_SCAN_LOCK_MINUTES=15",
  "HRBP_DOCUMENT_SCAN_MAX_BYTES=26214400",
  "HRBP_CLAMD_TIMEOUT_MS=30000"
]) assert.ok(env.includes(token), "On-prem scanner environment example missing: " + token);
assert.ok(!/DOCUMENT_SCANNER_IMAGE=.*:(?:latest|stable)$/m.test(env), "Scanner image must not use a mutable tag.");

for (const token of [
  "document scanner",
  "ClamAV",
  "PENDING",
  "QUARANTINED",
  "CLEAN"
]) assert.ok(docs.toLowerCase().includes(token.toLowerCase()), "On-prem runbook missing scanner guidance: " + token);

console.log("Document malware scanner validation passed.");
