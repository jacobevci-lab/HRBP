import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fullAuditHash } from "./audit-full-history-verification.mjs";
import { createAuditCheckpoint } from "./audit-checkpoint.mjs";
import {
  createAuditCheckpointArchive, writeAuditCheckpointArchiveBundle
} from "./audit-checkpoint-archive.mjs";
import {
  createArchiveTimestampRequest,
  parseTrustedTimestampReceipt,
  publishTrustedTimestampEvidence,
  runTrustedTimestampCli,
  verifyArchiveTrustedTimestamp,
  verifyPublishedTrustedTimestampEvidence
} from "./audit-checkpoint-timestamp.mjs";

const root=mkdtempSync(join(tmpdir(),"hrbp-rfc3161-test-"));
chmodSync(root,0o700);
after(()=>rmSync(root,{recursive:true,force:true}));

const policyOid="1.3.6.1.4.1.55555.1.1";
const caKey=join(root,"ca.key");
const caCert=join(root,"ca.crt");
const tsaKey=join(root,"tsa.key");
const tsaCsr=join(root,"tsa.csr");
const tsaCert=join(root,"tsa.crt");
const tsaExt=join(root,"tsa.ext");
const tsaSerial=join(root,"tsa.serial");
const tsaConfig=join(root,"tsa.cnf");

function openssl(args,{cwd=root}={}){
  const result=spawnSync("openssl",args,{
    cwd,shell:false,encoding:"utf8",maxBuffer:1024*1024,
    env:{PATH:process.env.PATH??"/usr/bin:/bin",HOME:root,LC_ALL:"C",LANG:"C"}
  });
  assert.equal(result.status,0,result.stderr||result.stdout);
  return result.stdout;
}
openssl(["req","-x509","-newkey","rsa:2048","-keyout",caKey,"-out",caCert,
  "-nodes","-subj","/CN=HRBP Test TSA Root","-days","2"]);
openssl(["req","-newkey","rsa:2048","-keyout",tsaKey,"-out",tsaCsr,
  "-nodes","-subj","/CN=HRBP Test TSA"]);
writeFileSync(tsaExt,[
  "basicConstraints=critical,CA:FALSE",
  "keyUsage=critical,digitalSignature,nonRepudiation",
  "extendedKeyUsage=critical,timeStamping",
  "subjectKeyIdentifier=hash",
  "authorityKeyIdentifier=keyid,issuer",
  ""
].join("\n"),{mode:0o600});
openssl(["x509","-req","-in",tsaCsr,"-CA",caCert,"-CAkey",caKey,"-CAcreateserial",
  "-out",tsaCert,"-days","2","-sha256","-extfile",tsaExt]);
writeFileSync(tsaSerial,"01\n",{mode:0o600});
writeFileSync(tsaConfig,[
  "[ tsa ]",
  "default_tsa = tsa_config1",
  "[ tsa_config1 ]",
  `serial = ${tsaSerial}`,
  "crypto_device = builtin",
  `signer_cert = ${tsaCert}`,
  `certs = ${caCert}`,
  `signer_key = ${tsaKey}`,
  "signer_digest = sha256",
  `default_policy = ${policyOid}`,
  "digests = sha256",
  "accuracy = secs:1",
  "ordering = yes",
  "tsa_name = yes",
  "ess_cert_id_chain = no",
  ""
].join("\n"),{mode:0o600});

const caBytes=readFileSync(caCert);
const tsaBytes=readFileSync(tsaCert);
const caSha=createHash("sha256").update(caBytes).digest("hex");
const tenantId="timestamp-ci-tenant";
const deploymentId="timestamp-ci-deployment";
const signingKeys=generateKeyPairSync("ed25519");

