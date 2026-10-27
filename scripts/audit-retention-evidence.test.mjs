import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullAuditHash } from "./audit-full-history-verification.mjs";
import {
  createAuditCheckpoint, encodeAuditCheckpoint
} from "./audit-checkpoint.mjs";
import {
  createAuditCheckpointArchive,
  writeAuditCheckpointArchiveBundle
} from "./audit-checkpoint-archive.mjs";
import {
  encodeTimestampEvidence
} from "./audit-checkpoint-timestamp.mjs";
import {
  createRetentionEvidence,
  encodeRetentionEvidence,
  parseRetentionEvidence,
  runRetentionEvidenceCli,
  verifyRetentionEvidence
} from "./audit-retention-evidence.mjs";

const tenantId = "retention-ci-tenant";
const deploymentId = "retention-ci-deployment";
const context = { tenantId, deploymentId };
const signer = generateKeyPairSync("ed25519");
const controller = generateKeyPairSync("ed25519");
const otherController = generateKeyPairSync("ed25519");
const issuedAt = Date.parse("2026-10-27T01:00:00.000Z");
const exportedAt = issuedAt + 5 * 60_000;
const timestampAt = exportedAt + 60_000;
const recordedAt = timestampAt + 60_000;
const DAY_MS = 24 * 60 * 60_000;

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const code = expected => error => error?.code === expected;

function rows(count = 4) {
  let previousHash = null;
  return Array.from({ length: count }, (_, index) => {
    const row = {
      tenantId,
      ledgerSequence: String(index + 1),
      actorId: "private-retention-actor",
      action: "retention.probe",
      resourceType: "Synthetic",
      resourceId: "private-retention-resource-" + index,
      purpose: "Retention evidence regression",
      classification: "RESTRICTED",
      ipAddress: null,
      occurredAt: new Date("2026-10-27T00:00:00.000Z"),
      previousHash
    };
    row.hash = fullAuditHash(row, previousHash);
    previousHash = row.hash;
    return row;
  });
}
function harness(sourceRows = rows()) {
  let active = false;
  let snapshot = [];
  let state = null;
  return {
    async query(sql, params = []) {
      if (sql.startsWith("BEGIN ")) {
        active = true;
        snapshot = structuredClone(sourceRows);
        state = snapshot.length
          ? { eventCount: String(snapshot.length), tailHash: snapshot.at(-1).hash }
          : null;
        return { rows: [] };
      }
      assert.equal(active, true);
      if (sql === "ROLLBACK") { active = false; return { rows: [] }; }
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/);
      assert.equal(params[0], tenantId);
      if (sql.includes('FROM "Tenant"')) return { rows: [{ id: tenantId }] };
      if (sql.includes('FROM "AuditLedgerState"')) return { rows: state ? [state] : [] };
      return {
        rows: snapshot
          .filter(row => BigInt(row.ledgerSequence) > BigInt(params[1]))
          .slice(0, params[2])
      };
    }
  };
}
async function checkpoint() {
  return createAuditCheckpoint(
    harness(),
    { tenantId, maxEvents: 100, batchSize: 2 },
    signer.privateKey,
    context,
    () => issuedAt
  );
}
async function fixture(root, { retentionDays = 365 } = {}) {
  const savedCheckpoint = await checkpoint();
  const archive = createAuditCheckpointArchive(
    savedCheckpoint,
    signer.privateKey,
    context,
    { maxAgeMs: 3600_000, retentionDays, now: exportedAt }
  );
  const archiveDir = join(root, "archive");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeAuditCheckpointArchiveBundle(archiveDir, savedCheckpoint, archive);
  const archiveManifestPath = join(archiveDir, "archive-manifest.json");
  const archiveManifestBytes = readFileSync(archiveManifestPath);
  const archiveManifestSha256 = sha(archiveManifestBytes);

  const timestampEvidence = {
    version:1,
    scope:"RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION",
    algorithm:"SHA256",
    checkpointSha256:archive.manifest.checkpointSha256,
    timestampResponseSha256:"b".repeat(64),
    trustStoreSha256:"c".repeat(64),
    policyOid:"1.2.3.4.1",
    timestampAt:new Date(timestampAt).toISOString(),
    verifiedAt:new Date(timestampAt + 30_000).toISOString()
  };
  const timestampEvidencePath = join(root, "timestamp-evidence.json");
  const timestampBytes = Buffer.from(encodeTimestampEvidence(timestampEvidence));
  writeFileSync(timestampEvidencePath, timestampBytes, { mode:0o600 });
  const timestampEvidenceSha256 = sha(timestampBytes);

  const providerReceiptPath = join(root, "provider-receipt.json");
  writeFileSync(providerReceiptPath, JSON.stringify({
    provider:"synthetic-ci-only",
    objectVersion:"private-object-version",
    retainedUntil:new Date(exportedAt + (retentionDays + 30) * DAY_MS).toISOString()
  }) + "\n", { mode:0o600 });

  return {
    savedCheckpoint,
    archive,
    archiveDir,
    archiveManifestPath,
    archiveManifestSha256,
    timestampEvidence,
    timestampEvidencePath,
    timestampEvidenceSha256,
    providerReceiptPath
  };
}

