import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { normalizeS3Readback } from "./audit-pilot-s3-readback.mjs";
import { verifyStrictPilotEvidence, STRICT_PILOT_PROFILE } from "./audit-pilot-verify.mjs";

const READY = "READY_FOR_INDEPENDENT_AUTHORIZATION";
const ROLES = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
const OPS = ["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"];
const GATES = Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(JSON.stringify(value) + "\n");
const cli = fileURLToPath(new URL("./audit-pilot-verify.mjs", import.meta.url));
// Real independently signed local fixtures; no remote APIs or customer data.
function fixture(t, version = 3) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-strict-pilot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now(), at = delta => new Date(now + delta).toISOString();
  const keys = ROLES.map(() => generateKeyPairSync("ed25519"));
  const keyIds = keys.map(k => hash(k.publicKey.export({ type: "spki", format: "der" })));
  const dir = join(root, "artifacts"); mkdirSync(dir);
  const files = new Map([...GATES, ...ROLES].map(name => [`${name}.bin`, Buffer.from(`synthetic:${name}:\0\xff`)]));
  const archive = files.get("G05.bin");
  const requirements = { profile: "AWS_S3_OBJECT_LOCK_COMPLIANCE_V1", bucket: "synthetic-strict-vault", key: "audit/archive.bin",
    versionId: "version-synthetic-01", expectedBucketOwner: "123456789012", archiveSha256: hash(archive),
    archiveSizeBytes: archive.length, minRetentionUntilUtc: at(365 * 86400_000), maxObservationAgeSeconds: 3600, legalHoldRequired: true };
  if (version >= 2) {
    const request = { schemaVersion: 1, scope: "HRBP_S3_READ_COLLECTION:1", region: "eu-central-1", requirements };
    const raw = [{ Status: "Enabled" }, { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } },
      { VersionId: requirements.versionId, ContentLength: archive.length,
        ChecksumSHA256: createHash("sha256").update(archive).digest("base64"), ChecksumType: "FULL_OBJECT",
        ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: requirements.minRetentionUntilUtc, ObjectLockLegalHoldStatus: "ON" },
      { Retention: { Mode: "COMPLIANCE", RetainUntilDate: requirements.minRetentionUntilUtc } }, { LegalHold: { Status: "ON" } }];
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
    ...(version === 3 ? { collectionRequirements: { profile: "AWS_S3_COLLECTION_PROVENANCE_V1", manifestSha256: hash(files.get("collection-manifest.json")),
      requestSha256: hash(files.get("collection-request.json")) } } : {}) };
  const options = { packetPath: join(root, "packet.json"), policyPath: join(root, "policy.json"), expectedPolicySha256: "",
    signaturesPath: join(root, "signatures.json"), evidenceDir: dir,
    trustStatePath: join(root, "current-trust.json"), expectedTrustStateSha256: "", minimumTrustSequence: 7 };
  const state = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_CURRENT_TRUST:1", customerReference: packet.customerReference,
    sequence: 7, issuedAtUtc: at(-30_000), expiresAtUtc: at(3600_000),
    policies: [{ sha256: "", status: "ACTIVE", updatedAtUtc: at(-35_000) }],
    keys: keyIds.map(keyId => ({ keyId, status: "ACTIVE", updatedAtUtc: at(-86400_000) })) };
  const fx = { root, at, files, packet, policy, state, options, keys, keyIds };
  seal(fx); return fx;
}
function saveState(fx) {
  const bytes = encoded(fx.state); writeFileSync(fx.options.trustStatePath, bytes);
  fx.options.expectedTrustStateSha256 = hash(bytes);
}
function seal(fx) {
  fx.policy.packetSha256 = hash(encoded(fx.packet));
  const policySha = hash(encoded(fx.policy)); fx.options.expectedPolicySha256 = policySha;
  const envelope = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1", packetSha256: fx.policy.packetSha256,
    trustPolicySha256: policySha, signatures: fx.policy.approvers.map((a, i) => ({ role: a.role, reviewerReference: a.reviewerReference,
      keyId: fx.keyIds[i], signature: sign(null, Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" +
        JSON.stringify([policySha, fx.policy.packetSha256, a.role, a.reviewerReference, fx.keyIds[i]])), fx.keys[i].privateKey).toString("base64") })) };
  writeFileSync(fx.options.packetPath, encoded(fx.packet)); writeFileSync(fx.options.policyPath, encoded(fx.policy));
  writeFileSync(fx.options.signaturesPath, encoded(envelope)); fx.state.policies[0].sha256 = policySha; saveState(fx);
}
function reject(result, code) {
  assert.equal(result.decision, "NO_GO"); assert.equal(result.releaseAuthorized, false);
  assert.equal(result.verificationProfile, STRICT_PILOT_PROFILE);
  assert.equal(result.verifiedArtifacts, 0); assert.equal(result.verifiedSignatures, 0);
  assert.equal(result.currentTrust, undefined);
  if (code) assert.deepEqual(result.reasons, [code]);
}
function args(fx) {
  return ["--packet", fx.options.packetPath, "--trust-policy", fx.options.policyPath,
    "--expected-policy-sha256", fx.options.expectedPolicySha256, "--signatures", fx.options.signaturesPath,
    "--evidence-dir", fx.options.evidenceDir, "--trust-state", fx.options.trustStatePath,
    "--expected-trust-state-sha256", fx.options.expectedTrustStateSha256, "--minimum-trust-sequence", String(fx.options.minimumTrustSequence)];
}
function child(argv, extra = {}) {
  return spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8", timeout: 5000, ...extra });
}

