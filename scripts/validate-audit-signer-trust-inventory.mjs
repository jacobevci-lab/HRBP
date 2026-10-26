import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const trustPath = "scripts/audit-signer-trust-inventory.mjs";
const trustTestPath = "scripts/audit-signer-trust-inventory.test.mjs";
const archivePath = "scripts/audit-checkpoint-archive.mjs";
const archiveTestPath = "scripts/audit-checkpoint-archive.test.mjs";
const packagePath = "package.json";
const dockerPath = "Dockerfile.onprem";

const [trust, trustTests, archive, archiveTests, pkg, dockerfile] = await Promise.all([
  readFile(trustPath, "utf8"),
  readFile(trustTestPath, "utf8"),
  readFile(archivePath, "utf8"),
  readFile(archiveTestPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(dockerPath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(trust, /HRBP-AUDIT-SIGNER-TRUST-INVENTORY:1\\n/, "trust inventory requires a dedicated signing domain");
expect(trust, /CHECKPOINT_SIGNER_TRUST_INVENTORY/, "trust inventory scope must be fixed");
expect(trust, /authorityKeyId/, "inventory must bind the independent authority key");
expect(trust, /previousInventorySha256/, "every later generation must bind the previous inventory digest");
expect(trust, /expectedLatestSha256/, "verification must require an externally pinned latest digest");
expect(trust, /expected-current-sha256/, "rotation and revocation must require an externally pinned current digest");
expect(trust, /TRUST_INVENTORY_CHAIN_INVALID/, "generation-chain mismatch must fail closed");
expect(trust, /TRUST_INVENTORY_SIGNER_REVOKED/, "revoked signer use must fail closed");
expect(trust, /TRUST_INVENTORY_SIGNER_OUTSIDE_VALIDITY/, "historical signer validity window must be enforced");
expect(trust, /TRUST_INVENTORY_MULTIPLE_ACTIVE_KEYS/, "inventory may not silently accept multiple active signers");
expect(trust, /TRUST_INVENTORY_NO_ACTIVE_SIGNER/, "rotation must require a current active signer");
expect(trust, /openSync\(path, "wx", 0o600\)/, "inventory generations must be no-overwrite files");
expect(trust, /inventory-\$\{String\(generation\(gen\)\)\.padStart\(6, "0"\)\}\.json/, "generation filenames must be deterministic");
expect(trust, /--acknowledge-separate-trust-authority/, "mutating trust inventory requires explicit authority acknowledgement");
expect(trust, /BEGIN PUBLIC KEY/, "signer enrollment must accept public keys, not private signer material");
expect(trust, /privateKey: true/, "authority private key file must retain strict owner/mode checks");

reject(trust, /DATABASE_URL|new Client\(|from ["']pg["']|fetch\(|node:http|node:https|node:net/, "trust governance must remain offline and database-independent");
reject(trust, /unlinkSync\(|rmSync\(|force:\s*true/, "trust inventory must not silently delete or rewrite generations");
reject(trust, /rejectUnauthorized\s*:\s*false/, "trust tooling must not introduce disabled transport trust");

expect(trustTests, /rotation retires exactly one signer/, "rotation semantics need executable coverage");
expect(trustTests, /historical signer resolution honors the rotation validity boundary/, "historical validity windows need executable coverage");
expect(trustTests, /revocation remains fail-closed/, "revocation needs executable coverage");
expect(trustTests, /chain rewrite, rollback and generation gaps/, "rollback and chain rewrite need executable coverage");
expect(trustTests, /externally pinned current digest/, "stale rotation input needs executable coverage");
expect(trustTests, /does not accept a signer private key as an enrollment source/, "signer private-key enrollment must be rejected");

expect(archive, /readSignerTrustInventoryChain/, "archive verification must consume the governed trust chain");
expect(archive, /resolveCheckpointSigner/, "archive verification must resolve signer validity from the inventory");
expect(archive, /expected-trust-sha256/, "archive verification must pin the trust inventory generation externally");
expect(archiveTests, /governed archive verification resolves historical signers/, "archive/trust integration needs executable coverage");
expect(archiveTests, /archive verify accepts exactly one trust source mode/, "direct and governed trust modes must be mutually exclusive");

expect(pkg, /audit-signer-trust-inventory\.test\.mjs/, "trust inventory tests must be mandatory");
expect(pkg, /validate-audit-signer-trust-inventory\.mjs/, "trust inventory static contract must be mandatory");
reject(dockerfile, /audit-signer-trust-inventory\.mjs/, "independent trust authority tooling must not be bundled in the on-prem app image");

console.log("Audit signer trust governance: offline authority-signed generations, rotation/revocation and archive signer resolution verified.");