function eventRows(now,count=3){
  let previousHash=null;
  return Array.from({length:count},(_,i)=>{
    const row={
      tenantId,ledgerSequence:String(i+1),actorId:"private-ts-actor",
      action:"timestamp.probe",resourceType:"Synthetic",resourceId:"private-ts-"+i,
      purpose:"Trusted timestamp regression",classification:"RESTRICTED",ipAddress:"192.0.2.88",
      occurredAt:new Date(now-60_000),previousHash
    };
    row.hash=fullAuditHash(row,previousHash);previousHash=row.hash;return row;
  });
}
function harness(rows){
  let active=false,snapshot=[],state=null;
  return {
    async query(sql,params=[]){
      if(sql.startsWith("BEGIN ")){
        assert.match(sql,/REPEATABLE READ READ ONLY/);active=true;snapshot=structuredClone(rows);
        state=snapshot.length?{eventCount:String(snapshot.length),tailHash:snapshot.at(-1).hash}:null;
        return{rows:[]};
      }
      assert.equal(active,true);
      if(sql==="ROLLBACK"){active=false;return{rows:[]};}
      if(sql.startsWith("SET LOCAL"))return{rows:[]};
      assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/);
      assert.equal(params[0],tenantId);
      if(sql.includes('FROM "Tenant"'))return{rows:[{id:tenantId}]};
      if(sql.includes('FROM "AuditLedgerState"'))return{rows:state?[state]:[]};
      return{rows:snapshot.filter(row=>BigInt(row.ledgerSequence)>BigInt(params[1])).slice(0,params[2])};
    },
    async end(){assert.equal(active,false);}
  };
}
let fixtureCounter=0;
async function archiveFixture({exportedAt=Date.now()-2000,actionSuffix=""}={}){
  fixtureCounter+=1;
  const directory=join(root,`archive-${fixtureCounter}`);
  const rows=eventRows(exportedAt).map(row=>({...row,action:row.action+actionSuffix}));
  // Recompute after any deliberate semantic change.
  let previousHash=null;
  for(const row of rows){row.previousHash=previousHash;row.hash=fullAuditHash(row,previousHash);previousHash=row.hash;}
  const checkpoint=await createAuditCheckpoint(
    harness(rows),{tenantId,maxEvents:100,batchSize:2},signingKeys.privateKey,
    {tenantId,deploymentId},()=>exportedAt-1000
  );
  const archive=createAuditCheckpointArchive(checkpoint,signingKeys.privateKey,{tenantId,deploymentId},{
    maxAgeMs:4*60*60_000,retentionDays:365,now:exportedAt
  });
  writeAuditCheckpointArchiveBundle(directory,checkpoint,archive);
  return{directory,checkpoint,archive,exportedAt};
}
function issueResponse(requestPath,name){
  const response=join(root,`${name}.tsr`);
  openssl(["ts","-reply","-config",tsaConfig,"-queryfile",requestPath,"-out",response]);
  return response;
}
const code=expected=>error=>error?.code===expected;

test("request generation binds the canonical archive manifest and never overwrites evidence",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-one.tsq");
  const result=createArchiveTimestampRequest(fixture.directory,request);
  assert.equal(result.code,"TRUSTED_TIMESTAMP_REQUEST_CREATED");
  assert.equal(result.requestSha256,createHash("sha256").update(readFileSync(request)).digest("hex"));
  assert.throws(()=>createArchiveTimestampRequest(fixture.directory,request),
    code("TRUSTED_TIMESTAMP_OUTPUT_EXISTS"));
  const text=openssl(["ts","-query","-in",request,"-text"]);
  assert.match(text,/Hash Algorithm:\s*sha256/i);
  assert.match(text,/Nonce:/);
});

test("real RFC3161 response verifies nonce, archive bytes, TSA chain and policy",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-valid.tsq");
  createArchiveTimestampRequest(fixture.directory,request);
  const response=issueResponse(request,"response-valid");
  const receipt=verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  });
  assert.equal(receipt.scope,"RFC3161_ARCHIVE_TIMESTAMP");
  assert.equal(receipt.policyOid,policyOid);
  assert.equal(receipt.tsaTrustAnchorSha256,caSha);
  assert.equal(receipt.archiveManifestSha256,
    createHash("sha256").update(readFileSync(join(fixture.directory,"archive-manifest.json"))).digest("hex"));
  assert.ok(Date.parse(receipt.timestamp)>0);
});

test("a valid timestamp response cannot be replayed against a different valid archive",async()=>{
  const first=await archiveFixture({actionSuffix:"-first"});
  const request=join(root,"request-replay.tsq");
  createArchiveTimestampRequest(first.directory,request);
  const response=issueResponse(request,"response-replay");
  const second=await archiveFixture({actionSuffix:"-second"});
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:second.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_DATA_VERIFY_FAILED"));
});

test("tampered TSA response and wrong external trust pin fail closed",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-tamper.tsq");
  createArchiveTimestampRequest(fixture.directory,request);
  const response=issueResponse(request,"response-tamper");
  const tampered=Buffer.from(readFileSync(response));
  tampered[tampered.length-1]^=0x01;
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:tampered,
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_QUERY_VERIFY_FAILED"));
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:"0".repeat(64),expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_TRUST_ANCHOR_MISMATCH"));
});

test("TSA policy OID is externally pinned rather than inferred from the response",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-policy.tsq");
  createArchiveTimestampRequest(fixture.directory,request);
  const response=issueResponse(request,"response-policy");
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:"1.3.6.1.4.1.55555.9.9",
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_POLICY_MISMATCH"));
});

