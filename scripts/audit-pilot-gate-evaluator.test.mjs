import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readPilotBytes } from "./audit-pilot-gate-evaluator.mjs";
import { verifyPilotEvidence, pilotApprovalSigningBytes } from "./audit-pilot-evidence.mjs";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { evaluateAuditPilotGate, parsePilotPacket, readPilotPacket, REQUIRED_GATES } from "./audit-pilot-gate-evaluator.mjs";

const now = Date.parse("2026-10-27T20:00:00.000Z");
const when = new Date(now - 60_000).toISOString();
const until = new Date(now + 7 * 86400_000).toISOString();
const hash = "a".repeat(64);
function valid() {
  return {
    schemaVersion:1,
    customerReference:"customer-test-01",
    sourceCommitSha:"b".repeat(40),
    deployedWorkerVersionId:"worker-version-123",
    decisionAtUtc:when,
    nextReviewAtUtc:until,
    approvedRetentionUntilUtc:until,
    evidence:REQUIRED_GATES.map(gate=>({
      gate,status:"PASS",sha256:hash,controlledLocator:"controlled-evidence-01",
      reviewerRole:"AUDIT_REVIEWER",reviewerReference:"reviewer-oper-01",
      reviewedAtUtc:when,
      evidenceType:gate==="G01" ? "DEPLOYED_REVISION_READBACK" :
        gate==="G03" ? "APPROVED_TSA_RFC3161" :
        gate==="G04" ? "INDEPENDENT_PROVIDER_LOCK_READBACK" : "CONTROLLED_EVIDENCE"
    })),
    customerSecurityApproval:{
      reviewerRole:"CUSTOMER_SECURITY",reviewerReference:"reviewer-security-01",
      approvedAtUtc:when,evidenceSha256:hash
    },
    recordsLegalApproval:{
      reviewerRole:"LEGAL_RECORDS",reviewerReference:"reviewer-legal-01",
      approvedAtUtc:when,evidenceSha256:hash
    }
  };
}
const evalPacket = packet => evaluateAuditPilotGate(packet,{now});
test("complete declared packet is only ready for independent authorization, never GO",()=>{
  const result = evalPacket(valid());
  assert.equal(result.decision,"READY_FOR_INDEPENDENT_AUTHORIZATION");
  assert.equal(result.passCount,10);
  assert.deepEqual(result.reasons,[]);
});
test("missing, duplicate and non-pass evidence is NO_GO",()=>{
  let p=valid();p.evidence.pop();
  assert.equal(evalPacket(p).decision,"NO_GO");
  p=valid();p.evidence[1]={...p.evidence[0]};
  assert.equal(evalPacket(p).decision,"NO_GO");
  p=valid();p.evidence[2].status="MISSING";
  assert.ok(evalPacket(p).reasons.includes("G03_NOT_PASS"));
});
test("operator receipt cannot substitute independent provider enforcement",()=>{
  const p=valid();p.evidence[3].evidenceType="OPERATOR_ATTESTED_PROVIDER_RECEIPT";
  assert.ok(evalPacket(p).reasons.includes("G04_PROVIDER_PROOF_MISSING"));
});
test("CI build cannot substitute independently read back deployed revision",()=>{
  const p=valid();p.evidence[0].evidenceType="GITHUB_CI_PASS";
  assert.ok(evalPacket(p).reasons.includes("G01_PROVENANCE_TYPE_INVALID"));
});
test("unapproved synthetic TSA cannot satisfy G03",()=>{
  const p=valid();p.evidence[2].evidenceType="EPHEMERAL_TEST_TSA";
  assert.ok(evalPacket(p).reasons.includes("G03_TSA_TYPE_INVALID"));
});
test("separation of security and records approval is mandatory",()=>{
  const p=valid();p.recordsLegalApproval.reviewerReference=p.customerSecurityApproval.reviewerReference;
  assert.ok(evalPacket(p).reasons.includes("APPROVAL_SEPARATION_MISSING"));
});
test("expired time window, stale review and incomplete deployment are NO_GO",()=>{
  const p=valid();p.nextReviewAtUtc=when;p.sourceCommitSha=null;
  p.evidence[0].reviewedAtUtc="2024-01-01T00:00:00.000Z";
  const r=evalPacket(p);
  assert.ok(r.reasons.includes("DECISION_WINDOW_INVALID"));
  assert.ok(r.reasons.includes("DEPLOYMENT_IDENTITY_MISSING"));
  assert.ok(r.reasons.includes("G01_EVIDENCE_INVALID"));
});
test("unknown packet and evidence fields fail closed",()=>{
  const p=valid();p.extra="unsafe";
  assert.ok(evalPacket(p).reasons.includes("PACKET_SCHEMA_INVALID"));
  const q=valid();q.evidence[0].freeform=true;
  assert.ok(evalPacket(q).reasons.includes("G01_EVIDENCE_INVALID"));
});
test("input fails on invalid JSON and oversized files",()=>{
  assert.throws(()=>parsePilotPacket("{"));
  assert.throws(()=>parsePilotPacket("x".repeat(65537)));
});

