import { createHash, createPublicKey, verify } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateAuditPilotGate, readPilotBytes, REQUIRED_GATES } from "./audit-pilot-gate-evaluator.mjs";

import { S3_RETENTION_PROFILE, S3RetentionError, validateS3RetentionRequirements, validateS3RetentionObservation } from "./audit-pilot-s3-retention.mjs";

const ROLES = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
const POLICY_SCOPE = "HRBP_AUDIT_PILOT_TRUST:1";
const SIGNATURE_SCOPE = "HRBP_AUDIT_PILOT_SIGNATURES:1";
const DOMAIN = "HRBP-AUDIT-PILOT-APPROVAL:1\n";
const MAX_ARTIFACT = 4 * 1024 * 1024;
const NINETY_DAYS = 90 * 86400_000;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ref = value => typeof value === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(value);
function exact(value, names) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function date(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value ? Date.parse(value) : null;
}
class EvidenceError extends Error {
  constructor(code) { super("Pilot evidence verification failed."); this.code = code; }
}
function fail(code) { throw new EvidenceError(code); }
function compactJson(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  // Exact compact encoding rejects duplicate keys/BOM/ambiguous numeric spellings.
  // This is NOT RFC 8785: field order is preserved and exact file bytes are signed.
  if (text !== JSON.stringify(value) + "\n") fail("EVIDENCE_JSON_INVALID");
  return value;
}

/** Pure byte-format helper, NOT a signing service or an approval decision. */
export function pilotApprovalSigningBytes(policySha256, packetSha256, role, reviewerReference, keyId) {
  if (!sha(policySha256) || !sha(packetSha256) || !ROLES.includes(role) ||
      !ref(reviewerReference) || !sha(keyId)) fail("APPROVAL_BINDING_INVALID");
  return Buffer.from(DOMAIN + JSON.stringify([policySha256, packetSha256, role, reviewerReference, keyId]));
}

function policyKeys(policy, now) {
  const retention = policy?.schemaVersion === 2;
  if (!exact(policy, ["schemaVersion", "scope", "packetSha256", "customerReference",
    "sourceCommitSha", "deployedWorkerVersionId", "validFromUtc", "validUntilUtc", "approvers",
      ...(retention ? ["retentionRequirements"] : [])]) ||
      ![1, 2].includes(policy.schemaVersion) ||
      policy.scope !== (retention ? "HRBP_AUDIT_PILOT_TRUST:2" : POLICY_SCOPE) || !sha(policy.packetSha256) ||
      !ref(policy.customerReference) || typeof policy.sourceCommitSha !== "string" ||
      !/^[a-f0-9]{40}$/.test(policy.sourceCommitSha) || typeof policy.deployedWorkerVersionId !== "string" ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(policy.deployedWorkerVersionId) ||
      !Array.isArray(policy.approvers) || policy.approvers.length !== 2) fail("TRUST_POLICY_INVALID");
  if (retention) validateS3RetentionRequirements(policy.retentionRequirements);
  const from = date(policy.validFromUtc), until = date(policy.validUntilUtc);
  if (from === null || until === null || from > now || until <= now ||
      until <= from || until - from > NINETY_DAYS) fail("TRUST_POLICY_WINDOW_INVALID");
  const keys = new Map();
  for (const entry of policy.approvers) {
    if (!exact(entry, ["role", "reviewerReference", "publicKeyPem"]) ||
        !ROLES.includes(entry.role) || keys.has(entry.role) || !ref(entry.reviewerReference) ||
        typeof entry.publicKeyPem !== "string" || entry.publicKeyPem.length > 1024 ||
        !entry.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----\n")) fail("TRUST_KEY_INVALID");
    const key = createPublicKey({ key: entry.publicKeyPem, format: "pem", type: "spki" });
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
        key.export({ type: "spki", format: "pem" }).toString() !== entry.publicKeyPem) fail("TRUST_KEY_INVALID");
    keys.set(entry.role, {
      key, reviewerReference: entry.reviewerReference,
      keyId: hash(key.export({ type: "spki", format: "der" }))
    });
  }
  const a = keys.get(ROLES[0]), b = keys.get(ROLES[1]);
  if (!a || !b || a.keyId === b.keyId || a.reviewerReference === b.reviewerReference) {
    fail("TRUST_SEPARATION_INVALID");
  }
  return keys;
}
function signatureCheck(envelope, keys, packetSha256, policySha256) {
  if (!exact(envelope, ["schemaVersion", "scope", "packetSha256", "trustPolicySha256", "signatures"]) ||
      envelope.schemaVersion !== 1 || envelope.scope !== SIGNATURE_SCOPE ||
      envelope.packetSha256 !== packetSha256 || envelope.trustPolicySha256 !== policySha256 ||
      !Array.isArray(envelope.signatures) || envelope.signatures.length !== 2) fail("SIGNATURE_ENVELOPE_INVALID");
  const seen = new Set();
  for (const entry of envelope.signatures) {
    if (!exact(entry, ["role", "reviewerReference", "keyId", "signature"]) ||
        !ROLES.includes(entry.role) || seen.has(entry.role)) fail("SIGNATURE_ENVELOPE_INVALID");
    seen.add(entry.role);
    const trusted = keys.get(entry.role);
    if (entry.reviewerReference !== trusted.reviewerReference || entry.keyId !== trusted.keyId ||
        typeof entry.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(entry.signature)) fail("SIGNATURE_INVALID");
    const bytes = Buffer.from(entry.signature, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== entry.signature ||
        !verify(null, pilotApprovalSigningBytes(policySha256, packetSha256, entry.role,
          entry.reviewerReference, entry.keyId), trusted.key, bytes)) fail("SIGNATURE_INVALID");
  }
}

