import {
  createHash, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign, verify
} from "node:crypto";
import {
  closeSync, fstatSync, fsyncSync, openSync, writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { checkpointKeyId, checkpointSubject, readCheckpointFile } from "./audit-checkpoint.mjs";

const POLICY_SCOPE = "AUDIT_TRUST_DUAL_CONTROL_POLICY";
const PROPOSAL_SCOPE = "AUDIT_TRUST_CHANGE_PROPOSAL";
const APPROVAL_DOMAIN = "HRBP-AUDIT-TRUST-APPROVAL:1\n";
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATIONS = new Set([
  "INIT_SIGNER", "ROTATE_SIGNER", "REVOKE_SIGNER",
  "INIT_AUTHORITY", "ROTATE_AUTHORITY", "RECOVER_AUTHORITY"
]);
const MAX_FILE = 65_536;
const MAX_APPROVERS = 16;
const MAX_PROPOSAL_AGE_MS = 7 * 24 * 60 * 60_000;

class GovernanceApprovalError extends Error {
  constructor(code) {
    super("Audit trust governance approval operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "GOVERNANCE_APPROVAL_INPUT_INVALID") { throw new GovernanceApprovalError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("GOVERNANCE_APPROVAL_KEY_INVALID");
  }
  return key;
}
function strictIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail();
  return value;
}
function publicKeyFromSpki(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("GOVERNANCE_APPROVAL_KEY_INVALID");
  try {
    const der = Buffer.from(value, "base64");
    if (der.toString("base64") !== value) fail("GOVERNANCE_APPROVAL_KEY_INVALID");
    return keyOf(createPublicKey({ key: der, format: "der", type: "spki" }), "public");
  } catch (error) {
    if (error instanceof GovernanceApprovalError) throw error;
    fail("GOVERNANCE_APPROVAL_KEY_INVALID");
  }
}
function publicKeySpki(publicKey) {
  return keyOf(publicKey, "public").export({ format: "der", type: "spki" }).toString("base64");
}
function policyOf(value) {
  exactKeys(value, ["version","scope","subject","issuedAt","expiresAt","minApprovals","approvers"]);
  if (value.version !== 1 || value.scope !== POLICY_SCOPE ||
      typeof value.subject !== "string" || !HASH.test(value.subject)) fail();
  const issuedAt = strictIso(value.issuedAt);
  const expiresAt = strictIso(value.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) fail();
  if (!Number.isSafeInteger(value.minApprovals) || value.minApprovals < 2 || value.minApprovals > 5) fail();
  if (!Array.isArray(value.approvers) || value.approvers.length < value.minApprovals ||
      value.approvers.length > MAX_APPROVERS) fail();
  const approvers = value.approvers.map(entry => {
    exactKeys(entry, ["keyId","publicKeySpki","role","status"]);
    if (entry.role !== "TRUST_GOVERNANCE_APPROVER" || entry.status !== "ACTIVE" ||
        typeof entry.keyId !== "string" || !HASH.test(entry.keyId)) fail();
    const publicKey = publicKeyFromSpki(entry.publicKeySpki);
    if (checkpointKeyId(publicKey) !== entry.keyId) fail("GOVERNANCE_APPROVAL_KEY_ID_MISMATCH");
    return {
      keyId: entry.keyId, publicKeySpki: entry.publicKeySpki,
      role: "TRUST_GOVERNANCE_APPROVER", status: "ACTIVE"
    };
  });
  if (new Set(approvers.map(entry => entry.keyId)).size !== approvers.length) {
    fail("GOVERNANCE_APPROVAL_DUPLICATE_APPROVER");
  }
  return {
    version: 1, scope: POLICY_SCOPE, subject: value.subject,
    issuedAt, expiresAt, minApprovals: value.minApprovals, approvers
  };
}
function proposalOf(value) {
  exactKeys(value, [
    "version","scope","subject","requestId","operation","currentGeneration",
    "currentSha256","targetKeyId","createdAt","expiresAt"
  ]);
  if (value.version !== 1 || value.scope !== PROPOSAL_SCOPE ||
      typeof value.subject !== "string" || !HASH.test(value.subject) ||
      typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
      !OPERATIONS.has(value.operation) ||
      !Number.isSafeInteger(value.currentGeneration) || value.currentGeneration < 0 || value.currentGeneration > 999999 ||
      typeof value.targetKeyId !== "string" || !HASH.test(value.targetKeyId)) fail();
  if (value.currentGeneration === 0 ? value.currentSha256 !== null :
      typeof value.currentSha256 !== "string" || !HASH.test(value.currentSha256)) fail();
  const createdAt = strictIso(value.createdAt), expiresAt = strictIso(value.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt) ||
      Date.parse(expiresAt) - Date.parse(createdAt) > MAX_PROPOSAL_AGE_MS) fail();
  return {
    version: 1, scope: PROPOSAL_SCOPE, subject: value.subject, requestId: value.requestId,
    operation: value.operation, currentGeneration: value.currentGeneration,
    currentSha256: value.currentSha256, targetKeyId: value.targetKeyId, createdAt, expiresAt
  };
}
function approvalOf(value) {
  exactKeys(value, ["approverKeyId","proposalSha256","approvedAt","signature"]);
  if (typeof value.approverKeyId !== "string" || !HASH.test(value.approverKeyId) ||
      typeof value.proposalSha256 !== "string" || !HASH.test(value.proposalSha256)) fail();
  const approvedAt = strictIso(value.approvedAt);
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature) ||
      Buffer.from(value.signature, "base64").toString("base64") !== value.signature) fail();
  return {
    approverKeyId: value.approverKeyId, proposalSha256: value.proposalSha256,
    approvedAt, signature: value.signature
  };
}
function bundleOf(value) {
  exactKeys(value, ["proposal","approvals"]);
  const proposal = proposalOf(value.proposal);
  if (!Array.isArray(value.approvals) || value.approvals.length > MAX_APPROVERS) fail();
  const approvals = value.approvals.map(approvalOf);
  if (new Set(approvals.map(entry => entry.approverKeyId)).size !== approvals.length) {
    fail("GOVERNANCE_APPROVAL_DUPLICATE_APPROVER");
  }
  return { proposal, approvals };
}
export function encodeGovernanceApprovalPolicy(value) { return JSON.stringify(policyOf(value)) + "\n"; }
export function parseGovernanceApprovalPolicy(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE) fail();
  let value;
  try { value = policyOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeGovernanceApprovalPolicy(value)) fail();
  return value;
}
export function governanceApprovalPolicySha256(value) {
  return digest(encodeGovernanceApprovalPolicy(value));
}
export function encodeGovernanceApprovalBundle(value) { return JSON.stringify(bundleOf(value)) + "\n"; }
export function parseGovernanceApprovalBundle(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE) fail();
  let value;
  try { value = bundleOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeGovernanceApprovalBundle(value)) fail();
  return value;
}
function proposalBytes(proposal) { return Buffer.from(JSON.stringify(proposalOf(proposal))); }
function approvalBytes(proposalSha256, approvedAt) {
  return Buffer.from(APPROVAL_DOMAIN + JSON.stringify({ proposalSha256, approvedAt }));
}