test("null or missing approvals fail closed without throwing",()=>{
  for (const replacement of [null, undefined, false, {}, "bad"]) {
    const p=valid();p.customerSecurityApproval=replacement;
    assert.doesNotThrow(()=>evalPacket(p));
    assert.equal(evalPacket(p).decision,"NO_GO");
    assert.ok(evalPacket(p).reasons.includes("SECURITY_APPROVAL_MISSING"));
    const q=valid();q.recordsLegalApproval=replacement;
    assert.doesNotThrow(()=>evalPacket(q));
    assert.ok(evalPacket(q).reasons.includes("LEGAL_APPROVAL_MISSING"));
  }
});
test("unknown, null, and primitive gate records fail closed without throwing",()=>{
  for(const replacement of [null, 2, false, "G01", {gate:"G99"}]) {
    const p=valid();p.evidence[0]=replacement;
    assert.doesNotThrow(()=>evalPacket(p));
    assert.equal(evalPacket(p).decision,"NO_GO");
  }
});
test("malformed packet members fail closed regardless of JS type",()=>{
  for(const replacement of [null, [], 42, "invalid", {}]) {
    const p=valid();p.evidence=replacement;
    assert.doesNotThrow(()=>evalPacket(p));
    assert.equal(evalPacket(p).decision,"NO_GO");
  }
});

test("a failed special evidence type is never counted as a passed gate", () => {
  const p = valid();
  for (const index of [0, 2, 3]) p.evidence[index].evidenceType = "UNVERIFIED_DECLARATION";
  const result = evalPacket(p);
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.passCount, 7);
});

test("evidence reviewed after the declared decision fails chronology", () => {
  const p = valid();
  p.evidence[4].reviewedAtUtc = new Date(now - 30_000).toISOString();
  assert.equal(evalPacket(p).decision, "NO_GO");
  assert.ok(evalPacket(p).reasons.includes("G05_EVIDENCE_INVALID"));
});

test("both approvals must follow the latest evidence review", () => {
  const p = valid();
  p.customerSecurityApproval.approvedAtUtc = new Date(now - 120_000).toISOString();
  p.recordsLegalApproval.approvedAtUtc = new Date(now - 120_000).toISOString();
  const result = evalPacket(p);
  assert.equal(result.decision, "NO_GO");
  assert.ok(result.reasons.includes("SECURITY_APPROVAL_SEQUENCE_INVALID"));
  assert.ok(result.reasons.includes("LEGAL_APPROVAL_SEQUENCE_INVALID"));
});

test("approvals after the declared decision are rejected", () => {
  const p = valid();
  p.customerSecurityApproval.approvedAtUtc = new Date(now - 1).toISOString();
  p.recordsLegalApproval.approvedAtUtc = new Date(now - 1).toISOString();
  assert.equal(evalPacket(p).decision, "NO_GO");
});

