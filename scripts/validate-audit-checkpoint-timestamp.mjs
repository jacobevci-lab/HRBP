import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timestampPath = "scripts/audit-checkpoint-timestamp.mjs";
const testPath = "scripts/audit-checkpoint-timestamp.test.mjs";
const checkpointPath = "scripts/audit-checkpoint.mjs";
const packagePath = "package.json";
const dockerPath = "Dockerfile.onprem";

const [timestamp, tests, checkpoint, pkg, dockerfile] = await Promise.all([
  readFile(timestampPath, "utf8"),
  readFile(testPath, "utf8"),
  readFile(checkpointPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(dockerPath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(timestamp, /"ts", "-query"/, "timestamp query must use OpenSSL RFC3161 query generation");
expect(timestamp, /"ts", "-verify"/, "timestamp verification must use OpenSSL RFC3161 verification");
expect(timestamp, /"-data", checkpointPath/, "verification must bind the response to the exact checkpoint bytes");
expect(timestamp, /"-CAfile", caFile/, "verification must require an explicit CA trust store");
expect(timestamp, /"-untrusted", untrustedChainFile/, "optional TSA chain input must remain explicit");
expect(timestamp, /parseAuditCheckpoint\(bytes\.toString\("utf8"\)\)/,
  "only canonical audit checkpoint files may be timestamped");
expect(timestamp, /TIMESTAMP_OPENSSL_VERIFY_FAILED/, "OpenSSL verification failure must fail closed");
expect(timestamp, /TIMESTAMP_FUTURE/, "future timestamp receipts must fail closed");
expect(timestamp, /openSync\(temporary, "wx", 0o600\)/, "timestamp evidence publication must be no-overwrite");
expect(timestamp, /timestampResponseSha256/, "evidence must bind the exact RFC3161 response");
expect(timestamp, /trustStoreSha256/, "evidence must bind the exact verification trust store");
expect(timestamp, /RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION/, "evidence scope must be fixed");

reject(timestamp, /DATABASE_URL|new Client\(|from ["']pg["']|fetch\(|node:http|node:https|node:net/,
  "timestamp tooling must remain offline and database-independent");
reject(timestamp, /execSync\(|shell\s*:\s*true/, "OpenSSL must be invoked with an argument array, never a shell");
reject(timestamp, /rejectUnauthorized\s*:\s*false/, "timestamp tooling must never weaken transport trust");

expect(tests, /real OpenSSL RFC3161 response verifies against checkpoint and pinned CA trust store/,
  "real RFC3161 verification needs executable CI coverage");
expect(tests, /timestamp response cannot be replayed onto a different valid checkpoint/,
  "checkpoint substitution needs executable coverage");
expect(tests, /timestamp response signed by an untrusted TSA root fails closed/,
  "untrusted TSA roots need executable coverage");
expect(tests, /TIMESTAMP_OUTPUT_EXISTS/, "no-overwrite query/evidence publication needs executable coverage");
expect(checkpoint, /FULL_READ_ONLY_SNAPSHOT/, "timestamping must remain layered on independent signed checkpoints");
expect(pkg, /audit-timestamp:validate/, "timestamp contract must be mandatory through package validation");
reject(dockerfile, /audit-checkpoint-timestamp\.mjs/, "timestamp operator tooling must not be bundled into app runtime images");

console.log("Audit RFC3161 timestamp contract: offline query/verification, checkpoint binding and pinned TSA trust verified.");
