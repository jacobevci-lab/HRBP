import { createHash, createPublicKey, KeyObject } from "node:crypto";
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, writeFileSync
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkpointKeyId, checkpointSubject, readCheckpointFile } from "./audit-checkpoint.mjs";
import {
  encodeGovernanceApprovalBundle,
  parseGovernanceApprovalBundle,
  parseGovernanceApprovalPolicy,
  verifyGovernanceApprovalBundle
} from "./audit-governance-approval.mjs";

const SCOPE="CHECKPOINT_TRUST_AUTHORITY_INVENTORY";
const HASH=/^[a-f0-9]{64}$/;
const FILE=/^authority-([0-9]{6})\.json$/;
const STATUS=new Set(["ACTIVE","RETIRED","REVOKED"]);
const MAX_FILE=131072;
const MAX_KEYS=16;
const MAX_AGE_MS=10*365*24*60*60_000;

class AuthorityInventoryError extends Error{
  constructor(code){super("Audit trust authority inventory operation did not complete safely.");this.code=code;}
}
function fail(code="AUTHORITY_INVENTORY_INPUT_INVALID"){throw new AuthorityInventoryError(code);}
function digest(bytes){return createHash("sha256").update(bytes).digest("hex");}
function exactKeys(value,keys){
  if(!value||typeof value!=="object"||Array.isArray(value)||
      Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail();
}
function keyOf(key,type){
  if(!(key instanceof KeyObject)||key.type!==type||key.asymmetricKeyType!=="ed25519")fail("AUTHORITY_INVENTORY_KEY_INVALID");
  return key;
}
function strictIso(value){
  if(typeof value!=="string"||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail();
  return value;
}
function publicKeyFromSpki(value){
  if(typeof value!=="string"||value.length<32||value.length>1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    fail("AUTHORITY_INVENTORY_KEY_INVALID");
  try{
    const der=Buffer.from(value,"base64");
    if(der.toString("base64")!==value)fail("AUTHORITY_INVENTORY_KEY_INVALID");
    return keyOf(createPublicKey({key:der,format:"der",type:"spki"}),"public");
  }catch(error){
    if(error instanceof AuthorityInventoryError)throw error;
    fail("AUTHORITY_INVENTORY_KEY_INVALID");
  }
}
function publicKeySpki(publicKey){
  return keyOf(publicKey,"public").export({format:"der",type:"spki"}).toString("base64");
}
function authorityEntryOf(value){
  exactKeys(value,["keyId","publicKeySpki","status","validFrom","validUntil","enrolledAt","retiredAt","revokedAt"]);
  if(typeof value.keyId!=="string"||!HASH.test(value.keyId)||!STATUS.has(value.status))fail();
  const publicKey=publicKeyFromSpki(value.publicKeySpki);
  if(checkpointKeyId(publicKey)!==value.keyId)fail("AUTHORITY_INVENTORY_KEY_ID_MISMATCH");
  const validFrom=strictIso(value.validFrom),enrolledAt=strictIso(value.enrolledAt);
  const validUntil=value.validUntil===null?null:strictIso(value.validUntil);
  const retiredAt=value.retiredAt===null?null:strictIso(value.retiredAt);
  const revokedAt=value.revokedAt===null?null:strictIso(value.revokedAt);
  if(Date.parse(enrolledAt)>Date.parse(validFrom)||
      (validUntil!==null&&Date.parse(validUntil)<=Date.parse(validFrom)))fail();
  if(value.status==="ACTIVE"&&(validUntil!==null||retiredAt!==null||revokedAt!==null))fail();
  if(value.status==="RETIRED"&&(validUntil===null||retiredAt===null||revokedAt!==null||validUntil!==retiredAt))fail();
  if(value.status==="REVOKED"&&(validUntil===null||revokedAt===null))fail();
  return {keyId:value.keyId,publicKeySpki:value.publicKeySpki,status:value.status,validFrom,validUntil,enrolledAt,retiredAt,revokedAt};
}
function manifestOf(value){
  exactKeys(value,[
    "version","scope","subject","generation","previousInventorySha256","issuedAt","changeType","authorities"
  ]);
  if(value.version!==1||value.scope!==SCOPE||typeof value.subject!=="string"||!HASH.test(value.subject)||
      !Number.isSafeInteger(value.generation)||value.generation<1||value.generation>999999||
      !["INIT_AUTHORITY","ROTATE_AUTHORITY","RECOVER_AUTHORITY"].includes(value.changeType))fail();
  if(value.generation===1?value.previousInventorySha256!==null:
      typeof value.previousInventorySha256!=="string"||!HASH.test(value.previousInventorySha256))fail();
  const issuedAt=strictIso(value.issuedAt);
  if(!Array.isArray(value.authorities)||value.authorities.length<1||value.authorities.length>MAX_KEYS)fail();
  const authorities=value.authorities.map(authorityEntryOf);
  if(new Set(authorities.map(entry=>entry.keyId)).size!==authorities.length)fail("AUTHORITY_INVENTORY_DUPLICATE_KEY");
  if(authorities.filter(entry=>entry.status==="ACTIVE").length!==1)fail("AUTHORITY_INVENTORY_ACTIVE_KEY_INVALID");
  if(authorities.some(entry=>Date.parse(entry.enrolledAt)>Date.parse(issuedAt)+30_000||
      (entry.retiredAt!==null&&Date.parse(entry.retiredAt)>Date.parse(issuedAt)+30_000)||
      (entry.revokedAt!==null&&Date.parse(entry.revokedAt)>Date.parse(issuedAt)+30_000)))fail();
  return {
    version:1,scope:SCOPE,subject:value.subject,generation:value.generation,
    previousInventorySha256:value.previousInventorySha256,issuedAt,changeType:value.changeType,authorities
  };
}
function envelopeOf(value){
  exactKeys(value,["manifest","approvalBundle"]);
  return {manifest:manifestOf(value.manifest),approvalBundle:parseGovernanceApprovalBundle(
    encodeGovernanceApprovalBundle(value.approvalBundle)
  )};
}
export function encodeAuthorityTrustInventory(value){return JSON.stringify(envelopeOf(value))+"\n";}
export function parseAuthorityTrustInventory(text){
  if(typeof text!=="string"||Buffer.byteLength(text)>MAX_FILE)fail();
  let value;try{value=envelopeOf(JSON.parse(text));}catch{fail();}
  if(text!==encodeAuthorityTrustInventory(value))fail();
  return value;
}
export function authorityTrustInventorySha256(value){return digest(encodeAuthorityTrustInventory(value));}
function activeAuthority(value){return manifestOf(value.manifest).authorities.find(entry=>entry.status==="ACTIVE");}

export function createInitialAuthorityTrustInventory(newAuthorityPublicKey,policy,approvalBundle,context,{
  expectedPolicySha256,now=Date.now()
}){
  keyOf(newAuthorityPublicKey,"public");
  if(!Number.isSafeInteger(now)||now<0)fail();
  const targetKeyId=checkpointKeyId(newAuthorityPublicKey);
  verifyGovernanceApprovalBundle(approvalBundle,policy,{
    ...context,expectedPolicySha256,operation:"INIT_AUTHORITY",currentGeneration:0,currentSha256:null,
    targetKeyId,forbiddenKeyIds:[targetKeyId],now
  });
  const issuedAt=new Date(now).toISOString();
  return envelopeOf({
    manifest:{
      version:1,scope:SCOPE,subject:checkpointSubject(context),generation:1,previousInventorySha256:null,
      issuedAt,changeType:"INIT_AUTHORITY",authorities:[{
        keyId:targetKeyId,publicKeySpki:publicKeySpki(newAuthorityPublicKey),status:"ACTIVE",
        validFrom:issuedAt,validUntil:null,enrolledAt:issuedAt,retiredAt:null,revokedAt:null
      }]
    },
    approvalBundle
  });
}
function nextAuthorityInventory(current,newAuthorityPublicKey,policy,approvalBundle,context,{
  expectedPolicySha256,expectedCurrentSha256,recovery,now=Date.now()
}){
  keyOf(newAuthorityPublicKey,"public");
  if(!Number.isSafeInteger(now)||now<0||typeof expectedCurrentSha256!=="string"||!HASH.test(expectedCurrentSha256))fail();
  const verified=envelopeOf(current);
  const currentSha=authorityTrustInventorySha256(verified);
  if(currentSha!==expectedCurrentSha256)fail("AUTHORITY_INVENTORY_DIGEST_MISMATCH");
  const previousActive=activeAuthority(verified);
  const targetKeyId=checkpointKeyId(newAuthorityPublicKey);
  if(verified.manifest.authorities.some(entry=>entry.keyId===targetKeyId))fail("AUTHORITY_INVENTORY_KEY_ALREADY_ENROLLED");
  const issuedAt=new Date(now).toISOString();
  if(Date.parse(issuedAt)<Date.parse(verified.manifest.issuedAt))fail("AUTHORITY_INVENTORY_CLOCK_REGRESSION");
  const operation=recovery?"RECOVER_AUTHORITY":"ROTATE_AUTHORITY";
  verifyGovernanceApprovalBundle(approvalBundle,policy,{
    ...context,expectedPolicySha256,operation,currentGeneration:verified.manifest.generation,
    currentSha256:currentSha,targetKeyId,forbiddenKeyIds:[previousActive.keyId,targetKeyId],now
  });
  const authorities=verified.manifest.authorities.map(entry=>entry.keyId!==previousActive.keyId?entry:{
    ...entry,status:recovery?"REVOKED":"RETIRED",validUntil:issuedAt,
    retiredAt:recovery?entry.retiredAt:issuedAt,revokedAt:recovery?issuedAt:null
  });
  authorities.push({
    keyId:targetKeyId,publicKeySpki:publicKeySpki(newAuthorityPublicKey),status:"ACTIVE",
    validFrom:issuedAt,validUntil:null,enrolledAt:issuedAt,retiredAt:null,revokedAt:null
  });
  return envelopeOf({
    manifest:{
      version:1,scope:SCOPE,subject:verified.manifest.subject,generation:verified.manifest.generation+1,
      previousInventorySha256:currentSha,issuedAt,changeType:operation,authorities
    },
    approvalBundle
  });
}
export function rotateAuthorityTrustInventory(current,newAuthorityPublicKey,policy,approvalBundle,context,options){
  return nextAuthorityInventory(current,newAuthorityPublicKey,policy,approvalBundle,context,{...options,recovery:false});
}
export function recoverAuthorityTrustInventory(current,newAuthorityPublicKey,policy,approvalBundle,context,options){
  return nextAuthorityInventory(current,newAuthorityPublicKey,policy,approvalBundle,context,{...options,recovery:true});
}
function validateTransition(previous,current,policy,expectedPolicySha256,context,now){
  const currentManifest=current.manifest;
  const currentSha=previous?authorityTrustInventorySha256(previous):null;
  const active=currentManifest.authorities.find(entry=>entry.status==="ACTIVE");
  if(!previous){
    if(currentManifest.generation!==1||currentManifest.previousInventorySha256!==null||
        currentManifest.changeType!=="INIT_AUTHORITY"||currentManifest.authorities.length!==1)fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
    verifyGovernanceApprovalBundle(current.approvalBundle,policy,{
      ...context,expectedPolicySha256,operation:"INIT_AUTHORITY",currentGeneration:0,currentSha256:null,
      targetKeyId:active.keyId,forbiddenKeyIds:[active.keyId],now
    });
    return;
  }
  if(currentManifest.generation!==previous.manifest.generation+1||
      currentManifest.previousInventorySha256!==currentSha||
      !["ROTATE_AUTHORITY","RECOVER_AUTHORITY"].includes(currentManifest.changeType)||
      currentManifest.authorities.length!==previous.manifest.authorities.length+1)fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
  const previousActive=activeAuthority(previous);
  const target=active;
  const previousMap=new Map(previous.manifest.authorities.map(entry=>[entry.keyId,entry]));
  for(const old of previous.manifest.authorities){
    const next=currentManifest.authorities.find(entry=>entry.keyId===old.keyId);
    if(!next)fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
    if(old.keyId!==previousActive.keyId){
      if(JSON.stringify(next)!==JSON.stringify(old))fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
    }else if(currentManifest.changeType==="ROTATE_AUTHORITY"){
      if(next.status!=="RETIRED"||next.retiredAt!==currentManifest.issuedAt||
          next.validUntil!==currentManifest.issuedAt||next.revokedAt!==null)fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
    }else{
      if(next.status!=="REVOKED"||next.revokedAt!==currentManifest.issuedAt||
          next.validUntil!==currentManifest.issuedAt)fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
    }
  }
  if(previousMap.has(target.keyId)||target.validFrom!==currentManifest.issuedAt||target.enrolledAt!==currentManifest.issuedAt)
    fail("AUTHORITY_INVENTORY_CHAIN_INVALID");
  verifyGovernanceApprovalBundle(current.approvalBundle,policy,{
    ...context,expectedPolicySha256,operation:currentManifest.changeType,
    currentGeneration:previous.manifest.generation,currentSha256:currentSha,targetKeyId:target.keyId,
    forbiddenKeyIds:[previousActive.keyId,target.keyId],now
  });
}
export function verifyAuthorityTrustInventoryChain(chain,{
  policy,expectedPolicySha256,expectedLatestSha256,tenantId,deploymentId,maxAgeMs,now=Date.now()
}){
  if(!Array.isArray(chain)||!chain.length)fail("AUTHORITY_INVENTORY_EMPTY");
  if(typeof expectedLatestSha256!=="string"||!HASH.test(expectedLatestSha256)||
      !Number.isSafeInteger(now)||now<0||
      !Number.isSafeInteger(maxAgeMs)||maxAgeMs<3600_000||maxAgeMs>MAX_AGE_MS)fail();
  const context={tenantId,deploymentId};
  const trustedPolicy=parseGovernanceApprovalPolicy(JSON.stringify(policy)+"\n");
  let previous=null,latest=null;
  for(const raw of chain){
    const current=envelopeOf(raw);
    if(current.manifest.subject!==checkpointSubject(context))fail("AUTHORITY_INVENTORY_SUBJECT_MISMATCH");
    if(Date.parse(current.manifest.issuedAt)>now+30_000)fail("AUTHORITY_INVENTORY_FUTURE");
    validateTransition(previous,current,trustedPolicy,expectedPolicySha256,context,now);
    previous=current;latest=current;
  }
  const latestSha=authorityTrustInventorySha256(latest);
  if(latestSha!==expectedLatestSha256)fail("AUTHORITY_INVENTORY_DIGEST_MISMATCH");
  if(now-Date.parse(latest.manifest.issuedAt)>maxAgeMs)fail("AUTHORITY_INVENTORY_STALE");
  return {latest,latestSha256:latestSha,activeKeyId:activeAuthority(latest).keyId};
}
export function resolveTrustAuthority(inventory,{keyId,issuedAt}){
  const value=envelopeOf(inventory);
  if(typeof keyId!=="string"||!HASH.test(keyId))fail();
  strictIso(issuedAt);
  const entry=value.manifest.authorities.find(candidate=>candidate.keyId===keyId);
  if(!entry)fail("AUTHORITY_INVENTORY_KEY_NOT_ENROLLED");
  if(entry.status==="REVOKED")fail("AUTHORITY_INVENTORY_KEY_REVOKED");
  const at=Date.parse(issuedAt);
  if(at<Date.parse(entry.validFrom)||(entry.validUntil!==null&&at>=Date.parse(entry.validUntil)))
    fail("AUTHORITY_INVENTORY_KEY_OUTSIDE_VALIDITY");
  return publicKeyFromSpki(entry.publicKeySpki);
}

function assertDirectory(directory){
  if(typeof directory!=="string"||!isAbsolute(directory)||directory==="/"||directory.includes("\0"))fail();
  let stat;try{stat=lstatSync(directory);}catch{fail("AUTHORITY_INVENTORY_DIRECTORY_INVALID");}
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o002)!==0)fail("AUTHORITY_INVENTORY_DIRECTORY_UNSAFE");
}
function inventoryPath(directory,generation){
  return join(directory,`authority-${String(generation).padStart(6,"0")}.json`);
}
export function writeAuthorityTrustInventoryGeneration(directory,value){
  assertDirectory(directory);
  const envelope=envelopeOf(value);
  const path=inventoryPath(directory,envelope.manifest.generation);
  let fd;
  try{fd=openSync(path,"wx",0o600);writeFileSync(fd,encodeAuthorityTrustInventory(envelope));fsyncSync(fd);}
  catch(error){fail(error?.code==="EEXIST"?"AUTHORITY_INVENTORY_GENERATION_EXISTS":"AUTHORITY_INVENTORY_WRITE_FAILED");}
  finally{if(fd!==undefined)closeSync(fd);}
  const dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{if(!fstatSync(dir).isDirectory())fail();fsyncSync(dir);}finally{closeSync(dir);}
  return {generation:envelope.manifest.generation,inventorySha256:authorityTrustInventorySha256(envelope)};
}
export function readAuthorityTrustInventoryChain(directory){
  assertDirectory(directory);
  const files=readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&FILE.test(entry.name))
    .map(entry=>entry.name).sort();
  if(!files.length)return[];
  return files.map((name,index)=>{
    const match=FILE.exec(name);
    if(!match||Number(match[1])!==index+1)fail("AUTHORITY_INVENTORY_GENERATION_GAP");
    return parseAuthorityTrustInventory(readCheckpointFile(join(directory,name),{maxBytes:MAX_FILE}).toString("utf8"));
  });
}
function readPublicKey(path){
  const pem=readCheckpointFile(path,{maxBytes:16_384});
  if(!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----"))fail("AUTHORITY_INVENTORY_KEY_INVALID");
  return keyOf(createPublicKey(pem),"public");
}
function readPolicy(path){return parseGovernanceApprovalPolicy(readCheckpointFile(path,{maxBytes:65_536}).toString("utf8"));}
function readBundle(path){return parseGovernanceApprovalBundle(readCheckpointFile(path,{maxBytes:65_536}).toString("utf8"));}
function flags(argv,command){
  const allowed=new Set([
    "--tenant-id","--deployment-id","--inventory-dir","--policy","--expected-policy-sha256",
    ...(command==="verify"?["--expected-latest-sha256","--max-age-hours"]:
      ["--approval-bundle","--authority-public-key-file"]),
    ...(command==="rotate"||command==="recover"?["--expected-current-sha256"]:[])
  ]);
  const values={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];if(!allowed.has(flag)||Object.hasOwn(values,flag))fail();
    const value=argv[++i];if(!value||value.startsWith("--")||value.includes("\0"))fail();values[flag]=value;
  }
  return values;
}
function age(value){
  if(typeof value!=="string"||!/^[1-9][0-9]{0,5}$/.test(value))fail();
  const ms=Number(value)*3600_000;if(!Number.isSafeInteger(ms)||ms<3600_000||ms>MAX_AGE_MS)fail();return ms;
}
export async function runAuthorityTrustInventoryCli(argv,clock=Date.now){
  const [command,...rest]=argv;if(!["init","rotate","recover","verify"].includes(command))fail();
  const values=flags(rest,command);
  const required=["--tenant-id","--deployment-id","--inventory-dir","--policy","--expected-policy-sha256",
    ...(command==="verify"?["--expected-latest-sha256","--max-age-hours"]:
      ["--approval-bundle","--authority-public-key-file"]),
    ...(command==="rotate"||command==="recover"?["--expected-current-sha256"]:[])];
  if(required.some(flag=>!values[flag]))fail();
  if(!isAbsolute(values["--inventory-dir"])||
      !HASH.test(values["--expected-policy-sha256"])||
      (values["--expected-latest-sha256"]!==undefined&&!HASH.test(values["--expected-latest-sha256"]))||
      (values["--expected-current-sha256"]!==undefined&&!HASH.test(values["--expected-current-sha256"])))fail();
  const context={tenantId:values["--tenant-id"],deploymentId:values["--deployment-id"]};
  checkpointSubject(context);
  const policy=readPolicy(values["--policy"]);
  const chain=readAuthorityTrustInventoryChain(values["--inventory-dir"]);
  if(command==="verify"){
    const result=verifyAuthorityTrustInventoryChain(chain,{
      policy,expectedPolicySha256:values["--expected-policy-sha256"],
      expectedLatestSha256:values["--expected-latest-sha256"],...context,maxAgeMs:age(values["--max-age-hours"]),now:clock()
    });
    return {ok:true,code:"AUTHORITY_INVENTORY_VALID",generation:result.latest.manifest.generation,
      latestSha256:result.latestSha256,activeKeyId:result.activeKeyId};
  }
  const publicKey=readPublicKey(values["--authority-public-key-file"]);
  const bundle=readBundle(values["--approval-bundle"]);
  let next;
  if(command==="init"){
    if(chain.length)fail("AUTHORITY_INVENTORY_ALREADY_INITIALIZED");
    next=createInitialAuthorityTrustInventory(publicKey,policy,bundle,context,{
      expectedPolicySha256:values["--expected-policy-sha256"],now:clock()
    });
  }else{
    const current=verifyAuthorityTrustInventoryChain(chain,{
      policy,expectedPolicySha256:values["--expected-policy-sha256"],
      expectedLatestSha256:values["--expected-current-sha256"],...context,maxAgeMs:MAX_AGE_MS,now:clock()
    }).latest;
    next=(command==="rotate"?rotateAuthorityTrustInventory:recoverAuthorityTrustInventory)(
      current,publicKey,policy,bundle,context,{
        expectedPolicySha256:values["--expected-policy-sha256"],
        expectedCurrentSha256:values["--expected-current-sha256"],now:clock()
      }
    );
  }
  const written=writeAuthorityTrustInventoryGeneration(values["--inventory-dir"],next);
  return {ok:true,code:command==="init"?"AUTHORITY_INVENTORY_INITIALIZED":
    command==="rotate"?"AUTHORITY_INVENTORY_ROTATED":"AUTHORITY_INVENTORY_RECOVERED",
    generation:written.generation,latestSha256:written.inventorySha256,activeKeyId:activeAuthority(next).keyId};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await runAuthorityTrustInventoryCli(process.argv.slice(2))));}
  catch(error){console.error(JSON.stringify({ok:false,code:error instanceof AuthorityInventoryError?error.code:"AUTHORITY_INVENTORY_OPERATION_FAILED"}));process.exitCode=1;}
}