test("the review window cannot outlive retention or exceed ninety days", () => {
  const p = valid();
  p.nextReviewAtUtc = new Date(now + 8 * 86400_000).toISOString();
  assert.ok(evalPacket(p).reasons.includes("DECISION_WINDOW_INVALID"));
  p.approvedRetentionUntilUtc = new Date(now + 365 * 86400_000).toISOString();
  p.nextReviewAtUtc = new Date(now + 91 * 86400_000).toISOString();
  assert.ok(evalPacket(p).reasons.includes("DECISION_WINDOW_INVALID"));
});

test("reviewer roles reject whitespace, control characters and unbounded text", () => {
  for (const role of ["    ", "AUDIT\nREVIEWER", "X".repeat(65)]) {
    const p = valid();
    p.evidence[0].reviewerRole = role;
    assert.equal(evalPacket(p).decision, "NO_GO");
  }
});

function diskFixture(t, value = valid()) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-pilot-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "packet.json");
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return { root, path };
}
const packetError = error => error?.message === "PACKET_INVALID";

test("bounded descriptor reader preserves a regular UTF-8 packet", t => {
  const fx = diskFixture(t);
  assert.deepEqual(readPilotPacket(fx.path), valid());
});

test("reader accepts exactly 64 KiB and rejects an oversized sparse file", t => {
  const fx = diskFixture(t);
  const text = JSON.stringify(valid());
  writeFileSync(fx.path, text + " ".repeat(65_536 - Buffer.byteLength(text)));
  assert.deepEqual(readPilotPacket(fx.path), valid());
  truncateSync(fx.path, 1024 * 1024 * 1024);
  assert.throws(() => readPilotPacket(fx.path), packetError);
});

test("final-component symlinks and hard-linked inputs are rejected", t => {
  const fx = diskFixture(t);
  const symbolic = join(fx.root, "symbolic.json");
  symlinkSync(fx.path, symbolic);
  assert.throws(() => readPilotPacket(symbolic), packetError);
  const hard = join(fx.root, "hard.json");
  linkSync(fx.path, hard);
  assert.throws(() => readPilotPacket(hard), packetError);
  assert.throws(() => readPilotPacket(fx.path), packetError);
});

test("directories, missing paths and empty files are rejected", t => {
  const fx = diskFixture(t);
  const directory = join(fx.root, "directory");
  mkdirSync(directory);
  for (const path of [directory, join(fx.root, "missing.json"), "", "bad\0path"]) {
    assert.throws(() => readPilotPacket(path), packetError);
  }
  writeFileSync(fx.path, "");
  assert.throws(() => readPilotPacket(fx.path), packetError);
});

test("invalid UTF-8 and a UTF-8 BOM are rejected rather than normalized", t => {
  const fx = diskFixture(t);
  const malformed = Buffer.concat([Buffer.from('{"text":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  writeFileSync(fx.path, malformed);
  assert.throws(() => readPilotPacket(fx.path), packetError);
  writeFileSync(fx.path, "\ufeff" + JSON.stringify(valid()));
  assert.throws(() => readPilotPacket(fx.path), packetError);
});

const cli = fileURLToPath(new URL("./audit-pilot-gate-evaluator.mjs", import.meta.url));
function runCli(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
}
function currentPacket() {
  const p = valid();
  const current = Date.now();
  p.decisionAtUtc = new Date(current - 1000).toISOString();
  p.nextReviewAtUtc = new Date(current + 86400_000).toISOString();
  p.approvedRetentionUntilUtc = new Date(current + 7 * 86400_000).toISOString();
  for (const e of p.evidence) e.reviewedAtUtc = new Date(current - 3000).toISOString();
  for (const a of [p.customerSecurityApproval, p.recordsLegalApproval]) {
    a.approvedAtUtc = new Date(current - 2000).toISOString();
  }
  return p;
}

test("CLI succeeds only as a metadata preflight and does not echo packet identifiers", t => {
  const p = currentPacket();
  p.customerReference = "sensitive-customer-01";
  const fx = diskFixture(t, p);
  const child = runCli(fx.path);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), {
    decision: "READY_FOR_INDEPENDENT_AUTHORIZATION", reasons: [], passCount: 10
  });
  assert.ok(!child.stdout.includes(p.customerReference));
});

test("CLI emits NO_GO and a nonzero exit for rejected evidence", t => {
  const p = currentPacket();
  p.evidence[3].evidenceType = "OPERATOR_ATTESTED_PROVIDER_RECEIPT";
  const fx = diskFixture(t, p);
  const child = runCli(fx.path);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout);
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.passCount, 9);
  assert.ok(result.reasons.includes("G04_PROVIDER_PROOF_MISSING"));
});

