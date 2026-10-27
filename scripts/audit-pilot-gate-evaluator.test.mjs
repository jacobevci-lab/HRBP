import assert from "node:assert/strict";
import test from "node:test";
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
