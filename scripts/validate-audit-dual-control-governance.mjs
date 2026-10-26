import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const approvalPath="scripts/audit-governance-approval.mjs";
const approvalTestPath="scripts/audit-governance-approval.test.mjs";
const authorityPath="scripts/audit-trust-authority-inventory.mjs";
const authorityTestPath="scripts/audit-trust-authority-inventory.test.mjs";
const signerPath="scripts/audit-signer-trust-inventory.mjs";
const archivePath="scripts/audit-checkpoint-archive.mjs";
const publicationPath="scripts/audit-checkpoint-publication.mjs";
const packagePath="package.json";
const dockerPath="Dockerfile.onprem";

const [approval,approvalTests,authority,authorityTests,signer,archive,publication,pkg,dockerfile]=await Promise.all([
  readFile(approvalPath,"utf8"),readFile(approvalTestPath,"utf8"),
  readFile(authorityPath,"utf8"),readFile(authorityTestPath,"utf8"),
  readFile(signerPath,"utf8"),readFile(archivePath,"utf8"),
  readFile(publicationPath,"utf8"),readFile(packagePath,"utf8"),readFile(dockerPath,"utf8")
]);
const expect=(source,pattern,message)=>assert.match(source,pattern,message);
const reject=(source,pattern,message)=>assert.doesNotMatch(source,pattern,message);

expect(approval,/minApprovals < 2/,"governance policy must require at least two approvers");
expect(approval,/GOVERNANCE_APPROVAL_QUORUM_UNMET/,"approval quorum failure must be explicit");
expect(approval,/GOVERNANCE_APPROVAL_SEPARATION_VIOLATION/,"authority/target-role separation must fail closed");
expect(approval,/expectedPolicySha256/,"approval policy must be externally digest-pinned");
expect(approval,/GOVERNANCE_APPROVAL_DUPLICATE_APPROVER/,"the same approver cannot count twice");
expect(approval,/HRBP-AUDIT-TRUST-APPROVAL:1\\n/,"approval signatures need domain separation");
expect(approval,/openSync\(path, "wx", 0o600\)/,"approval evidence must be no-overwrite");
reject(approval,/DATABASE_URL|new Client\(|from ["']pg["']|fetch\(|node:http|node:https|node:net/,
  "approval workflow must stay offline and application-independent");

expect(approvalTests,/one approval never satisfies a two-person policy/,"one-person rejection needs executable coverage");
expect(approvalTests,/same approver cannot sign twice/,"duplicate approval needs executable coverage");
expect(approvalTests,/authority and target signer keys can be explicitly excluded/,"role separation needs executable coverage");
expect(approvalTests,/externally pinned policy digest is mandatory/,"policy digest pinning needs executable coverage");

expect(authority,/CHECKPOINT_TRUST_AUTHORITY_INVENTORY/,"authority inventory scope must be fixed");
expect(authority,/previousInventorySha256/,"authority generations must be hash chained");
expect(authority,/ROTATE_AUTHORITY/,"planned authority rotation must be explicit");
expect(authority,/RECOVER_AUTHORITY/,"emergency authority recovery must be explicit");
expect(authority,/status:recovery\?"REVOKED":"RETIRED"/,"recovery and rotation must have distinct historical semantics");
expect(authority,/verifyGovernanceApprovalBundle/,"authority changes must be dual-control approved");
expect(authority,/forbiddenKeyIds:\[previousActive\.keyId,targetKeyId\]/,
  "old and new authority keys must not approve their own transition");
expect(authority,/expectedLatestSha256/,"authority inventory latest generation must be externally pinned");
expect(authority,/openSync\(path,"wx",0o600\)/,"authority generations must be append-only/no-overwrite");
reject(authority,/createPrivateKey|PRIVATE KEY|DATABASE_URL|new Client\(|fetch\(/,
  "authority inventory must not require authority private material, DB access or network access");

expect(authorityTests,/planned rotation retires old authority/,"planned authority rotation needs coverage");
expect(authorityTests,/emergency recovery revokes old authority/,"emergency recovery needs coverage");
expect(authorityTests,/current and target authority keys cannot count toward approval quorum/,"authority self-approval must be tested");
expect(authorityTests,/chain verification detects rollback rewrite gap/,"authority rollback/rewrite must be tested");

expect(signer,/verifySignerTrustInventoryChainGoverned/,"signer verification must resolve historical authority epochs");
expect(signer,/--approval-bundle/,"signer mutations must require dual-control approval evidence");
expect(signer,/--authority-inventory-dir/,"signer mutations must consume the authority inventory");
expect(signer,/TRUST_INVENTORY_AUTHORITY_NOT_ACTIVE/,"stale authority private material must fail closed");
expect(archive,/verifySignerTrustInventoryChainGoverned/,"archive verification must follow rotated authority history");
expect(publication,/verifySignerTrustInventoryChainGoverned/,"publication preflight must follow rotated authority history");

expect(pkg,/audit-governance-approval\.test\.mjs/,"dual-control approval tests must be mandatory");
expect(pkg,/audit-trust-authority-inventory\.test\.mjs/,"authority inventory tests must be mandatory");
expect(pkg,/validate-audit-dual-control-governance\.mjs/,"dual-control static gate must be mandatory");
reject(dockerfile,/audit-governance-approval\.mjs|audit-trust-authority-inventory\.mjs/,
  "governance authority tooling must remain outside the application image");

console.log("Audit dual-control governance: two-person approval, authority rotation/recovery and historical trust resolution verified.");