test("CLI errors are bounded JSON without raw path, content or stack traces", t => {
  const fx = diskFixture(t);
  writeFileSync(fx.path, "sensitive-raw-packet-value");
  for (const args of [[fx.path], [join(fx.root, "missing-secret-path")], [], [fx.path, "extra"]]) {
    const child = runCli(...args);
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.deepEqual(JSON.parse(child.stderr), { decision: "NO_GO", reasons: ["PACKET_INVALID"], passCount: 0 });
    assert.ok(!child.stderr.includes(fx.root));
    assert.ok(!child.stderr.includes("sensitive-raw-packet-value"));
  }
});

test("CLI refuses FIFO input without waiting for a writer", t => {
  const fx = diskFixture(t);
  const fifo = join(fx.root, "packet.fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8", timeout: 5000 });
  assert.equal(created.error, undefined);
  assert.equal(created.status, 0);
  const child = runCli(fifo);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stderr), { decision: "NO_GO", reasons: ["PACKET_INVALID"], passCount: 0 });
});

test("valid evidence inventory order does not change the outcome", () => {
  const p = valid();
  p.evidence.reverse();
  assert.deepEqual(evalPacket(p), evalPacket(valid()));
});

test("future, invalid and stale clocks or evidence always fail closed", () => {
  for (const clock of [NaN, Infinity, -1, 1.5, "today"]) {
    assert.equal(evaluateAuditPilotGate(valid(), { now: clock }).decision, "NO_GO");
  }
  for (const timestamp of [null, "invalid", "2026-10-27", "2024-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"]) {
    const p = valid();
    p.evidence[0].reviewedAtUtc = timestamp;
    assert.equal(evalPacket(p).decision, "NO_GO");
  }
});