export function createGovernanceApprovalPolicy({ approverPublicKeys, minApprovals, tenantId, deploymentId,
  issuedAt, expiresAt }) {
  if (!Array.isArray(approverPublicKeys)) fail();
  return policyOf({
    version: 1, scope: POLICY_SCOPE, subject: checkpointSubject({ tenantId, deploymentId }),
    issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    minApprovals,
    approvers: approverPublicKeys.map(publicKey => ({
      keyId: checkpointKeyId(keyOf(publicKey, "public")),
      publicKeySpki: publicKeySpki(publicKey),
      role: "TRUST_GOVERNANCE_APPROVER", status: "ACTIVE"
    }))
  });
}
export function createGovernanceProposal({ tenantId, deploymentId, operation, currentGeneration,
  currentSha256, targetKeyId, expiresAt, now = Date.now(), requestId = randomUUID() }) {
  if (!Number.isSafeInteger(now) || now < 0) fail();
  return proposalOf({
    version: 1, scope: PROPOSAL_SCOPE, subject: checkpointSubject({ tenantId, deploymentId }),
    requestId, operation, currentGeneration, currentSha256, targetKeyId,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(expiresAt).toISOString()
  });
}
export function approveGovernanceProposal(bundle, approverPrivateKey, now = Date.now()) {
  keyOf(approverPrivateKey, "private");
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const current = bundleOf(bundle);
  const publicKey = keyOf(createPublicKey(approverPrivateKey), "public");
  const approverKeyId = checkpointKeyId(publicKey);
  if (current.approvals.some(entry => entry.approverKeyId === approverKeyId)) {
    fail("GOVERNANCE_APPROVAL_ALREADY_SIGNED");
  }
  const proposalSha256 = digest(proposalBytes(current.proposal));
  const approvedAt = new Date(now).toISOString();
  if (Date.parse(approvedAt) < Date.parse(current.proposal.createdAt) - 30_000 ||
      Date.parse(approvedAt) > Date.parse(current.proposal.expiresAt)) {
    fail("GOVERNANCE_APPROVAL_OUTSIDE_WINDOW");
  }
  return bundleOf({
    proposal: current.proposal,
    approvals: [...current.approvals, {
      approverKeyId, proposalSha256, approvedAt,
      signature: sign(null, approvalBytes(proposalSha256, approvedAt), approverPrivateKey).toString("base64")
    }]
  });
}
export function verifyGovernanceApprovalBundle(bundle, policy, {
  expectedPolicySha256, tenantId, deploymentId, operation, currentGeneration,
  currentSha256, targetKeyId, forbiddenKeyIds = [], now = Date.now(), effectiveAt = null
}) {
  const approved = bundleOf(bundle), trusted = policyOf(policy);
  if (typeof expectedPolicySha256 !== "string" || !HASH.test(expectedPolicySha256) ||
      governanceApprovalPolicySha256(trusted) !== expectedPolicySha256) {
    fail("GOVERNANCE_APPROVAL_POLICY_DIGEST_MISMATCH");
  }
  if (!Number.isSafeInteger(now) || now < 0 ||
      (effectiveAt !== null && (!Number.isSafeInteger(effectiveAt) || effectiveAt < 0))) fail();
  const expectedSubject = checkpointSubject({ tenantId, deploymentId });
  if (trusted.subject !== expectedSubject || approved.proposal.subject !== expectedSubject) {
    fail("GOVERNANCE_APPROVAL_SUBJECT_MISMATCH");
  }
  const policyStart = Date.parse(trusted.issuedAt), policyEnd = Date.parse(trusted.expiresAt);
  const proposal = approved.proposal;
  const proposalStart = Date.parse(proposal.createdAt), proposalEnd = Date.parse(proposal.expiresAt);
  if (proposalStart < policyStart - 30_000 || proposalEnd > policyEnd) {
    fail("GOVERNANCE_APPROVAL_POLICY_WINDOW_MISMATCH");
  }
  const referenceAt = effectiveAt ?? now;
  if (referenceAt > now + 30_000) fail("GOVERNANCE_APPROVAL_FUTURE_EFFECTIVE_TIME");
  if (policyStart > referenceAt + 30_000 || policyEnd < referenceAt) {
    fail("GOVERNANCE_APPROVAL_POLICY_INACTIVE");
  }
  if (proposal.operation !== operation || proposal.currentGeneration !== currentGeneration ||
      proposal.currentSha256 !== currentSha256 || proposal.targetKeyId !== targetKeyId) {
    fail("GOVERNANCE_APPROVAL_PROPOSAL_MISMATCH");
  }
  if (proposalStart > referenceAt + 30_000 || proposalEnd < referenceAt) {
    fail("GOVERNANCE_APPROVAL_PROPOSAL_EXPIRED");
  }
  const forbidden = new Set(forbiddenKeyIds);
  const proposalSha256 = digest(proposalBytes(proposal));
  const approverMap = new Map(trusted.approvers.map(entry => [entry.keyId, entry]));
  let validApprovals = 0;
  for (const approval of approved.approvals) {
    if (approval.proposalSha256 !== proposalSha256) fail("GOVERNANCE_APPROVAL_PROPOSAL_DIGEST_MISMATCH");
    const approver = approverMap.get(approval.approverKeyId);
    if (!approver) fail("GOVERNANCE_APPROVAL_APPROVER_UNTRUSTED");
    if (forbidden.has(approval.approverKeyId)) fail("GOVERNANCE_APPROVAL_SEPARATION_VIOLATION");
    const approvedAt = Date.parse(approval.approvedAt);
    if (approvedAt < proposalStart - 30_000 || approvedAt > proposalEnd ||
        approvedAt < policyStart - 30_000 || approvedAt > policyEnd) {
      fail("GOVERNANCE_APPROVAL_OUTSIDE_WINDOW");
    }
    if (approvedAt > referenceAt + 30_000) fail("GOVERNANCE_APPROVAL_AFTER_EFFECTIVE_TIME");
    if (!verify(null, approvalBytes(proposalSha256, approval.approvedAt),
        publicKeyFromSpki(approver.publicKeySpki), Buffer.from(approval.signature, "base64"))) {
      fail("GOVERNANCE_APPROVAL_SIGNATURE_INVALID");
    }
    validApprovals += 1;
  }
  if (validApprovals < trusted.minApprovals) fail("GOVERNANCE_APPROVAL_QUORUM_UNMET");
  return {
    proposal,
    policySha256: expectedPolicySha256,
    approvals: validApprovals,
    effectiveAt: new Date(referenceAt).toISOString()
  };
}