test("signed retention evidence binds archive timestamp provider receipt and target without leaking raw identifiers", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-evidence-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const providerRetentionUntil = new Date(exportedAt + 400 * DAY_MS).toISOString();
    const evidence = createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"customer-a/prod/audit-vault",
      retentionMode:"OBJECT_LOCK_COMPLIANCE",
      providerRetentionUntil,
      now:recordedAt
    });
    const encoded = encodeRetentionEvidence(evidence);
    assert.deepEqual(parseRetentionEvidence(encoded), evidence);
    const evidenceSha256 = sha(encoded);
    const verified = verifyRetentionEvidence(evidence, {
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPublicKey:controller.publicKey,
      storageTargetId:"customer-a/prod/audit-vault",
      expectedEvidenceSha256:evidenceSha256,
      minRetentionUntil:new Date(exportedAt + 365 * DAY_MS).toISOString(),
      now:recordedAt + DAY_MS
    });
    assert.equal(verified.providerRetentionUntil, providerRetentionUntil);
    assert.equal(verified.retentionMode, "OBJECT_LOCK_COMPLIANCE");
    for (const secret of [
      tenantId, deploymentId, "customer-a/prod/audit-vault",
      "private-object-version", "synthetic-ci-only"
    ]) assert.ok(!encoded.includes(secret));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("provider receipt tampering and storage-target substitution fail source binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-tamper-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const evidence = createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"VAULT_LOCK",
      providerRetentionUntil:new Date(exportedAt + 500 * DAY_MS).toISOString(),
      now:recordedAt
    });
    const evidenceSha256 = sha(encodeRetentionEvidence(evidence));
    writeFileSync(fx.providerReceiptPath, "{\"tampered\":true}\n", { mode:0o600 });
    assert.throws(() => verifyRetentionEvidence(evidence, {
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPublicKey:controller.publicKey,
      storageTargetId:"approved-target",
      expectedEvidenceSha256:evidenceSha256,
      now:recordedAt
    }), code("RETENTION_EVIDENCE_SOURCE_MISMATCH"));

    writeFileSync(fx.providerReceiptPath, JSON.stringify({
      provider:"synthetic-ci-only",
      objectVersion:"private-object-version",
      retainedUntil:new Date(exportedAt + 395 * DAY_MS).toISOString()
    }) + "\n", { mode:0o600 });
    assert.throws(() => verifyRetentionEvidence(evidence, {
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPublicKey:controller.publicKey,
      storageTargetId:"substituted-target",
      expectedEvidenceSha256:evidenceSha256,
      now:recordedAt
    }), code("RETENTION_EVIDENCE_SOURCE_MISMATCH"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("timestamp evidence for another checkpoint is rejected before retention evidence can be created", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-timestamp-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const changed = { ...fx.timestampEvidence, checkpointSha256:"d".repeat(64) };
    const changedBytes = Buffer.from(encodeTimestampEvidence(changed));
    writeFileSync(fx.timestampEvidencePath, changedBytes, { mode:0o600 });
    assert.throws(() => createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:sha(changedBytes),
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"REGULATED_ARCHIVE",
      providerRetentionUntil:new Date(exportedAt + 400 * DAY_MS).toISOString(),
      now:recordedAt
    }), code("RETENTION_EVIDENCE_CHECKPOINT_MISMATCH"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("provider retention shorter than the signed archive request is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-short-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root, { retentionDays:365 });
    assert.throws(() => createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"OBJECT_LOCK_GOVERNANCE",
      providerRetentionUntil:new Date(exportedAt + 300 * DAY_MS).toISOString(),
      now:recordedAt
    }), code("RETENTION_EVIDENCE_RETENTION_POLICY_UNMET"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("retention controller must be cryptographically distinct from checkpoint signer", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-separation-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    assert.throws(() => createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:signer.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"APPEND_ONLY_ARCHIVE",
      providerRetentionUntil:new Date(exportedAt + 400 * DAY_MS).toISOString(),
      now:recordedAt
    }), code("RETENTION_EVIDENCE_SEPARATION_VIOLATION"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("wrong controller key evidence digest and expired provider retention fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-verify-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const providerRetentionUntil = new Date(exportedAt + 40 * DAY_MS).toISOString();
    const evidence = createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"REGULATED_ARCHIVE",
      providerRetentionUntil,
      now:recordedAt
    });
    const evidenceSha256 = sha(encodeRetentionEvidence(evidence));
    const common = {
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      storageTargetId:"approved-target"
    };
    assert.throws(() => verifyRetentionEvidence(evidence, {
      ...common,
      controllerPublicKey:otherController.publicKey,
      expectedEvidenceSha256:evidenceSha256,
      now:recordedAt
    }), code("RETENTION_EVIDENCE_CONTROLLER_UNTRUSTED"));
    assert.throws(() => verifyRetentionEvidence(evidence, {
      ...common,
      controllerPublicKey:controller.publicKey,
      expectedEvidenceSha256:"0".repeat(64),
      now:recordedAt
    }), code("RETENTION_EVIDENCE_DIGEST_MISMATCH"));
    assert.throws(() => verifyRetentionEvidence(evidence, {
      ...common,
      controllerPublicKey:controller.publicKey,
      expectedEvidenceSha256:evidenceSha256,
      now:Date.parse(providerRetentionUntil) + 1
    }), code("RETENTION_EVIDENCE_RETENTION_EXPIRED"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("CLI create and verify are no-overwrite and return bounded identifiers only", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-cli-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const privatePath = join(root, "controller-private.pem");
    const publicPath = join(root, "controller-public.pem");
    const evidencePath = join(root, "retention-evidence.json");
    writeFileSync(privatePath, controller.privateKey.export({ type:"pkcs8", format:"pem" }), { mode:0o600 });
    chmodSync(privatePath, 0o600);
    writeFileSync(publicPath, controller.publicKey.export({ type:"spki", format:"pem" }), { mode:0o644 });

    const created = await runRetentionEvidenceCli([
      "create",
      "--archive-dir", fx.archiveDir,
      "--expected-archive-manifest-sha256", fx.archiveManifestSha256,
      "--timestamp-evidence", fx.timestampEvidencePath,
      "--expected-timestamp-evidence-sha256", fx.timestampEvidenceSha256,
      "--provider-receipt", fx.providerReceiptPath,
      "--storage-target-id", "customer-a/prod/audit-vault",
      "--controller-private-key-file", privatePath,
      "--retention-mode", "OBJECT_LOCK_COMPLIANCE",
      "--provider-retention-until", new Date(exportedAt + 400 * DAY_MS).toISOString(),
      "--out", evidencePath,
      "--acknowledge-provider-retention-verified"
    ], () => recordedAt);
    assert.equal(created.code, "RETENTION_EVIDENCE_CREATED");
    assert.equal(created.evidenceSha256.length, 64);
    assert.ok(!JSON.stringify(created).includes(root));
    assert.ok(!JSON.stringify(created).includes("customer-a/prod/audit-vault"));

    await assert.rejects(runRetentionEvidenceCli([
      "create",
      "--archive-dir", fx.archiveDir,
      "--expected-archive-manifest-sha256", fx.archiveManifestSha256,
      "--timestamp-evidence", fx.timestampEvidencePath,
      "--expected-timestamp-evidence-sha256", fx.timestampEvidenceSha256,
      "--provider-receipt", fx.providerReceiptPath,
      "--storage-target-id", "customer-a/prod/audit-vault",
      "--controller-private-key-file", privatePath,
      "--retention-mode", "OBJECT_LOCK_COMPLIANCE",
      "--provider-retention-until", new Date(exportedAt + 400 * DAY_MS).toISOString(),
      "--out", evidencePath,
      "--acknowledge-provider-retention-verified"
    ], () => recordedAt), code("RETENTION_EVIDENCE_OUTPUT_EXISTS"));

    const verified = await runRetentionEvidenceCli([
      "verify",
      "--archive-dir", fx.archiveDir,
      "--expected-archive-manifest-sha256", fx.archiveManifestSha256,
      "--timestamp-evidence", fx.timestampEvidencePath,
      "--expected-timestamp-evidence-sha256", fx.timestampEvidenceSha256,
      "--provider-receipt", fx.providerReceiptPath,
      "--storage-target-id", "customer-a/prod/audit-vault",
      "--evidence", evidencePath,
      "--controller-public-key-file", publicPath,
      "--expected-evidence-sha256", created.evidenceSha256,
      "--min-retention-until", new Date(exportedAt + 365 * DAY_MS).toISOString()
    ], () => recordedAt + DAY_MS);
    assert.equal(verified.code, "RETENTION_EVIDENCE_VALID");
    assert.equal(verified.retentionMode, "OBJECT_LOCK_COMPLIANCE");
    assert.ok(!readFileSync(evidencePath, "utf8").includes("customer-a/prod/audit-vault"));
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("retention evidence serialization rejects unknown fields and invalid assurance claims", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-retention-shape-"));
  try {
    chmodSync(root, 0o700);
    const fx = await fixture(root);
    const evidence = createRetentionEvidence({
      archiveDir:fx.archiveDir,
      expectedArchiveManifestSha256:fx.archiveManifestSha256,
      timestampEvidencePath:fx.timestampEvidencePath,
      expectedTimestampEvidenceSha256:fx.timestampEvidenceSha256,
      providerReceiptPath:fx.providerReceiptPath,
      controllerPrivateKey:controller.privateKey,
      storageTargetId:"approved-target",
      retentionMode:"REGULATED_ARCHIVE",
      providerRetentionUntil:new Date(exportedAt + 400 * DAY_MS).toISOString(),
      now:recordedAt
    });
    assert.throws(() => encodeRetentionEvidence({
      ...evidence,
      manifest:{ ...evidence.manifest, proof:"WORM_IS_PROVEN" }
    }));
    assert.throws(() => encodeRetentionEvidence({
      ...evidence,
      manifest:{ ...evidence.manifest, assuranceLevel:"PROVIDER_ENFORCEMENT_PROVEN" }
    }));
  } finally { rmSync(root, { recursive:true, force:true }); }
});