// Independent test signer: production tooling never reads private keys.
const approvalRoles = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const compact = value => Buffer.from(JSON.stringify(value) + "\n");
function signedFixture(t, clock = now) {
  const { root, path } = diskFixture(t);
  const evidenceDir = join(root, "evidence");
  mkdirSync(evidenceDir, { mode: 0o700 });
  const packet = valid();
  packet.decisionAtUtc = new Date(clock - 1000).toISOString();
  packet.nextReviewAtUtc = new Date(clock + 86400_000).toISOString();
  packet.approvedRetentionUntilUtc = new Date(clock + 7 * 86400_000).toISOString();
  for (const e of packet.evidence) {
    e.reviewedAtUtc = new Date(clock - 3000).toISOString();
    const bytes = Buffer.concat([Buffer.from(`synthetic-evidence-${e.gate}`), Buffer.from([0, 255, 10])]);
    e.sha256 = digest(bytes);
    writeFileSync(join(evidenceDir, `${e.gate}.bin`), bytes, { mode: 0o600 });
  }
  for (const a of [packet.customerSecurityApproval, packet.recordsLegalApproval]) {
    a.approvedAtUtc = new Date(clock - 2000).toISOString();
    const bytes = Buffer.from(`synthetic-approved-record-${a.reviewerRole}`);
    a.evidenceSha256 = digest(bytes);
    writeFileSync(join(evidenceDir, `${a.reviewerRole}.bin`), bytes, { mode: 0o600 });
  }
  const keyPairs = new Map(approvalRoles.map(role => [role, generateKeyPairSync("ed25519")]));
  const policy = {
    schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_TRUST:1", packetSha256: "",
    customerReference: packet.customerReference, sourceCommitSha: packet.sourceCommitSha,
    deployedWorkerVersionId: packet.deployedWorkerVersionId,
    validFromUtc: new Date(clock - 3600_000).toISOString(),
    validUntilUtc: new Date(clock + 86400_000).toISOString(),
    approvers: approvalRoles.map((role, index) => ({
      role, reviewerReference: [packet.customerSecurityApproval, packet.recordsLegalApproval][index].reviewerReference,
      publicKeyPem: keyPairs.get(role).publicKey.export({ type: "spki", format: "pem" }).toString()
    }))
  };
  const fx = {
    root, path, evidenceDir, packet, policy, keyPairs, clock,
    policyPath: join(root, "trust-policy.json"), signaturesPath: join(root, "signatures.json"),
    refresh() {
      const bytes = compact(packet);
      writeFileSync(path, bytes);
      policy.packetSha256 = digest(bytes);
      const policyBytes = compact(policy);
      fx.policySha256 = digest(policyBytes);
      writeFileSync(fx.policyPath, policyBytes, { mode: 0o600 });
      fx.envelope = {
        schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1", packetSha256: policy.packetSha256,
        trustPolicySha256: fx.policySha256,
        signatures: approvalRoles.map((role, index) => {
          const pair = keyPairs.get(role), reviewerReference = policy.approvers[index].reviewerReference;
          const keyId = digest(pair.publicKey.export({ type: "spki", format: "der" }));
          const payload = Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" + JSON.stringify([
            fx.policySha256, policy.packetSha256, role, reviewerReference, keyId
          ]));
          return { role, reviewerReference, keyId, signature: sign(null, payload, pair.privateKey).toString("base64") };
        })
      };
      writeFileSync(fx.signaturesPath, compact(fx.envelope), { mode: 0o600 });
    },
    options() {
      return { packetPath: path, policyPath: fx.policyPath, expectedPolicySha256: fx.policySha256,
        signaturesPath: fx.signaturesPath, evidenceDir, now: clock };
    }
  };
  fx.refresh();
  return fx;
}
function rejected(fx, reason, overrides = {}) {
  const result = verifyPilotEvidence({ ...fx.options(), ...overrides });
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.assuranceLevel, "NOT_VERIFIED");
  assert.equal(result.verifiedSignatures, 0);
  assert.equal(result.verifiedArtifacts, 0);
  if (reason) assert.deepEqual(result.reasons, [reason]);
  return result;
}

test("real dual Ed25519 signatures and twelve exact binary files verify without granting release", t => {
  const fx = signedFixture(t);
  assert.deepEqual(verifyPilotEvidence(fx.options()), {
    decision: "READY_FOR_INDEPENDENT_AUTHORIZATION", assuranceLevel: "PINNED_DUAL_SIGNATURES_AND_FILE_DIGESTS",
    reasons: [], verifiedSignatures: 2, verifiedArtifacts: 12
  });
});

test("signing helper matches independently constructed role-bound domain bytes", t => {
  const fx = signedFixture(t), entry = fx.envelope.signatures[0];
  const expected = Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" + JSON.stringify([
    fx.policySha256, fx.policy.packetSha256, entry.role, entry.reviewerReference, entry.keyId
  ]));
  assert.deepEqual(pilotApprovalSigningBytes(fx.policySha256, fx.policy.packetSha256,
    entry.role, entry.reviewerReference, entry.keyId), expected);
  assert.throws(() => pilotApprovalSigningBytes("invalid", fx.policy.packetSha256,
    entry.role, entry.reviewerReference, entry.keyId));
});