test("trusted time detects future verifier clock and excessive archive-to-TSA delay",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-time.tsq");
  createArchiveTimestampRequest(fixture.directory,request);
  const response=issueResponse(request,"response-time");
  const accepted=verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  });
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,
    requestBytes:readFileSync(request),responseBytes:readFileSync(response),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:0,
    now:Date.parse(accepted.timestamp)-60_000
  }),code("TRUSTED_TIMESTAMP_FUTURE"));

  const old=await archiveFixture({exportedAt:Date.now()-2*60*60_000});
  const oldRequest=join(root,"request-delay.tsq");
  createArchiveTimestampRequest(old.directory,oldRequest);
  const oldResponse=issueResponse(oldRequest,"response-delay");
  assert.throws(()=>verifyArchiveTrustedTimestamp({
    archiveDirectory:old.directory,
    requestBytes:readFileSync(oldRequest),responseBytes:readFileSync(oldResponse),
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:0,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_DELAY_EXCEEDED"));
});

test("published timestamp evidence is no-overwrite and re-verifies offline",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"request-publish.tsq");
  createArchiveTimestampRequest(fixture.directory,request);
  const response=issueResponse(request,"response-publish");
  const requestBytes=readFileSync(request),responseBytes=readFileSync(response);
  const receipt=verifyArchiveTrustedTimestamp({
    archiveDirectory:fixture.directory,requestBytes,responseBytes,
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  });
  const evidence=join(root,"timestamp-evidence");
  const written=publishTrustedTimestampEvidence(evidence,{requestBytes,responseBytes,receipt});
  assert.equal(written.responseSha256,receipt.responseSha256);
  const verified=verifyPublishedTrustedTimestampEvidence({
    archiveDirectory:fixture.directory,evidenceDirectory:evidence,
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  });
  assert.equal(verified.timestamp,receipt.timestamp);
  assert.throws(()=>publishTrustedTimestampEvidence(evidence,{requestBytes,responseBytes,receipt}),
    code("TRUSTED_TIMESTAMP_OUTPUT_EXISTS"));

  const retained=parseTrustedTimestampReceipt(readFileSync(join(evidence,"timestamp-receipt.json"),"utf8"));
  retained.archiveManifestSha256="0".repeat(64);
  writeFileSync(join(evidence,"timestamp-receipt.json"),JSON.stringify(retained)+"\n");
  assert.throws(()=>verifyPublishedTrustedTimestampEvidence({
    archiveDirectory:fixture.directory,evidenceDirectory:evidence,
    trustAnchorBytes:caBytes,untrustedChainBytes:tsaBytes,
    expectedTrustAnchorSha256:caSha,expectedPolicyOid:policyOid,
    maxTimestampDelayMs:60*60_000,maxClockSkewMs:5*60_000,now:Date.now()
  }),code("TRUSTED_TIMESTAMP_RECEIPT_MISMATCH"));
});

test("CLI request publish verify flow remains offline and exposes bounded evidence only",async()=>{
  const fixture=await archiveFixture();
  const request=join(root,"cli-request.tsq");
  const response=join(root,"cli-response.tsr");
  const evidence=join(root,"cli-evidence");
  const created=await runTrustedTimestampCli([
    "request","--archive-dir",fixture.directory,"--out",request
  ],()=>Date.now());
  assert.equal(created.code,"TRUSTED_TIMESTAMP_REQUEST_CREATED");
  openssl(["ts","-reply","-config",tsaConfig,"-queryfile",request,"-out",response]);
  const published=await runTrustedTimestampCli([
    "publish","--archive-dir",fixture.directory,
    "--request",request,"--response",response,"--ca-file",caCert,"--untrusted-file",tsaCert,
    "--expected-ca-sha256",caSha,"--expected-policy-oid",policyOid,
    "--max-delay-hours","1","--max-clock-skew-seconds","300","--out-dir",evidence
  ],()=>Date.now());
  assert.equal(published.code,"TRUSTED_TIMESTAMP_EVIDENCE_PUBLISHED");
  assert.ok(!JSON.stringify(published).includes(root));
  const verified=await runTrustedTimestampCli([
    "verify","--archive-dir",fixture.directory,
    "--ca-file",caCert,"--untrusted-file",tsaCert,
    "--expected-ca-sha256",caSha,"--expected-policy-oid",policyOid,
    "--max-delay-hours","1","--max-clock-skew-seconds","300","--evidence-dir",evidence
  ],()=>Date.now());
  assert.equal(verified.code,"TRUSTED_TIMESTAMP_VALID");
  assert.equal(verified.responseSha256,published.responseSha256);
});
