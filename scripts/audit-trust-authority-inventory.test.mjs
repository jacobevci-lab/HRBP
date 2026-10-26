import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointKeyId } from "./audit-checkpoint.mjs";
import {
  approveGovernanceProposal,
  createGovernanceApprovalPolicy,
  createGovernanceProposal,
  encodeGovernanceApprovalBundle,
  encodeGovernanceApprovalPolicy,
  governanceApprovalPolicySha256
} from "./audit-governance-approval.mjs";
import {
  authorityTrustInventorySha256,
  createInitialAuthorityTrustInventory,
  encodeAuthorityTrustInventory,
  parseAuthorityTrustInventory,
  readAuthorityTrustInventoryChain,
  recoverAuthorityTrustInventory,
  resolveTrustAuthority,
  rotateAuthorityTrustInventory,
  runAuthorityTrustInventoryCli,
  verifyAuthorityTrustInventoryChain,
  writeAuthorityTrustInventoryGeneration
} from "./audit-trust-authority-inventory.mjs";

const tenantId="authority-ci-tenant";
const deploymentId="authority-ci-deployment";
const context={tenantId,deploymentId};
const approver1=generateKeyPairSync("ed25519");
const approver2=generateKeyPairSync("ed25519");
const approver3=generateKeyPairSync("ed25519");
const authority1=generateKeyPairSync("ed25519");
const authority2=generateKeyPairSync("ed25519");
const authority3=generateKeyPairSync("ed25519");
const t0=Date.parse("2026-10-26T10:00:00.000Z");
const t1=t0+60_000;
const t2=t1+60_000;

const policy=createGovernanceApprovalPolicy({
  approverPublicKeys:[approver1.publicKey,approver2.publicKey,approver3.publicKey],
  minApprovals:2,...context,issuedAt:t0-60_000,expiresAt:t0+24*60*60_000
});
const policySha=governanceApprovalPolicySha256(policy);
const code=expected=>error=>error?.code===expected;

function approvals(operation,currentGeneration,currentSha256,targetKeyId,now,keys=[approver1.privateKey,approver2.privateKey]){
  let bundle={proposal:createGovernanceProposal({
    ...context,operation,currentGeneration,currentSha256,targetKeyId,
    now,expiresAt:now+30*60_000
  }),approvals:[]};
  keys.forEach((key,index)=>{bundle=approveGovernanceProposal(bundle,key,now+1000+index*1000);});
  return bundle;
}
function initial(){
  return createInitialAuthorityTrustInventory(
    authority1.publicKey,policy,
    approvals("INIT_AUTHORITY",0,null,checkpointKeyId(authority1.publicKey),t0),
    context,{expectedPolicySha256:policySha,now:t0}
  );
}

test("initial authority generation is canonical and dual-control approved",()=>{
  const value=initial();
  assert.deepEqual(parseAuthorityTrustInventory(encodeAuthorityTrustInventory(value)),value);
  assert.equal(value.manifest.generation,1);
  assert.equal(value.manifest.changeType,"INIT_AUTHORITY");
  assert.equal(value.manifest.authorities.length,1);
  assert.equal(value.manifest.authorities[0].status,"ACTIVE");
  const verified=verifyAuthorityTrustInventoryChain([value],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(value),
    ...context,maxAgeMs:24*60*60_000,now:t0
  });
  assert.equal(verified.activeKeyId,checkpointKeyId(authority1.publicKey));
});

test("planned rotation retires old authority and preserves its historical validity window",()=>{
  const first=initial();
  const second=rotateAuthorityTrustInventory(
    first,authority2.publicKey,policy,
    approvals("ROTATE_AUTHORITY",1,authorityTrustInventorySha256(first),checkpointKeyId(authority2.publicKey),t1),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1}
  );
  assert.equal(second.manifest.changeType,"ROTATE_AUTHORITY");
  const old=second.manifest.authorities.find(entry=>entry.keyId===checkpointKeyId(authority1.publicKey));
  assert.equal(old.status,"RETIRED");
  assert.equal(old.validUntil,new Date(t1).toISOString());
  assert.equal(checkpointKeyId(resolveTrustAuthority(second,{
    keyId:old.keyId,issuedAt:new Date(t0+30_000).toISOString()
  })),old.keyId);
  assert.throws(()=>resolveTrustAuthority(second,{
    keyId:old.keyId,issuedAt:new Date(t1).toISOString()
  }),code("AUTHORITY_INVENTORY_KEY_OUTSIDE_VALIDITY"));
});

test("emergency recovery revokes old authority and invalidates its historical use",()=>{
  const first=initial();
  const recovered=recoverAuthorityTrustInventory(
    first,authority2.publicKey,policy,
    approvals("RECOVER_AUTHORITY",1,authorityTrustInventorySha256(first),checkpointKeyId(authority2.publicKey),t1),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1}
  );
  const old=recovered.manifest.authorities.find(entry=>entry.keyId===checkpointKeyId(authority1.publicKey));
  assert.equal(old.status,"REVOKED");
  assert.equal(old.revokedAt,new Date(t1).toISOString());
  assert.throws(()=>resolveTrustAuthority(recovered,{
    keyId:old.keyId,issuedAt:new Date(t0+30_000).toISOString()
  }),code("AUTHORITY_INVENTORY_KEY_REVOKED"));
});