test("strict entrypoint always checks both signatures, nineteen artifacts, S3 semantics, provenance and current trust", t => {
  const fx = fixture(t), result = verifyStrictPilotEvidence(fx.options);
  assert.equal(result.decision, READY); assert.equal(result.releaseAuthorized, false);
  assert.equal(result.verificationProfile, STRICT_PILOT_PROFILE);
  assert.equal(result.verifiedArtifacts, 19); assert.equal(result.verifiedSignatures, 2);
  assert.equal(result.retention.verifiedObservations, 5); assert.equal(result.retention.liveProviderVerified, false);
  assert.equal(result.collection.verifiedRawResponses, 5); assert.equal(result.collection.normalizedObservationMatched, true);
  assert.equal(result.collection.providerAttestationVerified, false); assert.equal(result.collection.lockEnforcementTested, false);
  assert.equal(result.currentTrust.sequence, 7); assert.equal(result.currentTrust.liveRegistryVerified, false);
});
for (const version of [1, 2]) test(`strict entrypoint refuses a valid v${version} legacy bundle that the low-level verifier still supports`, t => {
  const fx = fixture(t, version), low = { ...fx.options };
  for (const name of ["trustStatePath", "expectedTrustStateSha256", "minimumTrustSequence"]) delete low[name];
  assert.equal(verifyPilotEvidence(low).decision, READY);
  reject(verifyStrictPilotEvidence(fx.options), version === 1 ? "RETENTION_PROFILE_REQUIRED" : "COLLECTION_PROFILE_REQUIRED");
});
for (const name of ["packetPath", "policyPath", "expectedPolicySha256", "signaturesPath", "evidenceDir",
  "trustStatePath", "expectedTrustStateSha256", "minimumTrustSequence"]) test(`strict contract cannot omit ${name}`, t => {
  const fx = fixture(t); delete fx.options[name]; reject(verifyStrictPilotEvidence(fx.options), "STRICT_PILOT_INPUT_INVALID");
});
test("empty, malformed or weakly typed pins, paths and sequence cannot activate verification", t => {
  const fx = fixture(t);
  for (const [name, values] of [["minimumTrustSequence", [0, -1, 7.5, "7", undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]],
    ["expectedPolicySha256", [undefined, null, "a".repeat(63), "A".repeat(64)]],
    ["expectedTrustStateSha256", [undefined, "", "not-enrolled"]],
    ["trustStatePath", [undefined, null, "", "a\0b", "x".repeat(4097), "\ud800"]]]) {
    for (const value of values) reject(verifyStrictPilotEvidence({ ...fx.options, [name]: value }), "STRICT_PILOT_INPUT_INVALID");
  }
});
test("clock and profile overrides, misspelled controls, inherited objects and accessors are refused", t => {
  const fx = fixture(t);
  for (const name of ["now", "requiredRetentionProfile", "requiredCollectionProfile", "requiredTrustStateProfile", "minimumTrustSequnce"]) {
    reject(verifyStrictPilotEvidence({ ...fx.options, [name]: undefined }), "STRICT_PILOT_INPUT_INVALID");
  }
  reject(verifyStrictPilotEvidence(Object.create(fx.options)), "STRICT_PILOT_INPUT_INVALID");
  reject(verifyStrictPilotEvidence({ ...fx.options, [Symbol("hidden")]: true }), "STRICT_PILOT_INPUT_INVALID");
  let invoked = false; const accessor = { ...fx.options };
  Object.defineProperty(accessor, "trustStatePath", { get() { invoked = true; throw Error("private"); } });
  reject(verifyStrictPilotEvidence(accessor), "STRICT_PILOT_INPUT_INVALID"); assert.equal(invoked, false);
  for (const value of [null, undefined, false, 1, [], "text"]) reject(verifyStrictPilotEvidence(value), "STRICT_PILOT_INPUT_INVALID");
});
test("null-prototype and non-enumerable data options retain every required control", t => {
  const fx = fixture(t), input = Object.assign(Object.create(null), fx.options);
  Object.defineProperty(input, "trustStatePath", { value: input.trustStatePath, enumerable: false });
  assert.equal(verifyStrictPilotEvidence(input).decision, READY);
});
for (const target of ["policy", "security-key", "records-key"]) test(`strict command refuses ${target} revocation without touching historical signatures`, t => {
  const fx = fixture(t), original = readFileSync(fx.options.signaturesPath);
  const entry = target === "policy" ? fx.state.policies[0] : fx.state.keys[target === "security-key" ? 0 : 1];
  entry.status = "REVOKED"; saveState(fx);
  reject(verifyStrictPilotEvidence(fx.options), target === "policy" ? "CURRENT_TRUST_POLICY_REVOKED" : "CURRENT_TRUST_KEY_REVOKED");
  assert.deepEqual(readFileSync(fx.options.signaturesPath), original);
});
test("independently supplied trust pin and sequence floor are never inferred from the candidate", t => {
  const fx = fixture(t);
  reject(verifyStrictPilotEvidence({ ...fx.options, expectedTrustStateSha256: "b".repeat(64) }), "CURRENT_TRUST_DIGEST_MISMATCH");
  reject(verifyStrictPilotEvidence({ ...fx.options, minimumTrustSequence: 8 }), "CURRENT_TRUST_ROLLBACK");
  reject(verifyStrictPilotEvidence({ ...fx.options, expectedPolicySha256: "b".repeat(64) }), "TRUST_POLICY_DIGEST_MISMATCH");
});
test("expired snapshots and incorrect customer binding deny current acceptance", t => {
  const fx = fixture(t); fx.state.expiresAtUtc = fx.at(-1); saveState(fx);
  reject(verifyStrictPilotEvidence(fx.options), "CURRENT_TRUST_WINDOW_INVALID");
  fx.state.expiresAtUtc = fx.at(3600_000); fx.state.customerReference = "another-customer-01"; saveState(fx);
  reject(verifyStrictPilotEvidence(fx.options), "CURRENT_TRUST_CONTEXT_MISMATCH");
});
test("valid signatures cannot bypass S3 semantics at the strict entrypoint", t => {
  const fx = fixture(t), path = join(fx.options.evidenceDir, "G04.bin");
  const observation = JSON.parse(readFileSync(path)); observation.headObject.response.ObjectLockMode = "GOVERNANCE";
  const bytes = encoded(observation); writeFileSync(path, bytes);
  fx.packet.evidence.find(e => e.gate === "G04").sha256 = hash(bytes); seal(fx);
  reject(verifyStrictPilotEvidence(fx.options), "S3_COMPLIANCE_MODE_REQUIRED");
});
test("strict verification retains actual artifact, raw-response and signature verification", t => {
  for (const name of ["G01.bin", "G05.bin", "headObject.raw.json", "collection-manifest.json", "signatures.json"]) {
    const fx = fixture(t), path = name === "signatures.json" ? fx.options.signaturesPath : join(fx.options.evidenceDir, name);
    writeFileSync(path, "tampered"); reject(verifyStrictPilotEvidence(fx.options));
  }
});
test("signature failure precedes snapshot reads and revoked trust precedes artifact access", t => {
  const fx = fixture(t); rmSync(fx.options.trustStatePath);
  const envelope = JSON.parse(readFileSync(fx.options.signaturesPath));
  envelope.signatures[0].signature = Buffer.alloc(64).toString("base64"); writeFileSync(fx.options.signaturesPath, encoded(envelope));
  reject(verifyStrictPilotEvidence(fx.options), "SIGNATURE_INVALID");
  const q = fixture(t); q.state.keys[0].status = "REVOKED"; saveState(q);
  q.options.evidenceDir = join(q.root, "missing-artifacts");
  reject(verifyStrictPilotEvidence(q.options), "CURRENT_TRUST_KEY_REVOKED");
});
test("strict CLI accepts reordered complete arguments and prints only sanitized non-authorizing results", t => {
  const fx = fixture(t), input = args(fx), pairs = [];
  for (let i = 0; i < input.length; i += 2) pairs.push(input.slice(i, i + 2));
  const result = child(pairs.reverse().flat());
  assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.equal(JSON.parse(result.stdout).decision, READY);
  assert.equal(JSON.parse(result.stdout).releaseAuthorized, false);
  for (const secret of [fx.root, fx.packet.customerReference, ...fx.keyIds, fx.policy.retentionRequirements.bucket,
    fx.policy.retentionRequirements.key, fx.options.expectedPolicySha256]) assert.ok(!result.stdout.includes(secret));
});
test("strict CLI rejects missing arguments, duplicated arguments, overrides and coercible sequence strings", t => {
  const fx = fixture(t), base = args(fx), invalid = [[], base.slice(0, -2), [...base, "--now", "0"],
    [...base, "--require-trust-state-profile", ""], [...base.slice(0, -2), "--packet", fx.options.packetPath],
    [...base.slice(0, -1)], [...base.slice(0, -1), "--skip-trust"]];
  for (const value of ["0", "-1", "07", "7.0", "7e0", "+7", " 7", "7 ", "9007199254740992"]) invalid.push([...base.slice(0, -1), value]);
  for (const argv of invalid) {
    const result = child(argv); assert.equal(result.status, 1); assert.equal(result.stderr, "");
    reject(JSON.parse(result.stdout), "STRICT_PILOT_INPUT_INVALID"); assert.ok(!result.stdout.includes(fx.root));
  }
});
test("strict CLI rejects missing, symlinked and FIFO trust snapshots without waiting or revealing paths", t => {
  for (const kind of ["missing", "symlink", "fifo"]) {
    const fx = fixture(t), other = join(fx.root, "other");
    if (kind === "symlink") symlinkSync(fx.options.trustStatePath, other);
    if (kind === "fifo") assert.equal(spawnSync("mkfifo", [other]).status, 0);
    fx.options.trustStatePath = other;
    const result = child(args(fx)); assert.equal(result.status, 1); assert.equal(result.stderr, "");
    reject(JSON.parse(result.stdout), "CURRENT_TRUST_INPUT_INVALID"); assert.ok(!result.stdout.includes(fx.root));
  }
});
test("strict command does not read environment profile overrides or mutate evidence and trust state", t => {
  const fx = fixture(t), paths = [...readdirSync(fx.root).filter(name => name !== "artifacts").map(name => join(fx.root, name)),
    ...readdirSync(fx.options.evidenceDir).map(name => join(fx.options.evidenceDir, name))];
  const before = paths.map(path => hash(readFileSync(path)));
  const result = child(args(fx), { env: { HRBP_SKIP_TRUST: "true", HRBP_PILOT_PROFILE: "v1", AWS_PROFILE: "do-not-use" } });
  assert.equal(result.status, 0); assert.ok(JSON.parse(result.stdout).currentTrust);
  assert.deepEqual(paths.map(path => hash(readFileSync(path))), before);
});
