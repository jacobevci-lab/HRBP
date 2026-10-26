import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointKeyId } from "./audit-checkpoint.mjs";
import {
  approveGovernanceProposal,
  createGovernanceApprovalPolicy,
  createGovernanceProposal,
  encodeGovernanceApprovalBundle,
  encodeGovernanceApprovalPolicy,
  governanceApprovalPolicySha256,
  parseGovernanceApprovalBundle,
  parseGovernanceApprovalPolicy,
  runGovernanceApprovalCli,
  verifyGovernanceApprovalBundle
} from "./audit-governance-approval.mjs";

const tenantId="dual-control-tenant";
const deploymentId="dual-control-deployment";
const context={tenantId,deploymentId};
const approver1=generateKeyPairSync("ed25519");
const approver2=generateKeyPairSync("ed25519");
const approver3=generateKeyPairSync("ed25519");
const authority=generateKeyPairSync("ed25519");
const target=generateKeyPairSync("ed25519");
const t0=Date.parse("2026-10-26T09:00:00.000Z");
const policy=createGovernanceApprovalPolicy({
  approverPublicKeys:[approver1.publicKey,approver2.publicKey,approver3.publicKey],
  minApprovals:2,...context,issuedAt:t0-60_000,expiresAt:t0+24*60*60_000
});
const policySha=governanceApprovalPolicySha256(policy);
function proposal(overrides={}) {
  return createGovernanceProposal({
    ...context,operation:"ROTATE_SIGNER",currentGeneration:3,
    currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),
    now:t0,expiresAt:t0+30*60_000,...overrides
  });
}
function bundleWith(...privateKeys) {
  let bundle={proposal:proposal(),approvals:[]};
  privateKeys.forEach((key,index)=>{bundle=approveGovernanceProposal(bundle,key,t0+60_000+index*1000);});
  return bundle;
}
const code=expected=>error=>error?.code===expected;

test("policy and bundle serialization are canonical and contain only public governance material",()=>{
  const encodedPolicy=encodeGovernanceApprovalPolicy(policy);
  assert.deepEqual(parseGovernanceApprovalPolicy(encodedPolicy),policy);
  let bundle=bundleWith(approver1.privateKey,approver2.privateKey);
  const encodedBundle=encodeGovernanceApprovalBundle(bundle);
  assert.deepEqual(parseGovernanceApprovalBundle(encodedBundle),bundle);
  assert.ok(!encodedPolicy.includes("PRIVATE KEY"));
  assert.ok(!encodedBundle.includes(tenantId));
  assert.ok(!encodedBundle.includes(deploymentId));
});