test("a consistent metadata packet cannot pass cryptographic verification without signatures", t => {
  const fx = signedFixture(t);
  assert.equal(evaluateAuditPilotGate(fx.packet, { now: fx.clock }).decision, "READY_FOR_INDEPENDENT_AUTHORIZATION");
  rmSync(fx.signaturesPath);
  rejected(fx, "EVIDENCE_INPUT_INVALID");
});

test("changing the packet or replacing an externally pinned policy is rejected", t => {
  const fx = signedFixture(t);
  writeFileSync(fx.path, compact({ ...fx.packet, customerReference: "substituted-customer" }));
  rejected(fx, "PACKET_DIGEST_MISMATCH");
  fx.refresh();
  writeFileSync(fx.policyPath, compact({ ...fx.policy, customerReference: "substituted-customer" }));
  rejected(fx, "TRUST_POLICY_DIGEST_MISMATCH");
});

for (const field of ["customerReference", "sourceCommitSha", "deployedWorkerVersionId"]) {
  test(`independently pinned ${field} prevents cross-context acceptance`, t => {
    const fx = signedFixture(t);
    fx.packet[field] = field === "sourceCommitSha" ? "c".repeat(40) : "different-context-01";
    fx.refresh();
    rejected(fx, "PACKET_CONTEXT_MISMATCH");
  });
}

test("expired, future and overlong trust windows are refused", t => {
  for (const mutation of [
    p => { p.validUntilUtc = new Date(now).toISOString(); },
    p => { p.validFromUtc = new Date(now + 1).toISOString(); },
    p => { p.validUntilUtc = new Date(now + 91 * 86400_000).toISOString(); }
  ]) {
    const fx = signedFixture(t); mutation(fx.policy); fx.refresh();
    rejected(fx, "TRUST_POLICY_WINDOW_INVALID");
  }
});

test("one key or one reviewer cannot fill both independently enrolled roles", t => {
  const fx = signedFixture(t);
  fx.policy.approvers[1].publicKeyPem = fx.policy.approvers[0].publicKeyPem;
  fx.refresh(); rejected(fx, "TRUST_SEPARATION_INVALID");
  const other = signedFixture(t);
  other.policy.approvers[1].reviewerReference = other.policy.approvers[0].reviewerReference;
  other.refresh(); rejected(other, "TRUST_SEPARATION_INVALID");
});

test("private keys and non-Ed25519 public keys cannot enter the trust policy", t => {
  for (const pem of [
    generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).toString()
  ]) {
    const fx = signedFixture(t); fx.policy.approvers[0].publicKeyPem = pem; fx.refresh();
    rejected(fx, "TRUST_KEY_INVALID");
  }
});

test("reviewer declaration must match policy and fall within enrollment validity", t => {
  const fx = signedFixture(t);
  fx.packet.customerSecurityApproval.reviewerReference = "unapproved-reviewer";
  fx.refresh(); rejected(fx, "APPROVER_POLICY_MISMATCH");
  const other = signedFixture(t);
  other.policy.validFromUtc = new Date(now - 1500).toISOString();
  other.refresh(); rejected(other, "APPROVER_POLICY_MISMATCH");
});

test("unknown fields in trust policy and signature envelope fail closed", t => {
  const fx = signedFixture(t); fx.policy.unapproved = true; fx.refresh();
  rejected(fx, "TRUST_POLICY_INVALID");
  const other = signedFixture(t); other.envelope.publicKeyPem = other.policy.approvers[0].publicKeyPem;
  writeFileSync(other.signaturesPath, compact(other.envelope));
  rejected(other, "SIGNATURE_ENVELOPE_INVALID");
});

test("tampered signatures and signatures from an unenrolled key fail", t => {
  for (const replacement of [Buffer.alloc(64), sign(null, Buffer.from("wrong-data"), generateKeyPairSync("ed25519").privateKey)]) {
    const fx = signedFixture(t);
    fx.envelope.signatures[0].signature = replacement.toString("base64");
    writeFileSync(fx.signaturesPath, compact(fx.envelope));
    rejected(fx, "SIGNATURE_INVALID");
  }
});

