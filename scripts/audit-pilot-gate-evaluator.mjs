import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_GATES = Object.freeze([
  "G01","G02","G03","G04","G05","G06","G07","G08","G09","G10"
]);
const SHA = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9]{40}$/;
const DECISIONS = new Set(["PASS","FAIL","MISSING","EXPIRED"]);
const ALLOWED = new Set([
  "schemaVersion","customerReference","sourceCommitSha","deployedWorkerVersionId",
  "decisionAtUtc","nextReviewAtUtc","approvedRetentionUntilUtc",
  "evidence","customerSecurityApproval","recordsLegalApproval"
]);
const MAX_BYTES = 64 * 1024;
const MAX_AGE_MS = 90 * 24 * 3600_000;
function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function keys(x, expected) {
  return isObj(x) && Object.keys(x).length === expected.length &&
    expected.every(k => Object.hasOwn(x,k));
}
function date(x) {
  return typeof x === "string" && Number.isFinite(Date.parse(x)) &&
    new Date(x).toISOString() === x ? Date.parse(x) : null;
}
function ref(x) { return typeof x === "string" && /^[a-zA-Z0-9_-]{8,96}$/.test(x); }
function sha(x) { return typeof x === "string" && SHA.test(x); }
function approved(x, now) {
  return keys(x,["reviewerRole","reviewerReference","approvedAtUtc","evidenceSha256"]) &&
    typeof x.reviewerRole === "string" && x.reviewerRole.length > 3 &&
    ref(x.reviewerReference) && sha(x.evidenceSha256) &&
    date(x.approvedAtUtc) !== null && date(x.approvedAtUtc) <= now &&
    now - date(x.approvedAtUtc) <= MAX_AGE_MS;
}
/**
 * Evaluates the completeness and self-consistency of a declared approval packet.
 * DOES NOT authenticate supporting documents, signatures, operator identity, provider
 * lock enforcement, deployed revision, or approvals. Output is NOT a release authorization.
 */
export function evaluateAuditPilotGate(packet, { now = Date.now() } = {}) {
  const reasons = [];
  if (!Number.isSafeInteger(now) || now < 0 ||
      !isObj(packet) || Object.keys(packet).some(k => !ALLOWED.has(k)) ||
      Object.keys(packet).length !== ALLOWED.size || packet.schemaVersion !== 1) {
    return { decision:"NO_GO", reasons:["PACKET_SCHEMA_INVALID"], passCount:0 };
  }
  if (!ref(packet.customerReference)) reasons.push("CUSTOMER_REFERENCE_INVALID");
  if (typeof packet.sourceCommitSha !== "string" || !VERSION.test(packet.sourceCommitSha) ||
      typeof packet.deployedWorkerVersionId !== "string" ||
      !/^[a-zA-Z0-9._:-]{8,128}$/.test(packet.deployedWorkerVersionId)) {
    reasons.push("DEPLOYMENT_IDENTITY_MISSING");
  }
  const decisionAt = date(packet.decisionAtUtc);
  const nextReview = date(packet.nextReviewAtUtc);
  const retention = date(packet.approvedRetentionUntilUtc);
  if (decisionAt === null || decisionAt > now || now - decisionAt > MAX_AGE_MS ||
      nextReview === null || nextReview <= now || nextReview <= decisionAt ||
      retention === null || retention <= now) reasons.push("DECISION_WINDOW_INVALID");

  const entries = packet.evidence;
  let passCount = 0;
  if (!Array.isArray(entries) || entries.length !== REQUIRED_GATES.length ||
      new Set(entries.map(e=>e?.gate)).size !== REQUIRED_GATES.length) {
    reasons.push("GATE_INVENTORY_INVALID");
  } else {
    for (const gate of REQUIRED_GATES) {
      const e = entries.find(item=>item?.gate === gate);
      if (!keys(e,["gate","status","sha256","controlledLocator","reviewerRole","reviewerReference","reviewedAtUtc","evidenceType"]) ||
          !DECISIONS.has(e.status) || !sha(e.sha256) ||
          !ref(e.controlledLocator) || !ref(e.reviewerReference) ||
          typeof e.reviewerRole !== "string" || e.reviewerRole.length < 4 ||
          !ref(e.evidenceType) || date(e.reviewedAtUtc) === null ||
          date(e.reviewedAtUtc) > now || now - date(e.reviewedAtUtc) > MAX_AGE_MS) {
        reasons.push(gate + "_EVIDENCE_INVALID");
      } else if (e.status !== "PASS") {
        reasons.push(gate + "_NOT_PASS");
      } else {
        passCount++;
        if (gate === "G01" && e.evidenceType !== "DEPLOYED_REVISION_READBACK") reasons.push("G01_PROVENANCE_TYPE_INVALID");
        if (gate === "G03" && e.evidenceType !== "APPROVED_TSA_RFC3161") reasons.push("G03_TSA_TYPE_INVALID");
        if (gate === "G04" && e.evidenceType !== "INDEPENDENT_PROVIDER_LOCK_READBACK") reasons.push("G04_PROVIDER_PROOF_MISSING");
      }
    }
  }
  const sec = packet.customerSecurityApproval;
  const legal = packet.recordsLegalApproval;
  if (!approved(sec,now) || sec.reviewerRole !== "CUSTOMER_SECURITY") reasons.push("SECURITY_APPROVAL_MISSING");
  if (!approved(legal,now) || legal.reviewerRole !== "LEGAL_RECORDS") reasons.push("LEGAL_APPROVAL_MISSING");
  if (approved(sec,now) && approved(legal,now) &&
      sec.reviewerReference === legal.reviewerReference) reasons.push("APPROVAL_SEPARATION_MISSING");
  return { decision:reasons.length ? "NO_GO" : "READY_FOR_INDEPENDENT_AUTHORIZATION",
    reasons, passCount };
}
export function parsePilotPacket(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > MAX_BYTES) throw Error("PACKET_INVALID");
  try { return JSON.parse(input); } catch { throw Error("PACKET_INVALID"); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error("PACKET_INVALID");
    const result = evaluateAuditPilotGate(parsePilotPacket(readFileSync(process.argv[2],"utf8")));
    console.log(JSON.stringify(result));
    if (result.decision !== "READY_FOR_INDEPENDENT_AUTHORIZATION") process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({decision:"NO_GO",reasons:["PACKET_INVALID"],passCount:0}));
    process.exitCode = 1;
  }
}
