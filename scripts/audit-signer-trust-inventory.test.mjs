import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointKeyId } from "./audit-checkpoint.mjs";
import {
  createInitialSignerTrustInventory,
  encodeSignerTrustInventory,
  parseSignerTrustInventory,
  readSignerTrustInventoryChain,
  resolveCheckpointSigner,
  revokeSignerTrustInventory,
  rotateSignerTrustInventory,
  runSignerTrustInventoryCli,
  verifySignerTrustInventoryChain,
  writeSignerTrustInventoryGeneration
} from "./audit-signer-trust-inventory.mjs";
import {
  approveGovernanceProposal,
  createGovernanceApprovalPolicy,
  createGovernanceProposal,
  encodeGovernanceApprovalBundle,
  encodeGovernanceApprovalPolicy,
  governanceApprovalPolicySha256
} from "./audit-governance-approval.mjs";
import {
  createInitialAuthorityTrustInventory,
  rotateAuthorityTrustInventory,
  writeAuthorityTrustInventoryGeneration
} from "./audit-trust-authority-inventory.mjs";

const tenantId = "trust-ci-tenant";
const deploymentId = "trust-ci-deployment";
const context = { tenantId, deploymentId };
const authority = generateKeyPairSync("ed25519");
const otherAuthority = generateKeyPairSync("ed25519");
const signer1 = generateKeyPairSync("ed25519");
const signer2 = generateKeyPairSync("ed25519");
const signer3 = generateKeyPairSync("ed25519");
const approver1 = generateKeyPairSync("ed25519");
const approver2 = generateKeyPairSync("ed25519");
const t0 = Date.parse("2026-10-26T06:00:00.000Z");
const t1 = t0 + 60_000;
const t2 = t1 + 60_000;

