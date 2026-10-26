import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullAuditHash } from "./audit-full-history-verification.mjs";
import {
  checkpointKeyId
} from "./audit-checkpoint.mjs";
import {
  createInitialSignerTrustInventory,
  encodeSignerTrustInventory,
  revokeSignerTrustInventory,
  rotateSignerTrustInventory,
  writeSignerTrustInventoryGeneration
} from "./audit-signer-trust-inventory.mjs";
import {
  acquirePublicationLock,
  publishIndependentAuditCheckpoint,
  releasePublicationLock,
  runAuditCheckpointPublicationCli
} from "./audit-checkpoint-publication.mjs";
import {
  approveGovernanceProposal,
  createGovernanceApprovalPolicy,
  createGovernanceProposal,
  encodeGovernanceApprovalPolicy,
  governanceApprovalPolicySha256
} from "./audit-governance-approval.mjs";
import {
  authorityTrustInventorySha256,
  createInitialAuthorityTrustInventory,
  recoverAuthorityTrustInventory,
  rotateAuthorityTrustInventory,
  writeAuthorityTrustInventoryGeneration
} from "./audit-trust-authority-inventory.mjs";

const tenantId = "publication-ci-tenant";
const deploymentId = "publication-ci-deployment";
const context = { tenantId, deploymentId };
const authority = generateKeyPairSync("ed25519");
const authority2 = generateKeyPairSync("ed25519");
const approver1 = generateKeyPairSync("ed25519");
const approver2 = generateKeyPairSync("ed25519");
const signer1 = generateKeyPairSync("ed25519");
const signer2 = generateKeyPairSync("ed25519");
const t0 = Date.parse("2026-10-26T07:00:00.000Z");
const t1 = t0 + 60_000;
const approvalPolicy = createGovernanceApprovalPolicy({
  approverPublicKeys: [approver1.publicKey, approver2.publicKey],
  minApprovals: 2,
  ...context,
  issuedAt: t0 - 10 * 60_000,
  expiresAt: t0 + 24 * 60 * 60_000
});
const approvalPolicySha = governanceApprovalPolicySha256(approvalPolicy);

function approvals(operation, currentGeneration, currentSha256, targetKeyId, now) {
  let bundle = {
    proposal: createGovernanceProposal({
      ...context,
      operation,
      currentGeneration,
      currentSha256,
      targetKeyId,
      now,
      expiresAt: now + 30 * 60_000
    }),
    approvals: []
  };
  bundle = approveGovernanceProposal(bundle, approver1.privateKey, now + 1000);
  bundle = approveGovernanceProposal(bundle, approver2.privateKey, now + 2000);
  return bundle;
}
function initialAuthority(now = t0 - 2 * 60_000) {
  return createInitialAuthorityTrustInventory(
    authority.publicKey,
    approvalPolicy,
    approvals("INIT_AUTHORITY", 0, null, checkpointKeyId(authority.publicKey), now),
    context,
    { expectedPolicySha256: approvalPolicySha, now }
  );
}
function authorityOptions(authorityChain = [initialAuthority()]) {
  const latest = authorityChain.at(-1);
  return {
    authorityChain,
    authorityPolicy: approvalPolicy,
    expectedAuthorityPolicySha256: approvalPolicySha,
    expectedAuthoritySha256: authorityTrustInventorySha256(latest),
    authorityMaxAgeMs: 24 * 3600_000
  };
}

function rows(count = 4) {
  let previousHash = null;
  return Array.from({ length: count }, (_, i) => {
    const row = {
      tenantId,
      ledgerSequence: String(i + 1),
      actorId: "private-publication-actor",
      action: "publication.probe",
      resourceType: "Synthetic",
      resourceId: "private-publication-resource-" + i,
      purpose: "Independent publication regression",
      classification: "RESTRICTED",
      ipAddress: "192.0.2.77",
      occurredAt: new Date("2026-10-26T06:00:00.000Z"),
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
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.startsWith("BEGIN ")) {
          assert.match(sql, /REPEATABLE READ READ ONLY/);
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
      },
      async end() { assert.equal(active, false); }
    }
  };
}
function initialTrust(now = t0 - 60_000) {
  return createInitialSignerTrustInventory(
    authority.privateKey, signer1.publicKey, context, now
  );
}
function digest(value) {
  return createHash("sha256").update(encodeSignerTrustInventory(value)).digest("hex");
}

