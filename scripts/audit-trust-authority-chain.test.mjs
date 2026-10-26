import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointKeyId } from "./audit-checkpoint.mjs";
import {
  createInitialTrustAuthorityRecord,
  encodeTrustAuthorityRecord,
  parseTrustAuthorityRecord,
  readTrustAuthorityChain,
  recoverTrustAuthorityRecord,
  resolveTrustAuthority,
  rotateTrustAuthorityRecord,
  runTrustAuthorityCli,
  verifyTrustAuthorityChain,
  writeTrustAuthorityRecord
} from "./audit-trust-authority-chain.mjs";

const tenantId = "authority-ci-tenant";
const deploymentId = "authority-ci-deployment";
const context = { tenantId, deploymentId };
const root = generateKeyPairSync("ed25519");
const recovery = generateKeyPairSync("ed25519");
const authority2 = generateKeyPairSync("ed25519");
const authority3 = generateKeyPairSync("ed25519");
const outsider = generateKeyPairSync("ed25519");
const t0 = Date.parse("2026-10-26T08:00:00.000Z");
const t1 = t0 + 60_000;
const t2 = t1 + 60_000;

const sha = value => createHash("sha256").update(encodeTrustAuthorityRecord(value)).digest("hex");
const code = expected => error => error?.code === expected;

function initial(now = t0) {
  return createInitialTrustAuthorityRecord(root.privateKey, recovery.publicKey, context, now);
}
function rotated(now = t1) {
  return rotateTrustAuthorityRecord(initial(), root.privateKey, authority2.privateKey, context, now);
}

test("bootstrap is canonical, self-signed by externally pinned root and binds a separate recovery key", () => {
  const value = initial();
  const text = encodeTrustAuthorityRecord(value);
  assert.deepEqual(parseTrustAuthorityRecord(text), value);
  assert.equal(value.payload.generation, 1);
  assert.equal(value.payload.transitionMode, "BOOTSTRAP");
  assert.equal(value.payload.previousRecordSha256, null);
  assert.equal(value.payload.authorityKeyId, checkpointKeyId(root.publicKey));
  assert.equal(value.payload.recoveryKeyId, checkpointKeyId(recovery.publicKey));
  assert.notEqual(value.payload.authorityKeyId, value.payload.recoveryKeyId);

  const verified = verifyTrustAuthorityChain([value], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(value),
    maxAgeMs: 3600_000,
    now: t0
  });
  assert.equal(verified.latest.payload.authorityKeyId, checkpointKeyId(root.publicKey));
  assert.equal(checkpointKeyId(verified.latestAuthorityPublicKey), checkpointKeyId(root.publicKey));
});

test("bootstrap rejects using the same key for authority and recovery", () => {
  assert.throws(
    () => createInitialTrustAuthorityRecord(root.privateKey, root.publicKey, context, t0),
    code("AUTHORITY_CHAIN_RECOVERY_NOT_SEPARATE")
  );
});

test("planned rotation requires old and new authority signatures and advances the digest chain", () => {
  const first = initial();
  const second = rotateTrustAuthorityRecord(first, root.privateKey, authority2.privateKey, context, t1);
  assert.equal(second.payload.transitionMode, "ROTATION");
  assert.equal(second.payload.generation, 2);
  assert.equal(second.payload.previousRecordSha256, sha(first));
  assert.equal(second.payload.previousAuthorityKeyId, checkpointKeyId(root.publicKey));
  assert.equal(second.payload.authorityKeyId, checkpointKeyId(authority2.publicKey));
  assert.ok(second.signatures.previousAuthority);
  assert.ok(second.signatures.authority);
  assert.equal(second.signatures.recovery, null);

  const verified = verifyTrustAuthorityChain([first, second], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(second),
    maxAgeMs: 3600_000,
    now: t1
  });
  assert.equal(checkpointKeyId(verified.latestAuthorityPublicKey), checkpointKeyId(authority2.publicKey));
});

test("recovery transition works without the previous authority private key but requires recovery + new signatures", () => {
  const first = initial();
  const recovered = recoverTrustAuthorityRecord(
    first, recovery.privateKey, authority2.privateKey, context, t1
  );
  assert.equal(recovered.payload.transitionMode, "RECOVERY");
  assert.equal(recovered.signatures.previousAuthority, null);
  assert.ok(recovered.signatures.recovery);
  assert.ok(recovered.signatures.authority);

  const verified = verifyTrustAuthorityChain([first, recovered], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(recovered),
    maxAgeMs: 3600_000,
    now: t1
  });
  assert.equal(checkpointKeyId(verified.latestAuthorityPublicKey), checkpointKeyId(authority2.publicKey));
});