const sha = value => createHash("sha256").update(encodeSignerTrustInventory(value)).digest("hex");
const code = expected => error => error?.code === expected;
const approvalPolicy = createGovernanceApprovalPolicy({
  approverPublicKeys: [approver1.publicKey, approver2.publicKey],
  minApprovals: 2,
  ...context,
  issuedAt: t0 - 60_000,
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
  bundle = approveGovernanceProposal(bundle, approver1.privateKey, now + 1_000);
  bundle = approveGovernanceProposal(bundle, approver2.privateKey, now + 2_000);
  return bundle;
}

function initial(now = t0) {
  return createInitialSignerTrustInventory(authority.privateKey, signer1.publicKey, context, now);
}
function rotated(now = t1) {
  return rotateSignerTrustInventory(initial(), authority.privateKey, signer2.publicKey, context, now);
}

test("initial inventory is canonical, signed by a separate authority and exposes only public signer material", () => {
  const value = initial();
  const encoded = encodeSignerTrustInventory(value);
  assert.deepEqual(parseSignerTrustInventory(encoded), value);
  assert.equal(value.manifest.generation, 1);
  assert.equal(value.manifest.previousInventorySha256, null);
  assert.equal(value.manifest.signingKeys.length, 1);
  assert.equal(value.manifest.signingKeys[0].status, "ACTIVE");
  assert.equal(value.manifest.signingKeys[0].keyId, checkpointKeyId(signer1.publicKey));
  assert.notEqual(value.manifest.authorityKeyId, value.manifest.signingKeys[0].keyId);
  for (const secret of [tenantId, deploymentId, "PRIVATE KEY"]) assert.ok(!encoded.includes(secret));
});

test("rotation retires exactly one signer, enrolls a distinct active key and chains the previous digest", () => {
  const first = initial();
  const second = rotateSignerTrustInventory(first, authority.privateKey, signer2.publicKey, context, t1);
  assert.equal(second.manifest.generation, 2);
  assert.equal(second.manifest.previousInventorySha256, sha(first));
  assert.equal(second.manifest.signingKeys.filter(k => k.status === "ACTIVE").length, 1);
  const old = second.manifest.signingKeys.find(k => k.keyId === checkpointKeyId(signer1.publicKey));
  const fresh = second.manifest.signingKeys.find(k => k.keyId === checkpointKeyId(signer2.publicKey));
  assert.equal(old.status, "RETIRED");
  assert.equal(old.validUntil, new Date(t1).toISOString());
  assert.equal(old.retiredAt, new Date(t1).toISOString());
  assert.equal(fresh.status, "ACTIVE");
  assert.equal(fresh.validFrom, new Date(t1).toISOString());
});

test("historical signer resolution honors the rotation validity boundary", () => {
  const second = rotated();
  assert.equal(
    checkpointKeyId(resolveCheckpointSigner(second, {
      keyId: checkpointKeyId(signer1.publicKey),
      issuedAt: new Date(t0 + 30_000).toISOString()
    })),
    checkpointKeyId(signer1.publicKey)
  );
  assert.throws(() => resolveCheckpointSigner(second, {
    keyId: checkpointKeyId(signer1.publicKey),
    issuedAt: new Date(t1).toISOString()
  }), code("TRUST_INVENTORY_SIGNER_OUTSIDE_VALIDITY"));
  assert.equal(
    checkpointKeyId(resolveCheckpointSigner(second, {
      keyId: checkpointKeyId(signer2.publicKey),
      issuedAt: new Date(t1).toISOString()
    })),
    checkpointKeyId(signer2.publicKey)
  );
});

test("revocation remains fail-closed even for a previously valid historical signer", () => {
  const second = rotated();
  const revoked = revokeSignerTrustInventory(
    second, authority.privateKey, checkpointKeyId(signer1.publicKey), context, t2
  );
  const entry = revoked.manifest.signingKeys.find(k => k.keyId === checkpointKeyId(signer1.publicKey));
  assert.equal(entry.status, "REVOKED");
  assert.equal(entry.revokedAt, new Date(t2).toISOString());
  assert.throws(() => resolveCheckpointSigner(revoked, {
    keyId: checkpointKeyId(signer1.publicKey),
    issuedAt: new Date(t0 + 30_000).toISOString()
  }), code("TRUST_INVENTORY_SIGNER_REVOKED"));
});

test("emergency revocation of the active signer leaves no implicit fallback signer", () => {
  const first = initial();
  const revoked = revokeSignerTrustInventory(
    first, authority.privateKey, checkpointKeyId(signer1.publicKey), context, t1
  );
  assert.equal(revoked.manifest.signingKeys.filter(k => k.status === "ACTIVE").length, 0);
  assert.throws(() => resolveCheckpointSigner(revoked, {
    keyId: checkpointKeyId(signer1.publicKey),
    issuedAt: new Date(t0 + 30_000).toISOString()
  }), code("TRUST_INVENTORY_SIGNER_REVOKED"));
});

test("authority signature, subject and externally pinned latest digest all fail closed", () => {
  const first = initial();
  const chain = [first];
  assert.throws(() => verifySignerTrustInventoryChain(chain, {
    ...context,
    authorityPublicKey: otherAuthority.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0
  }));
  assert.throws(() => verifySignerTrustInventoryChain(chain, {
    tenantId: "other-tenant",
    deploymentId,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0
  }));
  assert.throws(() => verifySignerTrustInventoryChain(chain, {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: "0".repeat(64),
    maxAgeMs: 3600_000,
    now: t0
  }), code("TRUST_INVENTORY_DIGEST_MISMATCH"));
});

test("chain rewrite, rollback and generation gaps cannot satisfy the latest pinned digest", () => {
  const first = initial();
  const second = rotateSignerTrustInventory(first, authority.privateKey, signer2.publicKey, context, t1);
  const third = rotateSignerTrustInventory(second, authority.privateKey, signer3.publicKey, context, t2);
  const accepted = verifySignerTrustInventoryChain([first, second, third], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  });
  assert.equal(accepted.latest.manifest.generation, 3);
  assert.throws(() => verifySignerTrustInventoryChain([first, second], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  }), code("TRUST_INVENTORY_DIGEST_MISMATCH"));

  const rewritten = structuredClone(second);
  rewritten.manifest.previousInventorySha256 = "a".repeat(64);
  assert.throws(() => verifySignerTrustInventoryChain([first, rewritten], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(rewritten),
    maxAgeMs: 3600_000,
    now: t2
  }));
  assert.throws(() => verifySignerTrustInventoryChain([first, third], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  }), code("TRUST_INVENTORY_CHAIN_INVALID"));
});

test("future and stale latest inventory timestamps are rejected by verifier policy", () => {
  const first = initial(t0);
  assert.throws(() => verifySignerTrustInventoryChain([first], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0 - 60_000
  }), code("TRUST_INVENTORY_FUTURE"));
  assert.throws(() => verifySignerTrustInventoryChain([first], {
    ...context,
    authorityPublicKey: authority.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0 + 2 * 3600_000
  }), code("TRUST_INVENTORY_STALE"));
});