test("publisher creates and reads back one governed external bundle", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    mkdirSync(archiveRoot, { mode: 0o700 });
    const trust = initialTrust();
    const h = harness();
    let tick = t0;
    const result = await publishIndependentAuditCheckpoint({
      client: h.client,
      signerPrivateKey: signer1.privateKey,
      ...authorityOptions(),
      trustChain: [trust],
      expectedTrustSha256: digest(trust),
      trustMaxAgeMs: 24 * 3600_000,
      context,
      scanOptions: { tenantId, maxEvents: 100, batchSize: 2 },
      archiveRoot,
      retentionDays: 365,
      archiveMaxAgeMs: 3600_000,
      clock: () => tick++
    });
    assert.equal(result.code, "CHECKPOINT_PUBLICATION_COMPLETE");
    assert.equal(result.sequence, "4");
    assert.equal(result.trustGeneration, 1);
    assert.equal(result.trustInventorySha256, digest(trust));
    assert.equal(existsSync(join(archiveRoot, result.bundleId, "checkpoint.json")), true);
    assert.equal(existsSync(join(archiveRoot, result.bundleId, "archive-manifest.json")), true);
    assert.ok(h.calls.some(call => call.sql.startsWith("BEGIN ")));
    assert.ok(!JSON.stringify(result).includes(archiveRoot));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("publisher refuses a stale signer after governed rotation before scanning the database", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-rotation-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    mkdirSync(archiveRoot, { mode: 0o700 });
    const first = initialTrust();
    const second = rotateSignerTrustInventory(
      first, authority.privateKey, signer2.publicKey, context, t1
    );
    const h = harness();
    await assert.rejects(publishIndependentAuditCheckpoint({
      client: h.client,
      signerPrivateKey: signer1.privateKey,
      ...authorityOptions(),
      trustChain: [first, second],
      expectedTrustSha256: digest(second),
      trustMaxAgeMs: 24 * 3600_000,
      context,
      scanOptions: { tenantId, maxEvents: 100, batchSize: 2 },
      archiveRoot,
      retentionDays: 365,
      archiveMaxAgeMs: 3600_000,
      clock: () => t1
    }), error => error?.code === "CHECKPOINT_PUBLICATION_SIGNER_NOT_ACTIVE");
    assert.equal(h.calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("revoking the only active signer suspends publication without fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-revoked-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    mkdirSync(archiveRoot, { mode: 0o700 });
    const first = initialTrust();
    const revoked = revokeSignerTrustInventory(
      first, authority.privateKey, checkpointKeyId(signer1.publicKey), context, t1
    );
    const h = harness();
    await assert.rejects(publishIndependentAuditCheckpoint({
      client: h.client,
      signerPrivateKey: signer1.privateKey,
      ...authorityOptions(),
      trustChain: [first, revoked],
      expectedTrustSha256: digest(revoked),
      trustMaxAgeMs: 24 * 3600_000,
      context,
      scanOptions: { tenantId, maxEvents: 100, batchSize: 2 },
      archiveRoot,
      retentionDays: 365,
      archiveMaxAgeMs: 3600_000,
      clock: () => t1
    }), error => error?.code === "CHECKPOINT_PUBLICATION_NO_ACTIVE_SIGNER");
    assert.equal(h.calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("planned authority rotation preserves publication while emergency recovery invalidates old authority history", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-authority-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    mkdirSync(archiveRoot, { mode: 0o700 });
    const firstAuthority = initialAuthority();
    const firstAuthoritySha = authorityTrustInventorySha256(firstAuthority);
    const rotated = rotateAuthorityTrustInventory(
      firstAuthority,
      authority2.publicKey,
      approvalPolicy,
      approvals("ROTATE_AUTHORITY", 1, firstAuthoritySha, checkpointKeyId(authority2.publicKey), t1),
      context,
      { expectedPolicySha256: approvalPolicySha, expectedCurrentSha256: firstAuthoritySha, now: t1 }
    );
    const trust = initialTrust();
    const h = harness();
    const published = await publishIndependentAuditCheckpoint({
      client: h.client,
      signerPrivateKey: signer1.privateKey,
      ...authorityOptions([firstAuthority, rotated]),
      trustChain: [trust],
      expectedTrustSha256: digest(trust),
      trustMaxAgeMs: 24 * 3600_000,
      context,
      scanOptions: { tenantId, maxEvents: 100, batchSize: 2 },
      archiveRoot,
      retentionDays: 365,
      archiveMaxAgeMs: 3600_000,
      clock: () => t1 + 10_000
    });
    assert.equal(published.code, "CHECKPOINT_PUBLICATION_COMPLETE");
    assert.equal(published.authorityGeneration, 2);

    const recovered = recoverAuthorityTrustInventory(
      firstAuthority,
      authority2.publicKey,
      approvalPolicy,
      approvals("RECOVER_AUTHORITY", 1, firstAuthoritySha, checkpointKeyId(authority2.publicKey), t1),
      context,
      { expectedPolicySha256: approvalPolicySha, expectedCurrentSha256: firstAuthoritySha, now: t1 }
    );
    const h2 = harness();
    await assert.rejects(publishIndependentAuditCheckpoint({
      client: h2.client,
      signerPrivateKey: signer1.privateKey,
      ...authorityOptions([firstAuthority, recovered]),
      trustChain: [trust],
      expectedTrustSha256: digest(trust),
      trustMaxAgeMs: 24 * 3600_000,
      context,
      scanOptions: { tenantId, maxEvents: 100, batchSize: 2 },
      archiveRoot,
      retentionDays: 365,
      archiveMaxAgeMs: 3600_000,
      clock: () => t1 + 20_000
    }), error => error?.code === "AUTHORITY_INVENTORY_KEY_REVOKED");
    assert.equal(h2.calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("publication lock is exclusive and never replaces an existing lock", () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-lock-"));
  try {
    chmodSync(root, 0o700);
    const path = join(root, "publication.lock");
    const first = acquirePublicationLock(path);
    assert.equal(existsSync(path), true);
    assert.throws(() => acquirePublicationLock(path),
      error => error?.code === "CHECKPOINT_PUBLICATION_LOCKED");
    releasePublicationLock(first);
    assert.equal(existsSync(path), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI validates trust and active signer before opening a database connection", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-cli-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    const trustDir = join(root, "trust");
    const stateDir = join(root, "state");
    mkdirSync(archiveRoot, { mode: 0o700 });
    mkdirSync(trustDir, { mode: 0o700 });
    mkdirSync(stateDir, { mode: 0o700 });
    const signerPrivate = join(root, "signer-private.pem");
    const authorityDir = join(root, "authority-inventory");
    const authorityPolicyPath = join(root, "authority-policy.json");
    writeFileSync(signerPrivate, signer1.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(signerPrivate, 0o600);
    mkdirSync(authorityDir, { mode: 0o700 });
    writeFileSync(authorityPolicyPath, encodeGovernanceApprovalPolicy(approvalPolicy), { mode: 0o600 });
    const authorityInventory = initialAuthority();
    const authorityWritten = writeAuthorityTrustInventoryGeneration(authorityDir, authorityInventory);

    const first = initialTrust();
    const second = rotateSignerTrustInventory(
      first, authority.privateKey, signer2.publicKey, context, t1
    );
    writeSignerTrustInventoryGeneration(trustDir, first);
    const current = writeSignerTrustInventoryGeneration(trustDir, second);

    let connected = false;
    await assert.rejects(runAuditCheckpointPublicationCli([
      "run",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--signer-private-key-file", signerPrivate,
      "--trust-inventory-dir", trustDir,
      "--expected-trust-sha256", current.inventorySha256,
      "--trust-max-age-hours", "24",
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", authorityPolicyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityWritten.inventorySha256,
      "--authority-max-age-hours", "24",
      "--archive-root", archiveRoot,
      "--retention-days", "365",
      "--archive-max-age-hours", "24",
      "--lock-file", join(stateDir, "publication.lock"),
      "--max-events", "100",
      "--batch-size", "2",
      "--acknowledge-read-only-scan",
      "--acknowledge-external-retention-target"
    ], {
      clock: () => t1,
      connect: async () => {
        connected = true;
        throw new Error("database should not be reached");
      }
    }), error => error?.code === "CHECKPOINT_PUBLICATION_SIGNER_NOT_ACTIVE");
    assert.equal(connected, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("existing lock blocks CLI before the database and is not auto-removed", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-publication-existing-lock-"));
  try {
    chmodSync(root, 0o700);
    const archiveRoot = join(root, "archive");
    const trustDir = join(root, "trust");
    const stateDir = join(root, "state");
    mkdirSync(archiveRoot, { mode: 0o700 });
    mkdirSync(trustDir, { mode: 0o700 });
    mkdirSync(stateDir, { mode: 0o700 });
    const signerPrivate = join(root, "signer-private.pem");
    const authorityDir = join(root, "authority-inventory");
    const authorityPolicyPath = join(root, "authority-policy.json");
    const lockFile = join(stateDir, "publication.lock");
    writeFileSync(signerPrivate, signer1.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(signerPrivate, 0o600);
    mkdirSync(authorityDir, { mode: 0o700 });
    writeFileSync(authorityPolicyPath, encodeGovernanceApprovalPolicy(approvalPolicy), { mode: 0o600 });
    const authorityInventory = initialAuthority();
    const authorityWritten = writeAuthorityTrustInventoryGeneration(authorityDir, authorityInventory);
    const trust = initialTrust();
    const written = writeSignerTrustInventoryGeneration(trustDir, trust);
    writeFileSync(lockFile, "stale-or-running\n", { mode: 0o600 });

    let connected = false;
    await assert.rejects(runAuditCheckpointPublicationCli([
      "run",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--signer-private-key-file", signerPrivate,
      "--trust-inventory-dir", trustDir,
      "--expected-trust-sha256", written.inventorySha256,
      "--trust-max-age-hours", "24",
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", authorityPolicyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityWritten.inventorySha256,
      "--authority-max-age-hours", "24",
      "--archive-root", archiveRoot,
      "--retention-days", "365",
      "--archive-max-age-hours", "24",
      "--lock-file", lockFile,
      "--acknowledge-read-only-scan",
      "--acknowledge-external-retention-target"
    ], {
      clock: () => t0,
      connect: async () => { connected = true; return harness().client; }
    }), error => error?.code === "CHECKPOINT_PUBLICATION_LOCKED");
    assert.equal(connected, false);
    assert.equal(existsSync(lockFile), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
