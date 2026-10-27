import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const evidencePath = "scripts/audit-retention-evidence.mjs";
const testPath = "scripts/audit-retention-evidence.test.mjs";
const archivePath = "scripts/audit-checkpoint-archive.mjs";
const timestampPath = "scripts/audit-checkpoint-timestamp.mjs";
const packagePath = "package.json";
const dockerPath = "Dockerfile.onprem";

const [evidence, tests, archive, timestamp, pkg, dockerfile] = await Promise.all([
  readFile(evidencePath, "utf8"),
  readFile(testPath, "utf8"),
  readFile(archivePath, "utf8"),
  readFile(timestampPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(dockerPath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(evidence, /HRBP-AUDIT-RETENTION-EVIDENCE:1\\n/,
  "retention evidence requires a dedicated signing domain");
expect(evidence, /EXTERNAL_RETENTION_EVIDENCE_BINDING/,
  "retention evidence scope must remain fixed");
expect(evidence, /OPERATOR_ATTESTED_PROVIDER_RECEIPT/,
  "software must not upgrade an opaque provider receipt into a false proof claim");
expect(evidence, /providerReceiptSha256/,
  "retention evidence must bind the exact provider receipt bytes");
expect(evidence, /archiveManifestSha256/,
  "retention evidence must bind the exact archive manifest");
expect(evidence, /timestampEvidenceSha256/,
  "retention evidence must bind the exact RFC3161 verification evidence");
expect(evidence, /timestampResponseSha256/,
  "retention evidence must retain linkage to the exact RFC3161 response");
expect(evidence, /expectedArchiveManifestSha256/,
  "archive manifest digest must be externally pinned");
expect(evidence, /expectedTimestampEvidenceSha256/,
  "timestamp evidence digest must be externally pinned");
expect(evidence, /expectedEvidenceSha256/,
  "retention evidence verification must pin the retained evidence digest");
expect(evidence, /RETENTION_EVIDENCE_RETENTION_POLICY_UNMET/,
  "provider retention shorter than requested retention must fail closed");
expect(evidence, /RETENTION_EVIDENCE_SEPARATION_VIOLATION/,
  "retention controller and checkpoint signer must remain cryptographically distinct");
expect(evidence, /storageTargetRef\(storageTargetId\)/,
  "raw storage target identity must be pseudonymously bound");
expect(evidence, /openSync\(temporary, "wx", 0o600\)/,
  "retention evidence output must remain no-overwrite");
expect(evidence, /readCheckpointFile\(path, \{ privateKey:true/,
  "retention controller private key must retain strict owner/mode validation");

reject(evidence, /DATABASE_URL|new Client\(|from ["']pg["']|fetch\(|node:http|node:https|node:net/,
  "retention evidence tooling must remain offline and database-independent");
reject(evidence, /spawnSync\(|execSync\(|shell\s*:\s*true/,
  "retention evidence binding must not execute provider commands or shell parsers");
reject(evidence, /JSON\.parse\([^\n]*providerReceipt|providerReceipt.*JSON\.parse/,
  "opaque provider receipt content must not be trusted as parsed enforcement state");
reject(evidence, /WORM_IS_PROVEN|PROVIDER_ENFORCEMENT_PROVEN/,
  "production code must not claim provider enforcement proof");
reject(evidence, /rejectUnauthorized\s*:\s*false/,
  "retention tooling must never weaken transport trust");

expect(tests, /provider receipt tampering and storage-target substitution fail source binding/,
  "provider receipt/target substitution needs executable coverage");
expect(tests, /provider retention shorter than the signed archive request is rejected/,
  "retention floor needs executable coverage");
expect(tests, /retention controller must be cryptographically distinct from checkpoint signer/,
  "separation-of-duties needs executable coverage");
expect(tests, /wrong controller key evidence digest and expired provider retention fail closed/,
  "controller/digest/expiry failure cases need executable coverage");
expect(tests, /CLI create and verify are no-overwrite/,
  "no-overwrite CLI evidence publication needs executable coverage");
expect(tests, /invalid assurance claims/,
  "false proof claims need executable rejection coverage");

expect(archive, /CHECKPOINT_ARCHIVE_MANIFEST/,
  "retention evidence must remain layered on the signed archive contract");
expect(timestamp, /RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION/,
  "retention evidence must remain layered on verified RFC3161 evidence");
expect(pkg, /audit-retention:validate/,
  "retention evidence contract must be mandatory through package validation");
reject(dockerfile, /audit-retention-evidence\.mjs/,
  "retention-controller tooling must not be bundled into the application runtime image");

console.log("Audit retention evidence contract: signed receipt binding, retention floor and separation boundary verified.");