test("duplicated roles, missing signatures and swapped role signatures fail", t => {
  for (const mutate of [
    e => { e.signatures[1] = e.signatures[0]; },
    e => { e.signatures.pop(); },
    e => { [e.signatures[0].signature, e.signatures[1].signature] = [e.signatures[1].signature, e.signatures[0].signature]; }
  ]) {
    const fx = signedFixture(t); mutate(fx.envelope);
    writeFileSync(fx.signaturesPath, compact(fx.envelope));
    rejected(fx);
  }
});

test("retained signatures cannot replay under a new packet or a new policy pin", t => {
  const fx = signedFixture(t), oldEnvelope = compact(fx.envelope);
  fx.packet.evidence[5].controlledLocator = "changed-evidence-locator";
  fx.refresh(); writeFileSync(fx.signaturesPath, oldEnvelope);
  rejected(fx, "SIGNATURE_ENVELOPE_INVALID");
  const other = signedFixture(t), oldSignatures = structuredClone(other.envelope.signatures);
  other.policy.validUntilUtc = new Date(now + 7200_000).toISOString(); other.refresh();
  other.envelope.signatures = oldSignatures;
  writeFileSync(other.signaturesPath, compact(other.envelope));
  rejected(other, "SIGNATURE_INVALID");
});

test("signed but invalid metadata is still rejected by the existing ten-gate preflight", t => {
  const fx = signedFixture(t);
  fx.packet.evidence[3].evidenceType = "OPERATOR_ATTESTED_PROVIDER_RECEIPT";
  fx.refresh(); rejected(fx, "PACKET_PREFLIGHT_FAILED");
});

test("each gate file and each approval document is actually hashed", t => {
  for (const file of [...REQUIRED_GATES, ...approvalRoles]) {
    const fx = signedFixture(t);
    writeFileSync(join(fx.evidenceDir, `${file}.bin`), "modified-evidence");
    rejected(fx, "ARTIFACT_DIGEST_MISMATCH");
  }
});

test("missing artifacts fail instead of silently treating signed declarations as proof", t => {
  const fx = signedFixture(t);
  rmSync(join(fx.evidenceDir, "LEGAL_RECORDS.bin"));
  rejected(fx, "EVIDENCE_INPUT_INVALID");
});

test("fixed evidence filenames cannot be replaced with locator paths", t => {
  const fx = signedFixture(t);
  fx.packet.evidence[0].controlledLocator = "../../outside";
  fx.refresh(); rejected(fx, "PACKET_PREFLIGHT_FAILED");
});

test("symlinked directories, symlinked files and hard-linked artifacts fail closed", t => {
  const fx = signedFixture(t), dirLink = join(fx.root, "dir-link");
  symlinkSync(fx.evidenceDir, dirLink);
  for (const spelling of [dirLink, dirLink + "/", dirLink + "/."]) {
    rejected(fx, "EVIDENCE_DIRECTORY_INVALID", { evidenceDir: spelling });
  }
  const file = join(fx.evidenceDir, "G01.bin"), other = join(fx.root, "other.bin");
  writeFileSync(other, "symlink-target"); rmSync(file); symlinkSync(other, file);
  rejected(fx, "EVIDENCE_INPUT_INVALID");
  rmSync(file); linkSync(other, file);
  rejected(fx, "EVIDENCE_INPUT_INVALID");
});

test("bounded binary reader supports four MiB artifacts but rejects oversized sparse files", t => {
  const fx = signedFixture(t), file = join(fx.evidenceDir, "G01.bin"), bytes = Buffer.alloc(4 * 1024 * 1024, 255);
  writeFileSync(file, bytes); fx.packet.evidence[0].sha256 = digest(bytes); fx.refresh();
  assert.equal(verifyPilotEvidence(fx.options()).verifiedArtifacts, 12);
  truncateSync(file, 1024 * 1024 * 1024);
  rejected(fx, "EVIDENCE_INPUT_INVALID");
  for (const cap of [0, -1, NaN, Infinity, 1.5, 4 * 1024 * 1024 + 1]) {
    assert.throws(() => readPilotBytes(fx.path, cap), packetError);
  }
});

