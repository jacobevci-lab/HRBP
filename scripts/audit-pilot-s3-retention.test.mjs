import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { S3_RETENTION_PROFILE } from "./audit-pilot-s3-retention.mjs";

const NOW = Date.parse("2026-10-27T21:00:00.000Z");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value) + "\n");
const iso = value => new Date(value).toISOString();
const roles = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
const gates = Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
const good = "READY_FOR_INDEPENDENT_AUTHORIZATION";
const cli = fileURLToPath(new URL("./audit-pilot-evidence.mjs", import.meta.url));

function fixture(t, now = NOW) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-s3-observation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceDir = join(root, "evidence");
  mkdirSync(evidenceDir);
  const keys = roles.map(() => generateKeyPairSync("ed25519"));
  const artifacts = new Map([...gates, ...roles].map(name => [name, Buffer.from(`synthetic-only-${name}\0\xff`)]));
  const requirements = {
    profile: S3_RETENTION_PROFILE, bucket: "private-synthetic-bucket", key: "restricted/archive.bin",
    versionId: "opaque-version-001", expectedBucketOwner: "123456789012",
    archiveSha256: sha(artifacts.get("G05")), archiveSizeBytes: artifacts.get("G05").length,
    minRetentionUntilUtc: iso(now + 365 * 86400_000), maxObservationAgeSeconds: 3600, legalHoldRequired: true
  };
  const bucketRequest = { Bucket: requirements.bucket, ExpectedBucketOwner: requirements.expectedBucketOwner };
  const objectRequest = { ...bucketRequest, Key: requirements.key, VersionId: requirements.versionId };
  const item = (request, response) => ({ observedAtUtc: iso(now - 5000), request: structuredClone(request), response });
  const observation = {
    schemaVersion: 1, scope: "HRBP_AWS_S3_OBJECT_LOCK_READBACK:1",
    bucketVersioning: item(bucketRequest, { Status: "Enabled" }),
    objectLockConfiguration: item(bucketRequest, { ObjectLockEnabled: "Enabled" }),
    headObject: item({ ...objectRequest, ChecksumMode: "ENABLED" }, {
      VersionId: requirements.versionId, ContentLength: requirements.archiveSizeBytes,
      ChecksumSHA256: Buffer.from(requirements.archiveSha256, "hex").toString("base64"),
      ChecksumType: "FULL_OBJECT", DeleteMarker: false,
      ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: requirements.minRetentionUntilUtc,
      ObjectLockLegalHoldStatus: "ON"
    }),
    objectRetention: item(objectRequest, { Mode: "COMPLIANCE", RetainUntilDate: requirements.minRetentionUntilUtc }),
    legalHold: item(objectRequest, { Status: "ON" })
  };
  const packet = {
    schemaVersion: 1, customerReference: "synthetic-customer", sourceCommitSha: "a".repeat(40),
    deployedWorkerVersionId: "synthetic-worker-version", decisionAtUtc: iso(now - 1000),
    nextReviewAtUtc: iso(now + 86400_000), approvedRetentionUntilUtc: requirements.minRetentionUntilUtc,
    evidence: gates.map(gate => ({
      gate, status: "PASS", sha256: "b".repeat(64), controlledLocator: `controlled-${gate}`,
      reviewerRole: "AUDIT_REVIEWER", reviewerReference: "synthetic-auditor", reviewedAtUtc: iso(now - 4000),
      evidenceType: gate === "G01" ? "DEPLOYED_REVISION_READBACK" : gate === "G03" ? "APPROVED_TSA_RFC3161" :
        gate === "G04" ? "INDEPENDENT_PROVIDER_LOCK_READBACK" : "CONTROLLED_EVIDENCE"
    })),
    customerSecurityApproval: { reviewerRole: roles[0], reviewerReference: "security-reviewer", approvedAtUtc: iso(now - 2000), evidenceSha256: "b".repeat(64) },
    recordsLegalApproval: { reviewerRole: roles[1], reviewerReference: "records-reviewer", approvedAtUtc: iso(now - 2000), evidenceSha256: "b".repeat(64) }
  };
  const policy = {
    schemaVersion: 2, scope: "HRBP_AUDIT_PILOT_TRUST:2", packetSha256: "b".repeat(64),
    customerReference: packet.customerReference, sourceCommitSha: packet.sourceCommitSha,
    deployedWorkerVersionId: packet.deployedWorkerVersionId, validFromUtc: iso(now - 60_000), validUntilUtc: iso(now + 86400_000),
    approvers: roles.map((role, index) => ({ role,
      reviewerReference: [packet.customerSecurityApproval, packet.recordsLegalApproval][index].reviewerReference,
      publicKeyPem: keys[index].publicKey.export({ type: "spki", format: "pem" }).toString()
    })), retentionRequirements: requirements
  };
  const options = { packetPath: join(root, "packet.json"), policyPath: join(root, "policy.json"),
    signaturesPath: join(root, "signatures.json"), expectedPolicySha256: "b".repeat(64), evidenceDir, now };
  function publish({ rawObservation } = {}) {
    artifacts.set("G04", rawObservation ?? encode(observation));
    for (const [name, bytes] of artifacts) writeFileSync(join(evidenceDir, name + ".bin"), bytes, { mode: 0o600 });
    for (const entry of packet.evidence) entry.sha256 = sha(artifacts.get(entry.gate));
    packet.customerSecurityApproval.evidenceSha256 = sha(artifacts.get(roles[0]));
    packet.recordsLegalApproval.evidenceSha256 = sha(artifacts.get(roles[1]));
    const packetBytes = encode(packet);
    policy.packetSha256 = sha(packetBytes);
    const policyBytes = encode(policy);
    options.expectedPolicySha256 = sha(policyBytes);
    // Independently construct signature payloads, not via the implementation helper.
    const envelope = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1", packetSha256: policy.packetSha256,
      trustPolicySha256: options.expectedPolicySha256,
      signatures: roles.map((role, index) => {
        const reviewerReference = policy.approvers[index].reviewerReference;
        const keyId = sha(keys[index].publicKey.export({ type: "spki", format: "der" }));
        const binding = Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" +
          JSON.stringify([options.expectedPolicySha256, policy.packetSha256, role, reviewerReference, keyId]));
        return { role, reviewerReference, keyId, signature: sign(null, binding, keys[index].privateKey).toString("base64") };
      }) };
    writeFileSync(options.packetPath, packetBytes, { mode: 0o600 });
    writeFileSync(options.policyPath, policyBytes, { mode: 0o600 });
    writeFileSync(options.signaturesPath, encode(envelope), { mode: 0o600 });
  }
  publish();
  return { root, observation, requirements, policy, packet, artifacts, options, publish };
}
function reject(fx, code) {
  const result = verifyPilotEvidence(fx.options);
  assert.equal(result.decision, "NO_GO");
  assert.deepEqual(result.reasons, [code]);
  assert.equal(result.verifiedSignatures, 0);
  assert.equal(result.verifiedArtifacts, 0);
}
function args(fx) {
  return ["--packet", fx.options.packetPath, "--trust-policy", fx.options.policyPath,
    "--expected-policy-sha256", fx.options.expectedPolicySha256, "--signatures", fx.options.signaturesPath,
    "--evidence-dir", fx.options.evidenceDir];
}
function cliRun(argv) { return spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8", timeout: 5000 }); }

test("v2 verifies five retained S3 observations and twelve signed artifacts without claiming live enforcement", t => {
  const fx = fixture(t);
  const result = verifyPilotEvidence(fx.options);
  assert.equal(result.decision, good);
  assert.equal(result.assuranceLevel, "PINNED_SIGNATURES_DIGESTS_AND_S3_OBSERVATION_SEMANTICS");
  assert.deepEqual(result.retention, { profile: S3_RETENTION_PROFILE, verifiedObservations: 5, liveProviderVerified: false });
  assert.equal(result.verifiedArtifacts, 12);
  assert.equal(result.verifiedSignatures, 2);
});

test("v1 output remains byte-shape compatible and never claims S3 semantics", t => {
  const fx = fixture(t);
  fx.policy.schemaVersion = 1; fx.policy.scope = "HRBP_AUDIT_PILOT_TRUST:1"; delete fx.policy.retentionRequirements;
  fx.observation.headObject.response.ObjectLockMode = "GOVERNANCE";
  fx.publish();
  assert.deepEqual(verifyPilotEvidence(fx.options), { decision: good, assuranceLevel: "PINNED_DUAL_SIGNATURES_AND_FILE_DIGESTS",
    reasons: [], verifiedSignatures: 2, verifiedArtifacts: 12 });
  reject({ options: { ...fx.options, requiredRetentionProfile: S3_RETENTION_PROFILE } }, "RETENTION_PROFILE_REQUIRED");
});

const semanticCases = [
  ["governance mode in HEAD", fx => { fx.observation.headObject.response.ObjectLockMode = "GOVERNANCE"; }, "S3_COMPLIANCE_MODE_REQUIRED"],
  ["governance mode in retention readback", fx => { fx.observation.objectRetention.response.Mode = "GOVERNANCE"; }, "S3_COMPLIANCE_MODE_REQUIRED"],
  ["bucket versioning suspended", fx => { fx.observation.bucketVersioning.response.Status = "Suspended"; }, "S3_BUCKET_LOCK_NOT_ENABLED"],
  ["object lock disabled", fx => { fx.observation.objectLockConfiguration.response.ObjectLockEnabled = "Disabled"; }, "S3_BUCKET_LOCK_NOT_ENABLED"],
  ["default retention is not object retention", fx => { fx.observation.objectRetention.response = { DefaultRetention: { Mode: "COMPLIANCE", Days: 365 } }; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["HEAD version substitution", fx => { fx.observation.headObject.response.VersionId = "another-version"; }, "S3_OBJECT_VERSION_MISMATCH"],
  ["delete marker", fx => { fx.observation.headObject.response.DeleteMarker = true; }, "S3_OBJECT_VERSION_MISMATCH"],
  ["incorrect content length", fx => { fx.observation.headObject.response.ContentLength++; }, "S3_OBJECT_VERSION_MISMATCH"],
  ["composite SHA256", fx => { fx.observation.headObject.response.ChecksumType = "COMPOSITE"; }, "S3_OBJECT_CHECKSUM_MISMATCH"],
  ["ETag instead of SHA256", fx => { delete fx.observation.headObject.response.ChecksumSHA256; fx.observation.headObject.response.ETag = '\"abc\"'; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["different object checksum", fx => { fx.observation.headObject.response.ChecksumSHA256 = Buffer.alloc(32).toString("base64"); }, "S3_OBJECT_CHECKSUM_MISMATCH"],
  ["noncanonical base64", fx => { fx.observation.headObject.response.ChecksumSHA256 += "\n"; }, "S3_OBJECT_CHECKSUM_MISMATCH"],
  ["short retention", fx => { const until = iso(NOW + 10 * 86400_000); fx.observation.headObject.response.ObjectLockRetainUntilDate = until; fx.observation.objectRetention.response.RetainUntilDate = until; }, "S3_RETENTION_DEADLINE_UNMET"],
  ["expired retention", fx => { const until = iso(NOW - 1); fx.observation.headObject.response.ObjectLockRetainUntilDate = until; fx.observation.objectRetention.response.RetainUntilDate = until; }, "S3_RETENTION_DEADLINE_UNMET"],
  ["contradictory retain-until readbacks", fx => { fx.observation.objectRetention.response.RetainUntilDate = iso(NOW + 400 * 86400_000); }, "S3_RETENTION_DEADLINE_UNMET"],
  ["legal hold absent", fx => { fx.observation.headObject.response.ObjectLockLegalHoldStatus = "OFF"; fx.observation.legalHold.response.Status = "OFF"; }, "S3_LEGAL_HOLD_UNMET"],
  ["contradictory legal hold", fx => { fx.observation.legalHold.response.Status = "OFF"; }, "S3_LEGAL_HOLD_UNMET"],
  ["hold only without timed compliance", fx => { delete fx.observation.objectRetention.response.RetainUntilDate; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["provider error response", fx => { fx.observation.headObject.response = { Error: "AccessDenied" }; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["unsupported variable event hold", fx => { fx.observation.objectRetention.response.EventHold = "ON"; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["missing readback", fx => { delete fx.observation.legalHold; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["unknown readback field", fx => { fx.observation.extra = "untrusted"; }, "S3_OBSERVATION_SCHEMA_INVALID"],
  ["policy weaker than packet retention", fx => { fx.requirements.minRetentionUntilUtc = iso(NOW + 7 * 86400_000); }, "S3_RETENTION_POLICY_UNMET"],
  ["archive pin does not bind G05", fx => { fx.requirements.archiveSha256 = "f".repeat(64); }, "S3_ARCHIVE_CONTEXT_MISMATCH"],
  ["archive length does not bind G05", fx => { fx.requirements.archiveSizeBytes++; }, "S3_ARCHIVE_CONTEXT_MISMATCH"]
];
for (const [name, mutate, code] of semanticCases) test(`even valid signatures cannot accept ${name}`, t => {
  const fx = fixture(t); mutate(fx); fx.publish(); reject(fx, code);
});

for (const operation of ["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"]) {
  test(`${operation} must target the independently pinned bucket and expected owner`, t => {
    const fx = fixture(t);
    for (const field of ["Bucket", "ExpectedBucketOwner"]) {
      const original = fx.observation[operation].request[field];
      fx.observation[operation].request[field] = "other-target"; fx.publish();
      reject(fx, "S3_OBSERVATION_TARGET_MISMATCH");
      fx.observation[operation].request[field] = original;
    }
  });
  test(`${operation} rejects future, stale, post-review and malformed observation dates`, t => {
    const fx = fixture(t);
    for (const value of [iso(NOW + 1), iso(NOW - 3_600_001), iso(NOW - 3000), "invalid", null]) {
      fx.observation[operation].observedAtUtc = value; fx.publish(); reject(fx, "S3_OBSERVATION_TIME_INVALID");
    }
  });
}
for (const operation of ["headObject", "objectRetention", "legalHold"]) test(`${operation} requires exact key and explicit version`, t => {
  const fx = fixture(t);
  for (const field of ["Key", "VersionId"]) {
    const original = fx.observation[operation].request[field];
    for (const value of ["wrong-version-or-key", "null", undefined]) {
      fx.observation[operation].request[field] = value; fx.publish(); reject(fx, "S3_OBSERVATION_TARGET_MISMATCH");
    }
    fx.observation[operation].request[field] = original;
  }
});

test("requirements reject unsupported profiles, invalid bounds and non-boolean legal-hold policy", t => {
  const fx = fixture(t);
  for (const [field, value] of [["profile", "ANY_PROVIDER"], ["maxObservationAgeSeconds", 0], ["maxObservationAgeSeconds", 86401],
    ["maxObservationAgeSeconds", "3600"], ["legalHoldRequired", "false"], ["versionId", "null"], ["key", "\ud800"],
    ["expectedBucketOwner", "123"], ["archiveSizeBytes", 4194305], ["minRetentionUntilUtc", "tomorrow"]]) {
    const original = fx.requirements[field]; fx.requirements[field] = value; fx.publish();
    reject(fx, "S3_RETENTION_POLICY_INVALID"); fx.requirements[field] = original;
  }
});

test("optional legal hold never weakens timed compliance retention", t => {
  const fx = fixture(t); fx.requirements.legalHoldRequired = false;
  fx.observation.headObject.response.ObjectLockLegalHoldStatus = "OFF"; fx.observation.legalHold.response.Status = "OFF";
  fx.publish(); assert.equal(verifyPilotEvidence(fx.options).decision, good);
  fx.observation.objectRetention.response.Mode = "GOVERNANCE"; fx.publish(); reject(fx, "S3_COMPLIANCE_MODE_REQUIRED");
});

test("exact freshness and retention boundaries pass and exceeding freshness fails", t => {
  const fx = fixture(t);
  fx.observation.headObject.observedAtUtc = iso(NOW - 3_600_000); fx.publish();
  assert.equal(verifyPilotEvidence(fx.options).decision, good);
  fx.options.now++; reject(fx, "S3_OBSERVATION_TIME_INVALID");
});

test("v2 cannot omit requirements or smuggle them into v1", t => {
  const fx = fixture(t); delete fx.policy.retentionRequirements; fx.publish(); reject(fx, "TRUST_POLICY_INVALID");
  fx.policy.schemaVersion = 1; fx.policy.scope = "HRBP_AUDIT_PILOT_TRUST:1";
  fx.policy.retentionRequirements = fx.requirements; fx.publish(); reject(fx, "TRUST_POLICY_INVALID");
});

test("the original pin cannot be reused after removing the retention profile", t => {
  const fx = fixture(t); const oldPin = fx.options.expectedPolicySha256;
  fx.policy.schemaVersion = 1; fx.policy.scope = "HRBP_AUDIT_PILOT_TRUST:1"; delete fx.policy.retentionRequirements;
  fx.publish(); fx.options.expectedPolicySha256 = oldPin; reject(fx, "TRUST_POLICY_DIGEST_MISMATCH");
});

test("unknown or empty programmatic required profile is rejected", t => {
  const fx = fixture(t);
  for (const requiredRetentionProfile of [null, false, "", "OTHER_PROFILE"]) {
    reject({ options: { ...fx.options, requiredRetentionProfile } }, "RETENTION_PROFILE_REQUIRED");
  }
});

test("G04 parses exactly the bytes whose digest was authenticated", t => {
  const fx = fixture(t);
  for (const rawObservation of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n'),
    Buffer.from(JSON.stringify(fx.observation, null, 2) + "\n"), Buffer.from([0xff]), Buffer.alloc(32769, 32)]) {
    fx.publish({ rawObservation });
    assert.equal(verifyPilotEvidence(fx.options).decision, "NO_GO");
  }
});

test("G04 and G05 tampering fails before any semantic acceptance", t => {
  const fx = fixture(t);
  for (const name of ["G04", "G05"]) {
    fx.publish(); writeFileSync(join(fx.options.evidenceDir, name + ".bin"), "tampered"); reject(fx, "ARTIFACT_DIGEST_MISMATCH");
  }
});

test("signature verification still precedes observation parsing", t => {
  const fx = fixture(t); fx.publish({ rawObservation: Buffer.from("malformed") });
  const envelope = JSON.parse(readFileSync(fx.options.signaturesPath, "utf8"));
  envelope.signatures[0].signature = Buffer.alloc(64).toString("base64");
  writeFileSync(fx.options.signaturesPath, encode(envelope)); reject(fx, "SIGNATURE_INVALID");
});

test("real CLI supports required profile without leaking bucket, key, owner or version", t => {
  const fx = fixture(t, Date.now());
  const child = cliRun([...args(fx), "--require-retention-profile", S3_RETENTION_PROFILE]);
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, "");
  assert.equal(JSON.parse(child.stdout).retention.liveProviderVerified, false);
  for (const secret of [fx.requirements.bucket, fx.requirements.key, fx.requirements.versionId, fx.requirements.expectedBucketOwner]) {
    assert.ok(!child.stdout.includes(secret));
  }
});

test("real CLI refuses v1 downgrade and duplicate, unknown or incomplete profile flags", t => {
  const fx = fixture(t, Date.now());
  fx.policy.schemaVersion = 1; fx.policy.scope = "HRBP_AUDIT_PILOT_TRUST:1"; delete fx.policy.retentionRequirements; fx.publish();
  const strict = cliRun([...args(fx), "--require-retention-profile", S3_RETENTION_PROFILE]);
  assert.equal(strict.status, 1); assert.deepEqual(JSON.parse(strict.stdout).reasons, ["RETENTION_PROFILE_REQUIRED"]);
  for (const argv of [[...args(fx), "--require-retention-profile"], [...args(fx), "--unexpected", "value"],
    [...args(fx), "--packet", "another"], [...args(fx).slice(2), "--require-retention-profile", S3_RETENTION_PROFILE]]) {
    const child = cliRun(argv); assert.equal(child.error, undefined); assert.equal(child.status, 1);
    assert.deepEqual(JSON.parse(child.stdout).reasons, ["EVIDENCE_INPUT_INVALID"]);
  }
});