test("one approval never satisfies a two-person policy",()=>{
  const bundle=bundleWith(approver1.privateKey);
  assert.throws(()=>verifyGovernanceApprovalBundle(bundle,policy,{
    ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_QUORUM_UNMET"));
});

test("two distinct approved keys satisfy quorum",()=>{
  const result=verifyGovernanceApprovalBundle(bundleWith(approver1.privateKey,approver2.privateKey),policy,{
    ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  });
  assert.equal(result.approvals,2);
  assert.equal(result.policySha256,policySha);
});

test("same approver cannot sign twice or be counted twice",()=>{
  let bundle={proposal:proposal(),approvals:[]};
  bundle=approveGovernanceProposal(bundle,approver1.privateKey,t0+60_000);
  assert.throws(()=>approveGovernanceProposal(bundle,approver1.privateKey,t0+61_000),
    code("GOVERNANCE_APPROVAL_ALREADY_SIGNED"));
  const duplicated=structuredClone(bundle);
  duplicated.approvals.push(structuredClone(duplicated.approvals[0]));
  assert.throws(()=>parseGovernanceApprovalBundle(encodeGovernanceApprovalBundle(duplicated)));
});

test("untrusted approval key and tampered approval signature fail closed",()=>{
  const outsider=generateKeyPairSync("ed25519");
  const untrusted=bundleWith(approver1.privateKey,outsider.privateKey);
  assert.throws(()=>verifyGovernanceApprovalBundle(untrusted,policy,{
    ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_APPROVER_UNTRUSTED"));

  const tampered=structuredClone(bundleWith(approver1.privateKey,approver2.privateKey));
  tampered.approvals[0].signature=tampered.approvals[1].signature;
  assert.throws(()=>verifyGovernanceApprovalBundle(tampered,policy,{
    ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_SIGNATURE_INVALID"));
});

test("externally pinned policy digest is mandatory",()=>{
  assert.throws(()=>verifyGovernanceApprovalBundle(bundleWith(approver1.privateKey,approver2.privateKey),policy,{
    ...context,expectedPolicySha256:"0".repeat(64),operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_POLICY_DIGEST_MISMATCH"));
});

test("proposal binds exact operation current generation digest and target key",()=>{
  const bundle=bundleWith(approver1.privateKey,approver2.privateKey);
  for(const patch of [
    {operation:"REVOKE_SIGNER"},
    {currentGeneration:4},
    {currentSha256:"b".repeat(64)},
    {targetKeyId:checkpointKeyId(approver3.publicKey)}
  ]){
    assert.throws(()=>verifyGovernanceApprovalBundle(bundle,policy,{
      ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
      currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),
      now:t0+120_000,...patch
    }),code("GOVERNANCE_APPROVAL_PROPOSAL_MISMATCH"));
  }
});

test("expired proposal and inactive policy fail closed",()=>{
  const shortProposal=proposal({expiresAt:t0+60_000});
  let bundle={proposal:shortProposal,approvals:[]};
  bundle=approveGovernanceProposal(bundle,approver1.privateKey,t0+10_000);
  bundle=approveGovernanceProposal(bundle,approver2.privateKey,t0+20_000);
  assert.throws(()=>verifyGovernanceApprovalBundle(bundle,policy,{
    ...context,expectedPolicySha256:policySha,operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_PROPOSAL_EXPIRED"));

  const expiredPolicy=createGovernanceApprovalPolicy({
    approverPublicKeys:[approver1.publicKey,approver2.publicKey],
    minApprovals:2,...context,issuedAt:t0-120_000,expiresAt:t0+30_000
  });
  assert.throws(()=>verifyGovernanceApprovalBundle(bundleWith(approver1.privateKey,approver2.privateKey),expiredPolicy,{
    ...context,expectedPolicySha256:governanceApprovalPolicySha256(expiredPolicy),operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),now:t0+120_000
  }),code("GOVERNANCE_APPROVAL_POLICY_INACTIVE"));
});

test("authority and target signer keys can be explicitly excluded from approval quorum",()=>{
  const mixedPolicy=createGovernanceApprovalPolicy({
    approverPublicKeys:[approver1.publicKey,authority.publicKey,target.publicKey],
    minApprovals:2,...context,issuedAt:t0-60_000,expiresAt:t0+24*60*60_000
  });
  let bundle={proposal:proposal(),approvals:[]};
  bundle=approveGovernanceProposal(bundle,approver1.privateKey,t0+10_000);
  bundle=approveGovernanceProposal(bundle,authority.privateKey,t0+20_000);
  assert.throws(()=>verifyGovernanceApprovalBundle(bundle,mixedPolicy,{
    ...context,expectedPolicySha256:governanceApprovalPolicySha256(mixedPolicy),operation:"ROTATE_SIGNER",
    currentGeneration:3,currentSha256:"a".repeat(64),targetKeyId:checkpointKeyId(target.publicKey),
    forbiddenKeyIds:[checkpointKeyId(authority.publicKey),checkpointKeyId(target.publicKey)],now:t0+30_000
  }),code("GOVERNANCE_APPROVAL_SEPARATION_VIOLATION"));
});

test("offline request approve verify CLI preserves no-overwrite evidence",async()=>{
  const root=mkdtempSync(join(tmpdir(),"hrbp-governance-approval-"));
  try{
    chmodSync(root,0o700);
    const policyPath=join(root,"policy.json");
    const requestPath=join(root,"request.json");
    const approved1Path=join(root,"approved-1.json");
    const approved2Path=join(root,"approved-2.json");
    const key1=join(root,"approver1.pem");
    const key2=join(root,"approver2.pem");
    writeFileSync(policyPath,encodeGovernanceApprovalPolicy(policy),{mode:0o600});
    writeFileSync(key1,approver1.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});chmodSync(key1,0o600);
    writeFileSync(key2,approver2.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});chmodSync(key2,0o600);

    const req=await runGovernanceApprovalCli([
      "request","--tenant-id",tenantId,"--deployment-id",deploymentId,
      "--out",requestPath,"--operation","ROTATE_SIGNER","--current-generation","3",
      "--current-sha256","a".repeat(64),"--target-key-id",checkpointKeyId(target.publicKey),
      "--expires-minutes","30"
    ],()=>t0);
    assert.equal(req.code,"GOVERNANCE_APPROVAL_REQUEST_CREATED");

    await runGovernanceApprovalCli([
      "approve","--tenant-id",tenantId,"--deployment-id",deploymentId,
      "--bundle",requestPath,"--policy",policyPath,"--expected-policy-sha256",policySha,
      "--approver-private-key-file",key1,"--out",approved1Path
    ],()=>t0+10_000);
    await runGovernanceApprovalCli([
      "approve","--tenant-id",tenantId,"--deployment-id",deploymentId,
      "--bundle",approved1Path,"--policy",policyPath,"--expected-policy-sha256",policySha,
      "--approver-private-key-file",key2,"--out",approved2Path
    ],()=>t0+20_000);

    const verified=await runGovernanceApprovalCli([
      "verify","--tenant-id",tenantId,"--deployment-id",deploymentId,
      "--bundle",approved2Path,"--policy",policyPath,"--expected-policy-sha256",policySha,
      "--operation","ROTATE_SIGNER","--current-generation","3",
      "--current-sha256","a".repeat(64),"--target-key-id",checkpointKeyId(target.publicKey)
    ],()=>t0+30_000);
    assert.equal(verified.code,"GOVERNANCE_APPROVAL_VALID");
    assert.equal(verified.approvals,2);
    await assert.rejects(runGovernanceApprovalCli([
      "request","--tenant-id",tenantId,"--deployment-id",deploymentId,
      "--out",requestPath,"--operation","ROTATE_SIGNER","--current-generation","3",
      "--current-sha256","a".repeat(64),"--target-key-id",checkpointKeyId(target.publicKey),
      "--expires-minutes","30"
    ],()=>t0), error => error?.code === "GOVERNANCE_APPROVAL_OUTPUT_EXISTS");
    assert.ok(!readFileSync(approved2Path,"utf8").includes(tenantId));
  }finally{rmSync(root,{recursive:true,force:true});}
});