function writeNoReplace(path, text) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, text); fsyncSync(fd);
  } catch (error) {
    fail(error?.code === "EEXIST" ? "GOVERNANCE_APPROVAL_OUTPUT_EXISTS" : "GOVERNANCE_APPROVAL_WRITE_FAILED");
  } finally { if (fd !== undefined) closeSync(fd); }
  const dir = openSync(dirname(path), "r");
  try { if (!fstatSync(dir).isDirectory()) fail(); fsyncSync(dir); }
  finally { closeSync(dir); }
}
function readPrivateKey(path) {
  const pem = readCheckpointFile(path, { privateKey: true, maxBytes: 16_384 });
  try { return keyOf(createPrivateKey(pem), "private"); }
  finally { pem.fill(0); }
}
function readPolicy(path) {
  return parseGovernanceApprovalPolicy(readCheckpointFile(path, { maxBytes: MAX_FILE }).toString("utf8"));
}
function readBundle(path) {
  return parseGovernanceApprovalBundle(readCheckpointFile(path, { maxBytes: MAX_FILE }).toString("utf8"));
}
function flags(argv, command) {
  const allowed = new Set([
    "--tenant-id","--deployment-id","--out",
    ...(command === "request" ? [
      "--operation","--current-generation","--current-sha256","--target-key-id","--expires-minutes"
    ] : []),
    ...(command === "approve" ? [
      "--bundle","--policy","--expected-policy-sha256","--approver-private-key-file"
    ] : []),
    ...(command === "verify" ? [
      "--bundle","--policy","--expected-policy-sha256","--operation","--current-generation",
      "--current-sha256","--target-key-id","--forbidden-key-id"
    ] : [])
  ]);
  const values = {};
  for (let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if (!allowed.has(flag) || (flag !== "--forbidden-key-id" && Object.hasOwn(values,flag))) fail();
    const value=argv[++i];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    if (flag === "--forbidden-key-id") {
      values[flag] = [...(values[flag] ?? []), value];
    } else values[flag]=value;
  }
  return values;
}
function integer(value,min,max) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  const parsed=Number(value);
  if (!Number.isSafeInteger(parsed) || parsed<min || parsed>max) fail();
  return parsed;
}
export async function runGovernanceApprovalCli(argv, clock = Date.now) {
  const [command,...rest]=argv;
  if (!["request","approve","verify"].includes(command)) fail();
  const values=flags(rest,command);
  const required=["--tenant-id","--deployment-id",...(command==="request"
    ? ["--out","--operation","--current-generation","--target-key-id","--expires-minutes"]
    : command==="approve"
      ? ["--bundle","--policy","--expected-policy-sha256","--approver-private-key-file","--out"]
      : ["--bundle","--policy","--expected-policy-sha256","--operation","--current-generation","--target-key-id"])];
  if (required.some(flag=>!values[flag])) fail();
  const context={tenantId:values["--tenant-id"],deploymentId:values["--deployment-id"]};
  checkpointSubject(context);
  if (command==="request") {
    const currentGeneration=integer(values["--current-generation"],0,999999);
    const currentSha256=currentGeneration===0?null:values["--current-sha256"];
    if (currentGeneration>0 && (!currentSha256 || !HASH.test(currentSha256))) fail();
    const minutes=integer(values["--expires-minutes"],1,7*24*60);
    const now=clock();
    const proposal=createGovernanceProposal({
      ...context,operation:values["--operation"],currentGeneration,currentSha256,
      targetKeyId:values["--target-key-id"],now,expiresAt:now+minutes*60_000
    });
    writeNoReplace(values["--out"],encodeGovernanceApprovalBundle({proposal,approvals:[]}));
    return {ok:true,code:"GOVERNANCE_APPROVAL_REQUEST_CREATED",requestId:proposal.requestId};
  }
  const policy=readPolicy(values["--policy"]);
  if (governanceApprovalPolicySha256(policy)!==values["--expected-policy-sha256"]) {
    fail("GOVERNANCE_APPROVAL_POLICY_DIGEST_MISMATCH");
  }
  if (command==="approve") {
    if (!values["--out"] || !values["--approver-private-key-file"]) fail();
    const next=approveGovernanceProposal(readBundle(values["--bundle"]),
      readPrivateKey(values["--approver-private-key-file"]),clock());
    writeNoReplace(values["--out"],encodeGovernanceApprovalBundle(next));
    return {ok:true,code:"GOVERNANCE_APPROVAL_ADDED",approvals:next.approvals.length};
  }
  const bundle=readBundle(values["--bundle"]);
  const currentGeneration=integer(values["--current-generation"],0,999999);
  const result=verifyGovernanceApprovalBundle(bundle,policy,{
    ...context,expectedPolicySha256:values["--expected-policy-sha256"],
    operation:values["--operation"],currentGeneration,
    currentSha256:currentGeneration===0?null:values["--current-sha256"],
    targetKeyId:values["--target-key-id"],
    forbiddenKeyIds:values["--forbidden-key-id"]??[],now:clock()
  });
  return {ok:true,code:"GOVERNANCE_APPROVAL_VALID",requestId:result.proposal.requestId,approvals:result.approvals};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runGovernanceApprovalCli(process.argv.slice(2)))); }
  catch(error) {
    console.error(JSON.stringify({ok:false,code:error instanceof GovernanceApprovalError?error.code:"GOVERNANCE_APPROVAL_OPERATION_FAILED"}));
    process.exitCode=1;
  }
}