test("generation files are append-only and unsafe trust directories are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-trust-inventory-"));
  try {
    chmodSync(root, 0o700);
    const first = initial();
    const written = writeSignerTrustInventoryGeneration(root, first);
    assert.equal(written.generation, 1);
    assert.equal(written.inventorySha256, sha(first));
    assert.deepEqual(readSignerTrustInventoryChain(root), [first]);
    assert.throws(() => writeSignerTrustInventoryGeneration(root, first),
      code("TRUST_INVENTORY_GENERATION_EXISTS"));

    const unsafe = join(root, "unsafe");
    mkdirSync(unsafe, { mode: 0o777 });
    chmodSync(unsafe, 0o777);
    assert.throws(() => writeSignerTrustInventoryGeneration(unsafe, first),
      code("TRUST_INVENTORY_DIRECTORY_UNSAFE"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing generation files are detected instead of silently renumbered", () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-trust-gap-"));
  try {
    chmodSync(root, 0o700);
    const first = initial();
    const second = rotateSignerTrustInventory(first, authority.privateKey, signer2.publicKey, context, t1);
    writeSignerTrustInventoryGeneration(root, first);
    writeFileSync(join(root, "inventory-000003.json"), encodeSignerTrustInventory(second), { mode: 0o600 });
    assert.throws(() => readSignerTrustInventoryChain(root), code("TRUST_INVENTORY_GENERATION_GAP"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("offline CLI survives authority rotation while enforcing dual control and pinned digests", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-trust-cli-"));
  try {
    chmodSync(root, 0o700);
    const inventoryDir = join(root, "inventory");
    const authorityDir = join(root, "authority-inventory");
    mkdirSync(inventoryDir, { mode: 0o700 });
    mkdirSync(authorityDir, { mode: 0o700 });
    const authorityPrivate = join(root, "authority-private.pem");
    const rotatedAuthorityPrivate = join(root, "authority-rotated-private.pem");
    const authorityPublic = join(root, "authority-public.pem");
    const signer1Public = join(root, "signer1-public.pem");
    const signer2Public = join(root, "signer2-public.pem");
    const policyPath = join(root, "approval-policy.json");
    const initApprovalPath = join(root, "init-approval.json");
    const rotateApprovalPath = join(root, "rotate-approval.json");

    writeFileSync(authorityPrivate, authority.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(authorityPrivate, 0o600);
    writeFileSync(rotatedAuthorityPrivate, otherAuthority.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(rotatedAuthorityPrivate, 0o600);
    writeFileSync(authorityPublic, authority.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    writeFileSync(signer1Public, signer1.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    writeFileSync(signer2Public, signer2.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    writeFileSync(policyPath, encodeGovernanceApprovalPolicy(approvalPolicy), { mode: 0o600 });

    const authorityStartedAt = t0 - 30_000;
    const authorityInitial = createInitialAuthorityTrustInventory(
      authority.publicKey,
      approvalPolicy,
      approvals("INIT_AUTHORITY", 0, null, checkpointKeyId(authority.publicKey), authorityStartedAt),
      context,
      { expectedPolicySha256: approvalPolicySha, now: authorityStartedAt }
    );
    const authorityGen1 = writeAuthorityTrustInventoryGeneration(authorityDir, authorityInitial);

    writeFileSync(initApprovalPath, encodeGovernanceApprovalBundle(
      approvals("INIT_SIGNER", 0, null, checkpointKeyId(signer1.publicKey), t0)
    ), { mode: 0o600 });

    const initResult = await runSignerTrustInventoryCli([
      "init",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--inventory-dir", inventoryDir,
      "--authority-private-key-file", authorityPrivate,
      "--signer-public-key-file", signer1Public,
      "--approval-bundle", initApprovalPath,
      "--approval-policy", policyPath,
      "--expected-approval-policy-sha256", approvalPolicySha,
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityGen1.inventorySha256,
      "--authority-max-age-hours", "24",
      "--acknowledge-separate-trust-authority"
    ], () => t0);
    assert.equal(initResult.code, "TRUST_INVENTORY_INITIALIZED");

    const authorityRotated = rotateAuthorityTrustInventory(
      authorityInitial,
      otherAuthority.publicKey,
      approvalPolicy,
      approvals(
        "ROTATE_AUTHORITY",
        1,
        authorityGen1.inventorySha256,
        checkpointKeyId(otherAuthority.publicKey),
        t1 - 10_000
      ),
      context,
      {
        expectedPolicySha256: approvalPolicySha,
        expectedCurrentSha256: authorityGen1.inventorySha256,
        now: t1 - 10_000
      }
    );
    const authorityGen2 = writeAuthorityTrustInventoryGeneration(authorityDir, authorityRotated);

    writeFileSync(rotateApprovalPath, encodeGovernanceApprovalBundle(
      approvals("ROTATE_SIGNER", 1, initResult.latestSha256, checkpointKeyId(signer2.publicKey), t1)
    ), { mode: 0o600 });

    await assert.rejects(runSignerTrustInventoryCli([
      "rotate",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--inventory-dir", inventoryDir,
      "--authority-private-key-file", rotatedAuthorityPrivate,
      "--signer-public-key-file", signer2Public,
      "--expected-current-sha256", "0".repeat(64),
      "--approval-bundle", rotateApprovalPath,
      "--approval-policy", policyPath,
      "--expected-approval-policy-sha256", approvalPolicySha,
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityGen2.inventorySha256,
      "--authority-max-age-hours", "24",
      "--acknowledge-separate-trust-authority"
    ], () => t1), code("TRUST_INVENTORY_DIGEST_MISMATCH"));

    const rotateResult = await runSignerTrustInventoryCli([
      "rotate",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--inventory-dir", inventoryDir,
      "--authority-private-key-file", rotatedAuthorityPrivate,
      "--signer-public-key-file", signer2Public,
      "--expected-current-sha256", initResult.latestSha256,
      "--approval-bundle", rotateApprovalPath,
      "--approval-policy", policyPath,
      "--expected-approval-policy-sha256", approvalPolicySha,
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityGen2.inventorySha256,
      "--authority-max-age-hours", "24",
      "--acknowledge-separate-trust-authority"
    ], () => t1);
    assert.equal(rotateResult.code, "TRUST_INVENTORY_ROTATED");
    assert.equal(rotateResult.activeKeyId, checkpointKeyId(signer2.publicKey));

    const verifyResult = await runSignerTrustInventoryCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--inventory-dir", inventoryDir,
      "--expected-latest-sha256", rotateResult.latestSha256,
      "--max-age-hours", "24",
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityGen2.inventorySha256,
      "--authority-max-age-hours", "24"
    ], () => t2);
    assert.equal(verifyResult.code, "TRUST_INVENTORY_VALID");
    assert.equal(verifyResult.generation, 2);
    assert.equal(verifyResult.activeKeyId, checkpointKeyId(signer2.publicKey));
    assert.equal(verifyResult.authorityGeneration, 2);
    assert.equal(verifyResult.authorityInventorySha256, authorityGen2.inventorySha256);
    assert.ok(!JSON.stringify(verifyResult).includes(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI does not accept a signer private key as an enrollment source", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-trust-private-source-"));
  try {
    chmodSync(root, 0o700);
    const inventoryDir = join(root, "inventory");
    const authorityDir = join(root, "authority-inventory");
    mkdirSync(inventoryDir, { mode: 0o700 });
    mkdirSync(authorityDir, { mode: 0o700 });
    const authorityPrivate = join(root, "authority-private.pem");
    const signerPrivate = join(root, "signer-private.pem");
    const policyPath = join(root, "approval-policy.json");
    const approvalPath = join(root, "init-approval.json");
    writeFileSync(authorityPrivate, authority.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(authorityPrivate, 0o600);
    writeFileSync(signerPrivate, signer1.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(signerPrivate, 0o600);
    writeFileSync(policyPath, encodeGovernanceApprovalPolicy(approvalPolicy), { mode: 0o600 });
    const authorityInitial = createInitialAuthorityTrustInventory(
      authority.publicKey,
      approvalPolicy,
      approvals("INIT_AUTHORITY", 0, null, checkpointKeyId(authority.publicKey), t0 - 30_000),
      context,
      { expectedPolicySha256: approvalPolicySha, now: t0 - 30_000 }
    );
    const authorityWritten = writeAuthorityTrustInventoryGeneration(authorityDir, authorityInitial);
    writeFileSync(approvalPath, encodeGovernanceApprovalBundle(
      approvals("INIT_SIGNER", 0, null, checkpointKeyId(signer1.publicKey), t0)
    ), { mode: 0o600 });
    await assert.rejects(runSignerTrustInventoryCli([
      "init",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--inventory-dir", inventoryDir,
      "--authority-private-key-file", authorityPrivate,
      "--signer-public-key-file", signerPrivate,
      "--approval-bundle", approvalPath,
      "--approval-policy", policyPath,
      "--expected-approval-policy-sha256", approvalPolicySha,
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityWritten.inventorySha256,
      "--authority-max-age-hours", "24",
      "--acknowledge-separate-trust-authority"
    ], () => t0), code("TRUST_INVENTORY_KEY_INVALID"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
