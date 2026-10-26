import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptPath="scripts/audit-checkpoint-timestamp.mjs";
const testPath="scripts/audit-checkpoint-timestamp.test.mjs";
const packagePath="package.json";
const dockerPath="Dockerfile.onprem";

const [script,tests,pkg,dockerfile]=await Promise.all([
  readFile(scriptPath,"utf8"),
  readFile(testPath,"utf8"),
  readFile(packagePath,"utf8"),
  readFile(dockerPath,"utf8")
]);
function expect(source,pattern,message){assert.match(source,pattern,message);}
function reject(source,pattern,message){assert.doesNotMatch(source,pattern,message);}

expect(script,/RFC3161_ARCHIVE_TIMESTAMP/,"timestamp evidence must use a fixed scope");
expect(script,/openssl\(\["ts", "-query", "-data", manifestPath, "-sha256", "-cert"/,
  "request must use SHA-256 and request the TSA certificate");
expect(script,/"ts", "-verify", "-queryfile", requestPath, "-in", responsePath/,
  "verification must authenticate response against the original RFC3161 request and nonce");
expect(script,/"ts", "-verify", "-data", manifestPath, "-in", responsePath/,
  "verification must independently bind the response to current archive-manifest bytes");
expect(script,/expectedTrustAnchorSha256/,"TSA trust anchor digest must be externally pinned");
expect(script,/TRUSTED_TIMESTAMP_TRUST_ANCHOR_MISMATCH/,"trust-anchor mismatch must fail closed");
expect(script,/expectedPolicyOid/,"TSA policy OID must be externally pinned");
expect(script,/TRUSTED_TIMESTAMP_POLICY_MISMATCH/,"TSA policy mismatch must fail closed");
expect(script,/TRUSTED_TIMESTAMP_FUTURE/,"trusted time in the future must remain visible");
expect(script,/TRUSTED_TIMESTAMP_DELAY_EXCEEDED/,"archive-to-TSA publication delay must be bounded");
expect(script,/timestamp-request\.tsq/,"RFC3161 request must be retained as evidence");
expect(script,/timestamp-response\.tsr/,"RFC3161 response must be retained as evidence");
expect(script,/timestamp-receipt\.json/,"bounded verification receipt must be retained");
expect(script,/openSync\(path, "wx", mode\)/,"timestamp evidence must never overwrite an existing file");
expect(script,/mkdirSync\(outputDirectory, \{ mode: 0o700 \}\)/,
  "published timestamp evidence must use a new private directory");
expect(script,/shell: false/,"OpenSSL must be invoked without a shell");
expect(script,/PATH: process\.env\.PATH/,"OpenSSL child must receive a minimal explicit environment");
expect(script,/Number\(match\[1\]\) < 3/,"operator tooling must require OpenSSL 3+");

reject(script,/fetch\(|node:http|node:https|node:net|node:tls|undici/,
  "trusted timestamp integration must remain provider-neutral and offline");
reject(script,/-no_nonce|no_nonce/,"RFC3161 request nonce must not be disabled");
reject(script,/-no_check_time|no_check_time/,"certificate time validation must not be disabled");
reject(script,/rejectUnauthorized\s*:\s*false/,"TLS trust may not be weakened");
reject(script,/shell:\s*true/,"shell execution is forbidden");
reject(script,/DATABASE_URL|new Client\(|from ["']pg["']/,
  "timestamp verification must not depend on the application database");

expect(tests,/real RFC3161 response verifies nonce, archive bytes, TSA chain and policy/,
  "real cryptographic RFC3161 verification needs executable coverage");
expect(tests,/valid timestamp response cannot be replayed against a different valid archive/,
  "archive replay/substitution needs executable coverage");
expect(tests,/tampered TSA response and wrong external trust pin fail closed/,
  "tamper and trust-pin failures need executable coverage");
expect(tests,/TSA policy OID is externally pinned/,
  "policy pinning needs executable coverage");
expect(tests,/trusted time detects future verifier clock and excessive archive-to-TSA delay/,
  "time-window failures need executable coverage");
expect(tests,/published timestamp evidence is no-overwrite and re-verifies offline/,
  "retained evidence re-verification needs executable coverage");
expect(tests,/openssl\(\["req","-x509","-newkey","rsa:2048"/,
  "tests must generate a real ephemeral CA rather than mock timestamp crypto");
expect(tests,/extendedKeyUsage=critical,timeStamping/,
  "test TSA certificate must be constrained to timestamp signing");

expect(pkg,/audit-checkpoint-timestamp\.test\.mjs/,
  "RFC3161 tests must be part of a mandatory validation script");
expect(pkg,/validate-audit-checkpoint-timestamp\.mjs/,
  "RFC3161 static trust contract must be mandatory");
reject(dockerfile,/audit-checkpoint-timestamp\.mjs/,
  "independent timestamp tooling must not be bundled into the HRBP application image");

console.log("Audit RFC3161 timestamp contract: offline TSA request/verification, trust pinning and retained evidence verified.");
