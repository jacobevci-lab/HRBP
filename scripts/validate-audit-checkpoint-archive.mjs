import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptPath = "scripts/audit-checkpoint-archive.mjs";
const testPath = "scripts/audit-checkpoint-archive.test.mjs";
const checkpointPath = "scripts/audit-checkpoint.mjs";
const packagePath = "package.json";
const dockerPath = "Dockerfile.onprem";

const [script, tests, checkpoint, pkg, dockerfile] = await Promise.all([
  readFile(scriptPath, "utf8"),
  readFile(testPath, "utf8"),
  readFile(checkpointPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(dockerPath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(script, /HRBP-AUDIT-CHECKPOINT-ARCHIVE:1\\n/, "archive manifests need a dedicated signing domain");
expect(script, /CHECKPOINT_ARCHIVE_MANIFEST/, "archive manifests must use a fixed signed scope");
expect(script, /OPERATOR_EXTERNAL_RETENTION_TARGET/, "archive output must identify the external retention target profile");
expect(script, /checkpointSha256/, "archive manifest must bind the exact signed checkpoint bytes");
expect(script, /retentionUntil/, "archive manifest must bind the retention deadline");
expect(script, /sign\(null, signedBytes\(manifest\), privateKey\)/, "retention metadata must be signed");
expect(script, /verify\(null, signedBytes\(envelope\.manifest\), publicKey/, "offline verification must authenticate the signed archive manifest");
expect(script, /openSync\(path, "wx", 0o600\)/, "archive files must never overwrite an existing evidence file");
expect(script, /mkdirSync\(directory, \{ mode: 0o700 \}\)/, "each archive bundle must be published into a new private directory");
expect(script, /isAbsolute\(directory\)/, "archive bundle paths must be explicit absolute operator paths");
expect(script, /readCheckpointFile\(parsed\.values\["--private-key-file"\], \{ privateKey: true/, "private keys must retain strict ownership/mode validation");
expect(script, /--acknowledge-external-retention-target/, "export requires explicit operator acknowledgement");
expect(script, /CHECKPOINT_ARCHIVE_RETENTION_POLICY_UNMET/, "external retention floors must fail closed");
expect(script, /CHECKPOINT_ARCHIVE_RETENTION_EXPIRED/, "expired retained evidence must be visible");
expect(script, /CHECKPOINT_ARCHIVE_EXPORT_DELAY_EXCEEDED/, "late publication must remain operator-actionable");
expect(script, /CHECKPOINT_ARCHIVE_FUTURE/, "future-dated archive publication must fail closed");
expect(script, /CHECKPOINT_ARCHIVE_OUTPUT_UNSAFE/, "world-writable evidence parents must be rejected");
expect(script, /stat\.mode & 0o002/, "archive publication must inspect world-writable parent permissions");

reject(script, /DATABASE_URL|new Client\(|from ["']pg["']|fetch\(|node:http|node:https|node:net/, "archive export/verify must remain offline and database-independent");
reject(script, /unlinkSync\(join\(directory, "checkpoint\.json"\)|rmSync\(|force:\s*true/, "archive publication must not silently clean or replace retained evidence");
reject(script, /rejectUnauthorized\s*:\s*false/, "archive tooling must never introduce disabled transport trust");

expect(tests, /changing signed retention metadata invalidates the archive signature/, "tampered retention metadata needs executable coverage");
expect(tests, /different valid checkpoint cannot be substituted/, "checkpoint substitution needs executable coverage");
expect(tests, /bundle publication is no-overwrite/, "no-overwrite archive publication needs executable coverage");
expect(tests, /future-dated archive publication is rejected/, "future archive timestamps need executable coverage");
expect(tests, /world-writable archive parents are rejected/, "unsafe archive parents need executable coverage");
expect(tests, /offline export and verify CLI needs no database connection/, "operator archive CLI must be proven offline");
expect(checkpoint, /FULL_READ_ONLY_SNAPSHOT/, "archive tooling must remain layered on the independently scanned checkpoint format");
expect(pkg, /audit-checkpoint-archive\.test\.mjs/, "archive tests must be part of a mandatory package validation path");
expect(pkg, /validate-audit-checkpoint-archive\.mjs/, "archive static contract must be mandatory");
reject(dockerfile, /audit-checkpoint-archive\.mjs|audit-checkpoint\.mjs/, "independent signer/archive tooling must not be bundled into the application on-prem image");

console.log("Audit checkpoint archive contract: offline signed retention bundle, no-overwrite publication and independent operator boundary verified.");
