import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditPilotGate, parsePilotPacket, REQUIRED_GATES } from "./audit-pilot-gate-evaluator.mjs";

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