test("wrong recovery key and wrong previous authority key cannot authorize a transition", () => {
  const first = initial();
  assert.throws(
    () => recoverTrustAuthorityRecord(first, outsider.privateKey, authority2.privateKey, context, t1),
    code("AUTHORITY_CHAIN_RECOVERY_KEY_MISMATCH")
  );
  assert.throws(
    () => rotateTrustAuthorityRecord(first, outsider.privateKey, authority2.privateKey, context, t1),
    code("AUTHORITY_CHAIN_PREVIOUS_KEY_MISMATCH")
  );
});

test("transition is bound to the deployment/tenant subject", () => {
  const first = initial();
  assert.throws(
    () => rotateTrustAuthorityRecord(
      first, root.privateKey, authority2.privateKey,
      { tenantId: "other-tenant", deploymentId }, t1
    ),
    code("AUTHORITY_CHAIN_SUBJECT_MISMATCH")
  );
});

test("historical authority resolution switches exactly at the effective transition time", () => {
  const first = initial();
  const second = rotateTrustAuthorityRecord(first, root.privateKey, authority2.privateKey, context, t1);
  const chain = verifyTrustAuthorityChain([first, second], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(second),
    maxAgeMs: 3600_000,
    now: t1
  });

  assert.equal(
    checkpointKeyId(resolveTrustAuthority(
      chain, new Date(t0 + 30_000).toISOString(), checkpointKeyId(root.publicKey)
    )),
    checkpointKeyId(root.publicKey)
  );
  assert.equal(
    checkpointKeyId(resolveTrustAuthority(
      chain, new Date(t1).toISOString(), checkpointKeyId(authority2.publicKey)
    )),
    checkpointKeyId(authority2.publicKey)
  );
  assert.throws(() => resolveTrustAuthority(
    chain, new Date(t1).toISOString(), checkpointKeyId(root.publicKey)
  ), code("AUTHORITY_CHAIN_AUTHORITY_ID_MISMATCH"));
});

test("tampered old/new/recovery signatures are detected", () => {
  const first = initial();
  const second = rotateTrustAuthorityRecord(first, root.privateKey, authority2.privateKey, context, t1);

  for (const field of ["authority", "previousAuthority"]) {
    const changed = structuredClone(second);
    changed.signatures[field] = Buffer.alloc(64, field === "authority" ? 1 : 2).toString("base64");
    assert.throws(() => verifyTrustAuthorityChain([first, changed], {
      ...context,
      bootstrapAuthorityPublicKey: root.publicKey,
      expectedLatestSha256: sha(changed),
      maxAgeMs: 3600_000,
      now: t1
    }));
  }

  const recovered = recoverTrustAuthorityRecord(first, recovery.privateKey, authority2.privateKey, context, t1);
  const changedRecovery = structuredClone(recovered);
  changedRecovery.signatures.recovery = Buffer.alloc(64, 3).toString("base64");
  assert.throws(() => verifyTrustAuthorityChain([first, changedRecovery], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(changedRecovery),
    maxAgeMs: 3600_000,
    now: t1
  }), code("AUTHORITY_CHAIN_RECOVERY_SIGNATURE_INVALID"));
});

test("wrong bootstrap root, latest digest rollback and generation gaps fail closed", () => {
  const first = initial();
  const second = rotateTrustAuthorityRecord(first, root.privateKey, authority2.privateKey, context, t1);
  const third = rotateTrustAuthorityRecord(second, authority2.privateKey, authority3.privateKey, context, t2);

  assert.throws(() => verifyTrustAuthorityChain([first, second, third], {
    ...context,
    bootstrapAuthorityPublicKey: outsider.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  }), code("AUTHORITY_CHAIN_BOOTSTRAP_MISMATCH"));

  assert.throws(() => verifyTrustAuthorityChain([first, second], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  }), code("AUTHORITY_CHAIN_DIGEST_MISMATCH"));

  assert.throws(() => verifyTrustAuthorityChain([first, third], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(third),
    maxAgeMs: 3600_000,
    now: t2
  }), code("AUTHORITY_CHAIN_GENERATION_GAP"));
});