test("rotation requires exact current digest and cannot re-enroll a historical authority",()=>{
  const first=initial();
  const bundle=approvals("ROTATE_AUTHORITY",1,authorityTrustInventorySha256(first),checkpointKeyId(authority2.publicKey),t1);
  assert.throws(()=>rotateAuthorityTrustInventory(first,authority2.publicKey,policy,bundle,context,{
    expectedPolicySha256:policySha,expectedCurrentSha256:"0".repeat(64),now:t1
  }),code("AUTHORITY_INVENTORY_DIGEST_MISMATCH"));
  const second=rotateAuthorityTrustInventory(first,authority2.publicKey,policy,bundle,context,{
    expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1
  });
  assert.throws(()=>rotateAuthorityTrustInventory(second,authority1.publicKey,policy,
    approvals("ROTATE_AUTHORITY",2,authorityTrustInventorySha256(second),checkpointKeyId(authority1.publicKey),t2),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(second),now:t2}
  ),code("AUTHORITY_INVENTORY_KEY_ALREADY_ENROLLED"));
});

test("current and target authority keys cannot count toward approval quorum",()=>{
  const mixedPolicy=createGovernanceApprovalPolicy({
    approverPublicKeys:[approver1.publicKey,authority1.publicKey,authority2.publicKey],
    minApprovals:2,...context,issuedAt:t0-60_000,expiresAt:t0+24*60*60_000
  });
  const first=createInitialAuthorityTrustInventory(
    authority1.publicKey,policy,
    approvals("INIT_AUTHORITY",0,null,checkpointKeyId(authority1.publicKey),t0),
    context,{expectedPolicySha256:policySha,now:t0}
  );
  let bundle={proposal:createGovernanceProposal({
    ...context,operation:"ROTATE_AUTHORITY",currentGeneration:1,
    currentSha256:authorityTrustInventorySha256(first),targetKeyId:checkpointKeyId(authority2.publicKey),
    now:t1,expiresAt:t1+30*60_000
  }),approvals:[]};
  bundle=approveGovernanceProposal(bundle,approver1.privateKey,t1+1000);
  bundle=approveGovernanceProposal(bundle,authority1.privateKey,t1+2000);
  assert.throws(()=>rotateAuthorityTrustInventory(first,authority2.publicKey,mixedPolicy,bundle,context,{
    expectedPolicySha256:governanceApprovalPolicySha256(mixedPolicy),
    expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1
  }),code("GOVERNANCE_APPROVAL_SEPARATION_VIOLATION"));
});

test("chain verification detects rollback rewrite gap and stale latest authority generation",()=>{
  const first=initial();
  const second=rotateAuthorityTrustInventory(
    first,authority2.publicKey,policy,
    approvals("ROTATE_AUTHORITY",1,authorityTrustInventorySha256(first),checkpointKeyId(authority2.publicKey),t1),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1}
  );
  const third=rotateAuthorityTrustInventory(
    second,authority3.publicKey,policy,
    approvals("ROTATE_AUTHORITY",2,authorityTrustInventorySha256(second),checkpointKeyId(authority3.publicKey),t2),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(second),now:t2}
  );
  assert.equal(verifyAuthorityTrustInventoryChain([first,second,third],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(third),
    ...context,maxAgeMs:3600_000,now:t2
  }).latest.manifest.generation,3);

  assert.throws(()=>verifyAuthorityTrustInventoryChain([first,second],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(third),
    ...context,maxAgeMs:3600_000,now:t2
  }),code("AUTHORITY_INVENTORY_DIGEST_MISMATCH"));
  assert.throws(()=>verifyAuthorityTrustInventoryChain([first,third],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(third),
    ...context,maxAgeMs:3600_000,now:t2
  }),code("AUTHORITY_INVENTORY_CHAIN_INVALID"));
  assert.throws(()=>verifyAuthorityTrustInventoryChain([first],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(first),
    ...context,maxAgeMs:3600_000,now:t0+2*3600_000
  }),code("AUTHORITY_INVENTORY_STALE"));
});

test("authority chain remains forensically verifiable after its approval policy expires",()=>{
  const first=initial();
  const second=rotateAuthorityTrustInventory(
    first,authority2.publicKey,policy,
    approvals("ROTATE_AUTHORITY",1,authorityTrustInventorySha256(first),checkpointKeyId(authority2.publicKey),t1),
    context,{expectedPolicySha256:policySha,expectedCurrentSha256:authorityTrustInventorySha256(first),now:t1}
  );
  const result=verifyAuthorityTrustInventoryChain([first,second],{
    policy,expectedPolicySha256:policySha,expectedLatestSha256:authorityTrustInventorySha256(second),
    ...context,maxAgeMs:10*24*60*60_000,now:t0+2*24*60*60_000
  });
  assert.equal(result.latest.manifest.generation,2);
  assert.equal(result.activeKeyId,checkpointKeyId(authority2.publicKey));
});

