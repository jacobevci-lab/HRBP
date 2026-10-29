import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { normalizeS3Readback } from "./audit-pilot-s3-readback.mjs";

const PROFILE = "HRBP_PILOT_CURRENT_TRUST_V1";
const RETENTION = "AWS_S3_OBJECT_LOCK_COMPLIANCE_V1";
const COLLECTION = "AWS_S3_COLLECTION_PROVENANCE_V1";
const ROLES = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
const OPS = ["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"];
const GATES = Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(JSON.stringify(value) + "\n");
const cli = fileURLToPath(new URL("./audit-pilot-evidence.mjs", import.meta.url));
const trustNames = ["requiredTrustStateProfile", "trustStatePath", "expectedTrustStateSha256", "minimumTrustSequence"];
function fixture(t, version = 1) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-current-trust-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now(), at = delta => new Date(now + delta).toISOString();
  const keys = ROLES.map(() => generateKeyPairSync("ed25519"));
  const keyIds = keys.map(k => hash(k.publicKey.export({ type: "spki", format: "der" })));
  const dir = join(root, "artifacts"); mkdirSync(dir);
  const files = new Map([...GATES, ...ROLES].map(name => [`${name}.bin`, Buffer.from(`fixture:${name}:\0\xff`)]));
  const archive = files.get("G05.bin");
  const requirements = { profile: RETENTION, bucket: "synthetic-trust-vault", key: "audit/archive.bin",
    versionId: "version-test-01", expectedBucketOwner: "123456789012", archiveSha256: hash(archive),
    archiveSizeBytes: archive.length, minRetentionUntilUtc: at(365 * 86400_000), maxObservationAgeSeconds: 3600, legalHoldRequired: true };
  if (version >= 2) {
    const request = { schemaVersion: 1, scope: "HRBP_S3_READ_COLLECTION:1", region: "eu-central-1", requirements };
    const raw = [ { Status: "Enabled" }, { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } },
      { VersionId: requirements.versionId, ContentLength: archive.length,
        ChecksumSHA256: createHash("sha256").update(archive).digest("base64"), ChecksumType: "FULL_OBJECT",
        ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: requirements.minRetentionUntilUtc, ObjectLockLegalHoldStatus: "ON" },
      { Retention: { Mode: "COMPLIANCE", RetainUntilDate: requirements.minRetentionUntilUtc } }, { LegalHold: { Status: "ON" } } ];
    const observation = { schemaVersion: 1, scope: "HRBP_AWS_S3_OBJECT_LOCK_READBACK:1" }, operations = [];
    files.set("collection-request.json", encoded(request));
    OPS.forEach((operation, index) => {
      const input = { Bucket: requirements.bucket, ExpectedBucketOwner: requirements.expectedBucketOwner };
      if (index > 1) { input.Key = requirements.key; input.VersionId = requirements.versionId; }
      if (index === 2) input.ChecksumMode = "ENABLED";
      const rawFile = `${operation}.raw.json`, bytes = Buffer.from(JSON.stringify(raw[index], null, 2) + "\n");
      files.set(rawFile, bytes);
      const finishedAtUtc = at(-99_000 + index * 2000);
      observation[operation] = { observedAtUtc: finishedAtUtc, request: input, response: normalizeS3Readback(operation, raw[index]) };
      operations.push({ operation, startedAtUtc: at(-100_000 + index * 2000), finishedAtUtc, rawSha256: hash(bytes), rawFile });
    });
    files.set("G04.bin", encoded(observation));
    const names = ["collection-request.json", "G05.bin", ...OPS.map(op => `${op}.raw.json`), "G04.bin"];
    files.set("collection-manifest.json", encoded({ schemaVersion: 1, scope: "HRBP_S3_COLLECTION_PROVENANCE:1",
      status: "COLLECTED_NOT_AUTHORIZED", requestSha256: hash(files.get("collection-request.json")),
      region: request.region, endpoint: "https://s3.eu-central-1.amazonaws.com", awsCliVersion: "aws-cli/2.38.0 synthetic",
      startedAtUtc: at(-100_000), finishedAtUtc: at(-90_000), operations,
      files: names.map(name => ({ name, sha256: hash(files.get(name)), bytes: files.get(name).length })),
      providerAttestationVerified: false, lockEnforcementTested: false }));
  }
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes, { mode: 0o600 });
  const packet = { schemaVersion: 1, customerReference: "synthetic-customer-01", sourceCommitSha: "a".repeat(40),
    deployedWorkerVersionId: "worker-synthetic-01", decisionAtUtc: at(-40_000), nextReviewAtUtc: at(86400_000),
    approvedRetentionUntilUtc: requirements.minRetentionUntilUtc,
    evidence: GATES.map(gate => ({ gate, status: "PASS", sha256: hash(files.get(`${gate}.bin`)),
      controlledLocator: "controlled-ref-01", reviewerRole: "AUDIT_REVIEWER", reviewerReference: "reviewer-audit-01",
      reviewedAtUtc: at(-60_000), evidenceType: gate === "G01" ? "DEPLOYED_REVISION_READBACK" :
        gate === "G03" ? "APPROVED_TSA_RFC3161" : gate === "G04" ? "INDEPENDENT_PROVIDER_LOCK_READBACK" : "CONTROLLED_EVIDENCE" })),
    customerSecurityApproval: { reviewerRole: ROLES[0], reviewerReference: "reviewer-security-01", approvedAtUtc: at(-50_000), evidenceSha256: hash(files.get(`${ROLES[0]}.bin`)) },
    recordsLegalApproval: { reviewerRole: ROLES[1], reviewerReference: "reviewer-records-01", approvedAtUtc: at(-50_000), evidenceSha256: hash(files.get(`${ROLES[1]}.bin`)) } };
  const policy = { schemaVersion: version, scope: `HRBP_AUDIT_PILOT_TRUST:${version}`, packetSha256: hash(encoded(packet)),
    customerReference: packet.customerReference, sourceCommitSha: packet.sourceCommitSha, deployedWorkerVersionId: packet.deployedWorkerVersionId,
    validFromUtc: at(-86400_000), validUntilUtc: at(86400_000),
    approvers: ROLES.map((role, i) => ({ role, reviewerReference: i ? "reviewer-records-01" : "reviewer-security-01",
      publicKeyPem: keys[i].publicKey.export({ type: "spki", format: "pem" }).toString() })),
    ...(version >= 2 ? { retentionRequirements: requirements } : {}),
    ...(version === 3 ? { collectionRequirements: { profile: COLLECTION, manifestSha256: hash(files.get("collection-manifest.json")),
      requestSha256: hash(files.get("collection-request.json")) } } : {}) };
  const policySha = hash(encoded(policy));
  // Construct the signature domain independently, not with the production helper.
  const envelope = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1", packetSha256: policy.packetSha256,
    trustPolicySha256: policySha, signatures: policy.approvers.map((a, i) => ({ role: a.role, reviewerReference: a.reviewerReference,
      keyId: keyIds[i], signature: sign(null, Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" +
        JSON.stringify([policySha, policy.packetSha256, a.role, a.reviewerReference, keyIds[i]])), keys[i].privateKey).toString("base64") })) };
  const options = { packetPath: join(root, "packet.json"), policyPath: join(root, "policy.json"), expectedPolicySha256: policySha,
    signaturesPath: join(root, "signatures.json"), evidenceDir: dir, now, requiredTrustStateProfile: PROFILE,
    trustStatePath: join(root, "current-trust.json"), expectedTrustStateSha256: "", minimumTrustSequence: 7 };
  const state = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_CURRENT_TRUST:1", customerReference: packet.customerReference,
    sequence: 7, issuedAtUtc: at(-30_000), expiresAtUtc: at(3600_000),
    policies: [{ sha256: policySha, status: "ACTIVE", updatedAtUtc: at(-35_000) }],
    keys: keyIds.map(keyId => ({ keyId, status: "ACTIVE", updatedAtUtc: at(-86400_000) })) };
  writeFileSync(options.packetPath, encoded(packet)); writeFileSync(options.policyPath, encoded(policy));
  writeFileSync(options.signaturesPath, encoded(envelope));
  const fx = { root, now, at, files, packet, policy, envelope, state, options, keyIds };
  saveState(fx); return fx;
}
function saveState(fx, bytes = encoded(fx.state)) {
  writeFileSync(fx.options.trustStatePath, bytes, { mode: 0o600 });
  fx.options.expectedTrustStateSha256 = hash(bytes);
}
function check(fx) { return verifyPilotEvidence(fx.options); }
function reject(fx, code) {
  const result = check(fx);
  assert.equal(result.decision, "NO_GO", JSON.stringify(result));
  assert.deepEqual(result.reasons, [code]); assert.equal(result.verifiedArtifacts, 0);
  assert.equal(result.verifiedSignatures, 0); assert.equal(result.currentTrust, undefined);
}
function cliArgs(fx) {
  return ["--packet", fx.options.packetPath, "--trust-policy", fx.options.policyPath,
    "--expected-policy-sha256", fx.options.expectedPolicySha256, "--signatures", fx.options.signaturesPath,
    "--evidence-dir", fx.options.evidenceDir, "--require-trust-state-profile", PROFILE,
    "--trust-state", fx.options.trustStatePath, "--expected-trust-state-sha256", fx.options.expectedTrustStateSha256,
    "--minimum-trust-sequence", String(fx.options.minimumTrustSequence)];
}
for (const version of [1, 2, 3]) test(`current trust checks real v${version} dual signatures and artifacts without upgrading provider assurance`, t => {
  const fx = fixture(t, version), result = check(fx);
  assert.equal(result.decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  assert.equal(result.verifiedArtifacts, version === 3 ? 19 : 12);
  assert.deepEqual(result.currentTrust, { profile: PROFILE, sequence: 7, checkedPolicies: 1, checkedKeys: 2, liveRegistryVerified: false });
  if (version >= 2) assert.equal(result.retention.liveProviderVerified, false);
  if (version === 3) assert.equal(result.collection.providerAttestationVerified, false);
});
for (const target of ["policy", "security-key", "records-key"]) test(`a newly pinned ${target} revocation rejects unchanged valid historical signatures`, t => {
  const fx = fixture(t); assert.equal(check(fx).decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  const before = readFileSync(fx.options.signaturesPath);
  const entry = target === "policy" ? fx.state.policies[0] : fx.state.keys[target === "security-key" ? 0 : 1];
  entry.status = "REVOKED"; entry.updatedAtUtc = fx.state.issuedAtUtc; fx.state.sequence++;
  saveState(fx); fx.options.minimumTrustSequence++;
  reject(fx, target === "policy" ? "CURRENT_TRUST_POLICY_REVOKED" : "CURRENT_TRUST_KEY_REVOKED");
  assert.deepEqual(readFileSync(fx.options.signaturesPath), before);
});
test("unregistered policy and either unregistered key fail closed", t => {
  for (const target of ["policy", 0, 1]) {
    const fx = fixture(t);
    if (target === "policy") fx.state.policies[0].sha256 = "b".repeat(64); else fx.state.keys[target].keyId = "b".repeat(64);
    saveState(fx); reject(fx, target === "policy" ? "CURRENT_TRUST_POLICY_UNREGISTERED" : "CURRENT_TRUST_KEY_UNREGISTERED");
  }
});
test("old snapshot cannot replace the independently supplied current digest", t => {
  const fx = fixture(t), old = readFileSync(fx.options.trustStatePath);
  fx.state.sequence++; fx.state.keys[0].status = "REVOKED"; saveState(fx);
  writeFileSync(fx.options.trustStatePath, old); reject(fx, "CURRENT_TRUST_DIGEST_MISMATCH");
});
test("external sequence floor refuses rollback even when the old digest is supplied", t => {
  const fx = fixture(t); fx.options.minimumTrustSequence = 8; reject(fx, "CURRENT_TRUST_ROLLBACK");
  fx.state.sequence = 8; saveState(fx); assert.equal(check(fx).currentTrust.sequence, 8);
});
for (const [name, change, code] of [
  ["expired snapshot", f => { f.state.expiresAtUtc = f.at(0); }, "CURRENT_TRUST_WINDOW_INVALID"],
  ["future issue", f => { f.state.issuedAtUtc = f.at(1); }, "CURRENT_TRUST_WINDOW_INVALID"],
  ["overlong window", f => { f.state.expiresAtUtc = f.at(-30_000 + 86400_001); }, "CURRENT_TRUST_WINDOW_INVALID"],
  ["pre-decision snapshot", f => { f.state.issuedAtUtc = f.at(-40_001); }, "CURRENT_TRUST_WINDOW_INVALID"],
  ["invalid date", f => { f.state.issuedAtUtc = "2026-02-30T00:00:00.000Z"; }, "CURRENT_TRUST_WINDOW_INVALID"],
  ["another customer", f => { f.state.customerReference = "different-customer-01"; }, "CURRENT_TRUST_CONTEXT_MISMATCH"],
  ["unknown schema", f => { f.state.schemaVersion = 2; }, "CURRENT_TRUST_SCHEMA_INVALID"],
  ["unknown field", f => { f.state.extra = true; }, "CURRENT_TRUST_SCHEMA_INVALID"],
  ["wrong scope", f => { f.state.scope = "unapproved-scope"; }, "CURRENT_TRUST_SCHEMA_INVALID"],
  ["noninteger sequence", f => { f.state.sequence = 7.5; }, "CURRENT_TRUST_SCHEMA_INVALID"],
  ["zero sequence", f => { f.state.sequence = 0; }, "CURRENT_TRUST_SCHEMA_INVALID"],
  ["unsafe sequence", f => { f.state.sequence = Number.MAX_SAFE_INTEGER + 1; }, "CURRENT_TRUST_SCHEMA_INVALID"]
]) test(`current trust rejects ${name} with a matching pin`, t => {
  const fx = fixture(t); change(fx); saveState(fx); reject(fx, code);
});
test("exact issue and expiry boundaries are enforced", t => {
  const fx = fixture(t); fx.state.issuedAtUtc = fx.packet.decisionAtUtc;
  fx.state.policies[0].updatedAtUtc = fx.state.issuedAtUtc;
  fx.state.expiresAtUtc = fx.at(-40_000 + 86400_000); saveState(fx);
  assert.equal(check(fx).decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  fx.options.now = Date.parse(fx.state.expiresAtUtc) - 1;
  assert.equal(check(fx).decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  fx.options.now++; reject(fx, "CURRENT_TRUST_WINDOW_INVALID");
});
for (const kind of ["policies", "keys"]) test(`${kind} inventory rejects duplicates malformed entries and future updates`, t => {
  for (const mutate of [list => [...list, { ...list[0] }], list => [{ ...list[0], status: "UNKNOWN" }, ...list.slice(1)],
    list => [{ ...list[0], extra: true }, ...list.slice(1)], list => [null, ...list.slice(1)],
    list => [{ ...list[0], updatedAtUtc: new Date(Date.now() + 86400_000).toISOString() }, ...list.slice(1)],
    () => [], () => "bad", () => null]) {
    const fx = fixture(t); fx.state[kind] = mutate(fx.state[kind]); saveState(fx); reject(fx, "CURRENT_TRUST_INVENTORY_INVALID");
  }
});
test("inventory limits and extra unrelated revocations never broaden trust", t => {
  const fx = fixture(t);
  fx.state.policies.push({ sha256: "b".repeat(64), status: "REVOKED", updatedAtUtc: fx.at(-40_000) });
  fx.state.keys.push({ keyId: "c".repeat(64), status: "REVOKED", updatedAtUtc: fx.at(-40_000) });
  saveState(fx); assert.equal(check(fx).decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  fx.state.policies = Array.from({ length: 129 }, (_, i) => ({ sha256: hash(`policy-${i}`), status: "ACTIVE", updatedAtUtc: fx.at(-40_000) }));
  saveState(fx); reject(fx, "CURRENT_TRUST_INVENTORY_INVALID");
});
test("every partially specified trust-state option set fails rather than downgrading", t => {
  for (let mask = 1; mask < 15; mask++) {
    const fx = fixture(t); trustNames.forEach((name, i) => { if (!(mask & (1 << i))) delete fx.options[name]; });
    reject(fx, "CURRENT_TRUST_OPTIONS_INVALID");
  }
});
test("unknown profile, invalid pin, undefined values and unsafe sequence options are refused", t => {
  for (const [key, value] of [["requiredTrustStateProfile", "wrong"], ["requiredTrustStateProfile", undefined],
    ["expectedTrustStateSha256", "bad"], ["trustStatePath", ""], ["minimumTrustSequence", 0],
    ["minimumTrustSequence", "7"], ["minimumTrustSequence", 1.5], ["minimumTrustSequence", Number.MAX_SAFE_INTEGER + 1]]) {
    const fx = fixture(t); fx.options[key] = value; reject(fx, "CURRENT_TRUST_OPTIONS_INVALID");
  }
});
test("misspelled or unknown verifier options are not silently ignored", t => {
  const fx = fixture(t); fx.options.requiredTrustStateProfle = PROFILE; reject(fx, "EVIDENCE_INPUT_INVALID");
});
test("inherited option objects and getters cannot hide the trust requirement", t => {
  const fx = fixture(t), inherited = Object.create(fx.options);
  assert.equal(verifyPilotEvidence(inherited).decision, "NO_GO");
  let invoked = false;
  Object.defineProperty(fx.options, "minimumTrustSequence", { enumerable: true, get() { invoked = true; return 7; } });
  reject(fx, "EVIDENCE_INPUT_INVALID"); assert.equal(invoked, false);
});
test("legacy output stays unchanged when no trust-state controls are requested", t => {
  for (const version of [1, 2, 3]) {
    const fx = fixture(t, version); trustNames.forEach(name => delete fx.options[name]);
    const result = check(fx); assert.equal(result.decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
    assert.equal(Object.hasOwn(result, "currentTrust"), false);
  }
});
test("trust-state verification happens after signatures but before artifact directory access", t => {
  const fx = fixture(t); fx.state.keys[0].status = "REVOKED"; saveState(fx); fx.options.evidenceDir = "/missing-private-path";
  reject(fx, "CURRENT_TRUST_KEY_REVOKED");
  fx.envelope.signatures[0].signature = Buffer.alloc(64).toString("base64");
  writeFileSync(fx.options.signaturesPath, encoded(fx.envelope));
  rmSync(fx.options.trustStatePath); reject(fx, "SIGNATURE_INVALID");
});
test("fresh active registry cannot bypass artifact or signature verification", t => {
  const fx = fixture(t); writeFileSync(join(fx.options.evidenceDir, "G02.bin"), "tampered"); reject(fx, "ARTIFACT_DIGEST_MISMATCH");
});
test("strict encoding rejects duplicate keys pretty JSON BOM malformed UTF8 and root types", t => {
  for (const make of [f => encoded(f.state).toString().replace('"sequence":7', '"sequence":6,"sequence":7'),
    f => JSON.stringify(f.state, null, 2) + "\n", f => Buffer.concat([Buffer.from([239,187,191]), encoded(f.state)]),
    () => Buffer.from([255]), () => "null\n", () => "[]\n", () => '{"secret":"private-test"]']) {
    const fx = fixture(t); saveState(fx, make(fx));
    assert.equal(check(fx).decision, "NO_GO"); assert.doesNotMatch(JSON.stringify(check(fx)), /private-test|SyntaxError|stack/);
  }
});
test("snapshot readers reject missing linked directory empty and oversized sparse inputs", t => {
  for (const mode of ["missing", "symlink", "hardlink", "directory", "empty", "oversized"]) {
    const fx = fixture(t), path = fx.options.trustStatePath;
    if (mode === "missing") rmSync(path);
    if (mode === "symlink") { symlinkSync(path, join(fx.root, "alias")); fx.options.trustStatePath = join(fx.root, "alias"); }
    if (mode === "hardlink") linkSync(path, join(fx.root, "alias"));
    if (mode === "directory") fx.options.trustStatePath = fx.root;
    if (mode === "empty") writeFileSync(path, "");
    if (mode === "oversized") truncateSync(path, 65537);
    reject(fx, "CURRENT_TRUST_INPUT_INVALID");
  }
});
test("CLI requires the full profile pin and sequence without printing customer paths or keys", t => {
  const fx = fixture(t, 3), args = cliArgs(fx);
  args.push("--require-retention-profile", RETENTION, "--require-collection-profile", COLLECTION);
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).currentTrust.sequence, 7);
  for (const value of [fx.root, fx.packet.customerReference, ...fx.keyIds]) assert.ok(!result.stdout.includes(value));
});
test("CLI rejects partial duplicate unknown profile and ambiguous sequence arguments", t => {
  const fx = fixture(t);
  for (const args of [cliArgs(fx).slice(0, -2), [...cliArgs(fx), "--trust-state", fx.options.trustStatePath],
    [...cliArgs(fx), "--unknown", "x"], ...["07", "7e0", "7.0", "-7", "0", "9007199254740992"].map(value => [...cliArgs(fx).slice(0, -1), value])]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).decision, "NO_GO");
    assert.equal(result.stderr, ""); assert.ok(!result.stdout.includes(fx.root));
  }
});
test("CLI refuses FIFO snapshot without blocking", t => {
  const fx = fixture(t); rmSync(fx.options.trustStatePath);
  assert.equal(spawnSync("mkfifo", [fx.options.trustStatePath]).status, 0);
  const result = spawnSync(process.execPath, [cli, ...cliArgs(fx)], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).decision, "NO_GO");
  assert.equal(result.stderr, ""); assert.ok(!result.stdout.includes(fx.root));
});