test("future and stale latest authority records are rejected by external verifier policy", () => {
  const first = initial();
  assert.throws(() => verifyTrustAuthorityChain([first], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0 - 60_000
  }), code("AUTHORITY_CHAIN_FUTURE"));

  assert.throws(() => verifyTrustAuthorityChain([first], {
    ...context,
    bootstrapAuthorityPublicKey: root.publicKey,
    expectedLatestSha256: sha(first),
    maxAgeMs: 3600_000,
    now: t0 + 2 * 3600_000
  }), code("AUTHORITY_CHAIN_STALE"));
});

test("authority generation files are no-overwrite and unsafe directories fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "hrbp-authority-chain-"));
  try {
    chmodSync(dir, 0o700);
    const first = initial();
    const written = writeTrustAuthorityRecord(dir, first);
    assert.equal(written.generation, 1);
    assert.equal(written.recordSha256, sha(first));
    assert.deepEqual(readTrustAuthorityChain(dir), [first]);
    assert.throws(() => writeTrustAuthorityRecord(dir, first),
      code("AUTHORITY_CHAIN_RECORD_EXISTS"));

    const unsafe = join(dir, "unsafe");
    mkdirSync(unsafe, { mode: 0o777 });
    chmodSync(unsafe, 0o777);
    assert.throws(() => writeTrustAuthorityRecord(unsafe, first),
      code("AUTHORITY_CHAIN_DIRECTORY_UNSAFE"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI rotation verifies the full pinned chain before writing a transition", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hrbp-authority-cli-"));
  try {
    chmodSync(dir, 0o700);
    const chainDir = join(dir, "chain");
    mkdirSync(chainDir, { mode: 0o700 });

    const rootPrivate = join(dir, "root-private.pem");
    const rootPublic = join(dir, "root-public.pem");
    const recoveryPublic = join(dir, "recovery-public.pem");
    const nextPrivate = join(dir, "next-private.pem");

    writeFileSync(rootPrivate, root.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(rootPrivate, 0o600);
    writeFileSync(rootPublic, root.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    writeFileSync(recoveryPublic, recovery.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    writeFileSync(nextPrivate, authority2.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(nextPrivate, 0o600);

    const initResult = await runTrustAuthorityCli([
      "init",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--chain-dir", chainDir,
      "--authority-private-key-file", rootPrivate,
      "--recovery-public-key-file", recoveryPublic,
      "--acknowledge-independent-authority-governance"
    ], () => t0);
    assert.equal(initResult.code, "AUTHORITY_CHAIN_INITIALIZED");

    await assert.rejects(runTrustAuthorityCli([
      "rotate",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--chain-dir", chainDir,
      "--bootstrap-authority-public-key-file", rootPublic,
      "--current-authority-private-key-file", rootPrivate,
      "--next-authority-private-key-file", nextPrivate,
      "--expected-current-sha256", "0".repeat(64),
      "--max-age-hours", "24",
      "--acknowledge-independent-authority-governance"
    ], () => t1), code("AUTHORITY_CHAIN_DIGEST_MISMATCH"));

    const rotateResult = await runTrustAuthorityCli([
      "rotate",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--chain-dir", chainDir,
      "--bootstrap-authority-public-key-file", rootPublic,
      "--current-authority-private-key-file", rootPrivate,
      "--next-authority-private-key-file", nextPrivate,
      "--expected-current-sha256", initResult.latestSha256,
      "--max-age-hours", "24",
      "--acknowledge-independent-authority-governance"
    ], () => t1);
    assert.equal(rotateResult.code, "AUTHORITY_CHAIN_ROTATED");
    assert.equal(rotateResult.authorityKeyId, checkpointKeyId(authority2.publicKey));

    const verifyResult = await runTrustAuthorityCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--chain-dir", chainDir,
      "--bootstrap-authority-public-key-file", rootPublic,
      "--expected-latest-sha256", rotateResult.latestSha256,
      "--max-age-hours", "24"
    ], () => t2);
    assert.equal(verifyResult.code, "AUTHORITY_CHAIN_VALID");
    assert.equal(verifyResult.generation, 2);
    assert.equal(verifyResult.authorityKeyId, checkpointKeyId(authority2.publicKey));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