/** Offline verifier. No provider APIs, key enrollment, private-key reads or deployment. */
export function verifyPilotEvidence(options) {
  try {
    if (!options || typeof options !== "object" || Array.isArray(options)) fail("EVIDENCE_INPUT_INVALID");
    const { packetPath, policyPath, expectedPolicySha256, signaturesPath, evidenceDir, requiredRetentionProfile, now = Date.now() } = options;
    if (!Number.isSafeInteger(now) || now < 0 || !sha(expectedPolicySha256)) fail("EVIDENCE_INPUT_INVALID");
    const policyBytes = readPilotBytes(policyPath, 16 * 1024);
    if (hash(policyBytes) !== expectedPolicySha256) fail("TRUST_POLICY_DIGEST_MISMATCH");
    const policy = compactJson(policyBytes);
    const keys = policyKeys(policy, now);
    if (requiredRetentionProfile !== undefined &&
        (requiredRetentionProfile !== S3_RETENTION_PROFILE || policy.schemaVersion !== 2)) {
      fail("RETENTION_PROFILE_REQUIRED");
    }
    const packetBytes = readPilotBytes(packetPath);
    if (hash(packetBytes) !== policy.packetSha256) fail("PACKET_DIGEST_MISMATCH");
    const packet = compactJson(packetBytes);
    if (evaluateAuditPilotGate(packet, { now }).decision !== "READY_FOR_INDEPENDENT_AUTHORIZATION") {
      fail("PACKET_PREFLIGHT_FAILED");
    }
    for (const field of ["customerReference", "sourceCommitSha", "deployedWorkerVersionId"]) {
      if (packet[field] !== policy[field]) fail("PACKET_CONTEXT_MISMATCH");
    }
    const approvals = [packet.customerSecurityApproval, packet.recordsLegalApproval];
    for (const approval of approvals) {
      if (approval.reviewerReference !== keys.get(approval.reviewerRole).reviewerReference ||
          date(approval.approvedAtUtc) < date(policy.validFromUtc)) fail("APPROVER_POLICY_MISMATCH");
    }
    // Verify both role-bound signatures BEFORE opening any evidence files.
    signatureCheck(compactJson(readPilotBytes(signaturesPath, 4096)), keys, policy.packetSha256, expectedPolicySha256);
    if (typeof evidenceDir !== "string" || !evidenceDir || evidenceDir.includes("\0")) fail("EVIDENCE_DIRECTORY_INVALID");
    const directory = resolve(evidenceDir);
    const before = lstatSync(directory, { bigint: true });
    if (!before.isDirectory()) fail("EVIDENCE_DIRECTORY_INVALID");
    // The packet's controlledLocator is metadata only, never a filesystem path or URL.
    const artifacts = REQUIRED_GATES.map(gate => ({
      name: `${gate}.bin`, digest: packet.evidence.find(entry => entry.gate === gate).sha256
    })).concat(approvals.map(approval => ({
      name: `${approval.reviewerRole}.bin`, digest: approval.evidenceSha256
    })));
    const retentionBytes = new Map();
    for (const artifact of artifacts) {
      const bytes = readPilotBytes(join(directory, artifact.name), MAX_ARTIFACT);
      if (hash(bytes) !== artifact.digest) fail("ARTIFACT_DIGEST_MISMATCH");
      if (policy.schemaVersion === 2 && ["G04.bin", "G05.bin"].includes(artifact.name)) {
        retentionBytes.set(artifact.name, bytes);
      }
    }
    const after = lstatSync(directory, { bigint: true });
    if (!after.isDirectory() || ["dev", "ino", "mode", "mtimeNs", "ctimeNs"].some(field => before[field] !== after[field])) {
      fail("EVIDENCE_DIRECTORY_CHANGED");
    }
    let retentionResult;
    if (policy.schemaVersion === 2) {
      // Parse the very same authenticated bytes; never reopen G04/G05 by path.
      const observed = retentionBytes.get("G04.bin");
      if (observed.length > 32 * 1024) fail("S3_OBSERVATION_SCHEMA_INVALID");
      const archive = retentionBytes.get("G05.bin");
      retentionResult = validateS3RetentionObservation(compactJson(observed), policy.retentionRequirements, {
        now, reviewedAtUtc: packet.evidence.find(entry => entry.gate === "G04").reviewedAtUtc,
        approvedRetentionUntilUtc: packet.approvedRetentionUntilUtc,
        archiveSha256: hash(archive), archiveSizeBytes: archive.length
      });
    }
    return {
      decision: "READY_FOR_INDEPENDENT_AUTHORIZATION",
      assuranceLevel: retentionResult ? "PINNED_SIGNATURES_DIGESTS_AND_S3_OBSERVATION_SEMANTICS" : "PINNED_DUAL_SIGNATURES_AND_FILE_DIGESTS",
      reasons: [], verifiedSignatures: 2, verifiedArtifacts: 12,
      ...(retentionResult ? { retention: retentionResult } : {})
    };
  } catch (error) {
    return {
      decision: "NO_GO", assuranceLevel: "NOT_VERIFIED",
      reasons: [(error instanceof EvidenceError || error instanceof S3RetentionError) ? error.code : "EVIDENCE_INPUT_INVALID"],
      verifiedSignatures: 0, verifiedArtifacts: 0
    };
  }
}

function cliOptions(argv) {
  const flags = new Map([
    ["--packet", "packetPath"], ["--trust-policy", "policyPath"],
    ["--expected-policy-sha256", "expectedPolicySha256"],
    ["--signatures", "signaturesPath"], ["--evidence-dir", "evidenceDir"],
    ["--require-retention-profile", "requiredRetentionProfile"]
  ]);
  if (![10, 12].includes(argv.length)) fail("EVIDENCE_INPUT_INVALID");
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = flags.get(argv[index]), value = argv[index + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith("--") || value.includes("\0")) {
      fail("EVIDENCE_INPUT_INVALID");
    }
    options[name] = value;
  }
  if (["packetPath", "policyPath", "expectedPolicySha256", "signaturesPath", "evidenceDir"].some(name => !Object.hasOwn(options, name))) {
    fail("EVIDENCE_INPUT_INVALID");
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { result = verifyPilotEvidence(cliOptions(process.argv.slice(2))); }
  catch { result = verifyPilotEvidence(null); }
  console.log(JSON.stringify(result));
  if (result.decision !== "READY_FOR_INDEPENDENT_AUTHORIZATION") process.exitCode = 1;
}