test("signature verification happens before any evidence directory is inspected", t => {
  const fx = signedFixture(t); fx.envelope.signatures[0].signature = Buffer.alloc(64).toString("base64");
  writeFileSync(fx.signaturesPath, compact(fx.envelope));
  rejected(fx, "SIGNATURE_INVALID", { evidenceDir: join(fx.root, "nonexistent-secret") });
});

test("duplicate JSON keys, pretty encodings, BOM and malformed UTF-8 are rejected", t => {
  for (const change of [
    bytes => Buffer.from(bytes.toString().replace('"schemaVersion":1,', '"schemaVersion":0,"schemaVersion":1,')),
    bytes => Buffer.from(JSON.stringify(JSON.parse(bytes), null, 2) + "\n"),
    bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    bytes => Buffer.concat([Buffer.from([0xff]), bytes])
  ]) {
    const fx = signedFixture(t), bad = change(compact(fx.policy));
    writeFileSync(fx.policyPath, bad); fx.policySha256 = digest(bad);
    rejected(fx);
  }
});

const evidenceCli = fileURLToPath(new URL("./audit-pilot-evidence.mjs", import.meta.url));
function evidenceArgs(fx) {
  return ["--packet", fx.path, "--trust-policy", fx.policyPath,
    "--expected-policy-sha256", fx.policySha256, "--signatures", fx.signaturesPath, "--evidence-dir", fx.evidenceDir];
}
function evidenceChild(args) {
  return spawnSync(process.execPath, [evidenceCli, ...args], { encoding: "utf8", timeout: 5000 });
}

test("real evidence CLI verifies two signatures and twelve files without revealing identifiers", t => {
  const fx = signedFixture(t, Date.now()), child = evidenceChild(evidenceArgs(fx));
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, "");
  assert.equal(JSON.parse(child.stdout).verifiedArtifacts, 12);
  for (const secret of [fx.root, fx.packet.customerReference, fx.policySha256, "BEGIN PUBLIC KEY"]) {
    assert.ok(!child.stdout.includes(secret));
  }
});

test("evidence CLI rejects missing duplicate unknown arguments and gives sanitized nonzero output", t => {
  const fx = signedFixture(t, Date.now());
  const duplicate = evidenceArgs(fx); duplicate[2] = "--packet";
  for (const args of [[], duplicate, [...evidenceArgs(fx), "--now", "0"], ["--secret-path", fx.root]]) {
    const child = evidenceChild(args);
    assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stderr, "");
    assert.equal(JSON.parse(child.stdout).decision, "NO_GO");
    assert.ok(!child.stdout.includes(fx.root));
  }
});

test("real evidence CLI refuses FIFO artifacts without blocking or disclosing raw errors", t => {
  const fx = signedFixture(t, Date.now()), file = join(fx.evidenceDir, "G02.bin");
  rmSync(file);
  const created = spawnSync("mkfifo", [file], { encoding: "utf8", timeout: 5000 });
  assert.equal(created.status, 0);
  const child = evidenceChild(evidenceArgs(fx));
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout).reasons, ["EVIDENCE_INPUT_INVALID"]);
  assert.ok(!child.stdout.includes(fx.root));
});

test("invalid trust pin, invalid clock and unknown JSON types never authorize evidence", t => {
  const fx = signedFixture(t);
  for (const clock of [NaN, Infinity, -1, "today"]) rejected(fx, "EVIDENCE_INPUT_INVALID", { now: clock });
  rejected(fx, "EVIDENCE_INPUT_INVALID", { expectedPolicySha256: undefined });
  for (const value of [null, false, [], 42]) assert.equal(verifyPilotEvidence(value).decision, "NO_GO");
});