test("generation files are append-only and unsafe authority directories fail closed",()=>{
  const root=mkdtempSync(join(tmpdir(),"hrbp-authority-inventory-"));
  try{
    chmodSync(root,0o700);
    const first=initial();
    const written=writeAuthorityTrustInventoryGeneration(root,first);
    assert.equal(written.inventorySha256,authorityTrustInventorySha256(first));
    assert.deepEqual(readAuthorityTrustInventoryChain(root),[first]);
    assert.throws(()=>writeAuthorityTrustInventoryGeneration(root,first),
      code("AUTHORITY_INVENTORY_GENERATION_EXISTS"));
    const unsafe=join(root,"unsafe");mkdirSync(unsafe,{mode:0o777});chmodSync(unsafe,0o777);
    assert.throws(()=>writeAuthorityTrustInventoryGeneration(unsafe,first),
      code("AUTHORITY_INVENTORY_DIRECTORY_UNSAFE"));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("CLI init rotate recover and verify use externally pinned policy and current generation digests",async()=>{
  const root=mkdtempSync(join(tmpdir(),"hrbp-authority-cli-"));
  try{
    chmodSync(root,0o700);
    const dir=join(root,"inventory");mkdirSync(dir,{mode:0o700});
    const policyPath=join(root,"policy.json");
    const a1=join(root,"authority1.pem"),a2=join(root,"authority2.pem"),a3=join(root,"authority3.pem");
    writeFileSync(policyPath,encodeGovernanceApprovalPolicy(policy),{mode:0o600});
    writeFileSync(a1,authority1.publicKey.export({type:"spki",format:"pem"}),{mode:0o644});
    writeFileSync(a2,authority2.publicKey.export({type:"spki",format:"pem"}),{mode:0o644});
    writeFileSync(a3,authority3.publicKey.export({type:"spki",format:"pem"}),{mode:0o644});
    const initApproval=join(root,"init.json");
    writeFileSync(initApproval,encodeGovernanceApprovalBundle(
      approvals("INIT_AUTHORITY",0,null,checkpointKeyId(authority1.publicKey),t0)
    ),{mode:0o600});
    const initResult=await runAuthorityTrustInventoryCli([
      "init","--tenant-id",tenantId,"--deployment-id",deploymentId,"--inventory-dir",dir,
      "--policy",policyPath,"--expected-policy-sha256",policySha,
      "--approval-bundle",initApproval,"--authority-public-key-file",a1
    ],()=>t0);
    assert.equal(initResult.code,"AUTHORITY_INVENTORY_INITIALIZED");

    const rotateApproval=join(root,"rotate.json");
    writeFileSync(rotateApproval,encodeGovernanceApprovalBundle(
      approvals("ROTATE_AUTHORITY",1,initResult.latestSha256,checkpointKeyId(authority2.publicKey),t1)
    ),{mode:0o600});
    const rotateResult=await runAuthorityTrustInventoryCli([
      "rotate","--tenant-id",tenantId,"--deployment-id",deploymentId,"--inventory-dir",dir,
      "--policy",policyPath,"--expected-policy-sha256",policySha,
      "--approval-bundle",rotateApproval,"--authority-public-key-file",a2,
      "--expected-current-sha256",initResult.latestSha256
    ],()=>t1);
    assert.equal(rotateResult.code,"AUTHORITY_INVENTORY_ROTATED");

    const recoverApproval=join(root,"recover.json");
    writeFileSync(recoverApproval,encodeGovernanceApprovalBundle(
      approvals("RECOVER_AUTHORITY",2,rotateResult.latestSha256,checkpointKeyId(authority3.publicKey),t2)
    ),{mode:0o600});
    const recoverResult=await runAuthorityTrustInventoryCli([
      "recover","--tenant-id",tenantId,"--deployment-id",deploymentId,"--inventory-dir",dir,
      "--policy",policyPath,"--expected-policy-sha256",policySha,
      "--approval-bundle",recoverApproval,"--authority-public-key-file",a3,
      "--expected-current-sha256",rotateResult.latestSha256
    ],()=>t2);
    assert.equal(recoverResult.code,"AUTHORITY_INVENTORY_RECOVERED");

    const verified=await runAuthorityTrustInventoryCli([
      "verify","--tenant-id",tenantId,"--deployment-id",deploymentId,"--inventory-dir",dir,
      "--policy",policyPath,"--expected-policy-sha256",policySha,
      "--expected-latest-sha256",recoverResult.latestSha256,"--max-age-hours","24"
    ],()=>t2+60_000);
    assert.equal(verified.code,"AUTHORITY_INVENTORY_VALID");
    assert.equal(verified.generation,3);
    assert.equal(verified.activeKeyId,checkpointKeyId(authority3.publicKey));
  }finally{rmSync(root,{recursive:true,force:true});}
});
