import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { collectS3Retention, collectorChildEnvironment, normalizeS3Readback } from "./audit-pilot-s3-collector.mjs";
import { S3_RETENTION_PROFILE, validateS3RetentionObservation } from "./audit-pilot-s3-retention.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => JSON.stringify(value) + "\n";
const commands = ["get-bucket-versioning", "get-object-lock-configuration", "head-object", "get-object-retention", "get-object-legal-hold"];
const credentials = { AWS_ACCESS_KEY_ID: "synthetic-access-id", AWS_SECRET_ACCESS_KEY: "synthetic-secret-value", AWS_SESSION_TOKEN: "synthetic-session-token" };
const cli = fileURLToPath(new URL("./audit-pilot-s3-collector.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-s3-collector-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now(), until = new Date(now + 86400_000 * 365).toISOString();
  const archive = Buffer.from([0, 255, 127, 1, 2, 3]);
  const requirements = { profile: S3_RETENTION_PROFILE, bucket: "test-audit-vault", key: "audit/archive.bin",
    versionId: "test-version-123", expectedBucketOwner: "123456789012", archiveSha256: hash(archive),
    archiveSizeBytes: archive.length, minRetentionUntilUtc: until, maxObservationAgeSeconds: 3600, legalHoldRequired: true };
  const request = { schemaVersion: 1, scope: "HRBP_S3_READ_COLLECTION:1", region: "eu-central-1", requirements };
  const options = { requestPath: join(root, "request.json"), expectedRequestSha256: "", archivePath: join(root, "archive.bin"),
    awsCliPath: join(root, "aws-fake.mjs"), outputDirectory: join(root, "collected"), allowReadOnlyAws: true };
  writeFileSync(options.archivePath, archive, { mode: 0o600 });
  const outputs = {
    "get-bucket-versioning": { Status: "Enabled", MFADelete: "Disabled" },
    "get-object-lock-configuration": { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 1 } } } },
    "head-object": { VersionId: requirements.versionId, ContentLength: archive.length,
      ChecksumSHA256: createHash("sha256").update(archive).digest("base64"), ChecksumType: "FULL_OBJECT",
      ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: until.replace("Z", "+00:00"), ObjectLockLegalHoldStatus: "ON",
      ETag: "not-a-sha256-proof", Metadata: { sensitive: "customer-sensitive-metadata" } },
    "get-object-retention": { Retention: { Mode: "COMPLIANCE", RetainUntilDate: until } },
    "get-object-legal-hold": { LegalHold: { Status: "ON" } }
  };
  const fx = { root, now, request, options, archive, outputs, log: join(root, "commands.jsonl") };
  saveRequest(fx); fake(fx); return fx;
}
function saveRequest(fx, text = encode(fx.request)) {
  writeFileSync(fx.options.requestPath, text, { mode: 0o600 });
  fx.options.expectedRequestSha256 = hash(text);
}
function fake(fx, settings = {}) {
  // Local test executable only: no AWS SDK, HTTP client, network call, or real credentials.
  const source = `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args=process.argv.slice(2), settings=${JSON.stringify(settings)}, outputs=${JSON.stringify(fx.outputs)};
appendFileSync(${JSON.stringify(fx.log)}, JSON.stringify({args, envKeys:Object.keys(process.env),
  config:process.env.AWS_CONFIG_FILE, credentialsFile:process.env.AWS_SHARED_CREDENTIALS_FILE,
  retries:process.env.AWS_MAX_ATTEMPTS, metadata:process.env.AWS_EC2_METADATA_DISABLED,
  credentialsPresent:!!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_SESSION_TOKEN)})+"\\n");
if(args[0]==="--version") {
  if(settings.hangVersion) { setInterval(()=>{},1000); }
  else console.log(settings.version || "aws-cli/2.38.0 Python/3.13 Linux/test");
} else {
 const command=args[1];
 if(command===settings.failAt) { console.error("synthetic-secret-value private/bucket/raw/error");process.exit(1); }
 if(command===settings.killAt) process.kill(process.pid,"SIGTERM");
 if(command===settings.oversizeAt) process.stdout.write("x".repeat(200000));
 else if(command===settings.malformedAt) process.stdout.write("invalid secret payload");
 else if(command===settings.badUtfAt) process.stdout.write(Buffer.from([0xff,0xfe,0x7b]));
 else console.log(JSON.stringify(outputs[command],null,2));
}
`;
  writeFileSync(fx.options.awsCliPath, source, { mode: 0o700 }); chmodSync(fx.options.awsCliPath, 0o700);
}
const collect = (fx, extras = {}) => collectS3Retention(fx.options, { environment: credentials, ...extras });
const log = fx => existsSync(fx.log) ? readFileSync(fx.log, "utf8").trim().split("\n").map(JSON.parse) : [];
function noBundle(fx, result) { assert.equal(result.ok, false); assert.equal(existsSync(fx.options.outputDirectory), false); }
function cliArgs(fx) {
  return ["--request", fx.options.requestPath, "--expected-request-sha256", fx.options.expectedRequestSha256,
    "--archive", fx.options.archivePath, "--aws-cli", fx.options.awsCliPath, "--out-dir", fx.options.outputDirectory, "--allow-read-only-aws"];
}

test("collector uses five real child processes for fixed read commands and creates compatible evidence plus raw provenance", t => {
  const fx = fixture(t), result = collect(fx);
  assert.equal(result.ok, true);
  assert.equal(result.observations, 5);
  assert.equal(result.providerAttestationVerified, false);
  assert.equal(result.lockEnforcementTested, false);
  const calls = log(fx); assert.equal(calls.length, 6);
  assert.deepEqual(calls.slice(1).map(call => call.args[1]), commands);
  for (const call of calls.slice(1)) {
    const args = call.args, input = JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
    assert.equal(input.ExpectedBucketOwner, fx.request.requirements.expectedBucketOwner);
    assert.equal(input.Bucket, fx.request.requirements.bucket);
    assert.equal(args[args.indexOf("--endpoint-url") + 1], "https://s3.eu-central-1.amazonaws.com");
    assert.ok(!args.includes("--no-verify-ssl") && !args.includes("--no-sign-request"));
    if (args[1] !== commands[0] && args[1] !== commands[1]) assert.equal(input.VersionId, fx.request.requirements.versionId);
  }
  const out = fx.options.outputDirectory;
  const observation = JSON.parse(readFileSync(join(out, "G04.bin")));
  assert.equal(observation.headObject.response.DeleteMarker, false);
  assert.equal(observation.headObject.response.ObjectLockRetainUntilDate, fx.request.requirements.minRetentionUntilUtc);
  assert.deepEqual(readFileSync(join(out, "G05.bin")), fx.archive);
  const manifest = JSON.parse(readFileSync(join(out, "collection-manifest.json")));
  assert.equal(manifest.status, "COLLECTED_NOT_AUTHORIZED");
  assert.equal(manifest.operations.length, 5);
  for (const file of manifest.files) {
    const bytes = readFileSync(join(out, file.name));
    assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    assert.equal(lstatSync(join(out, file.name)).mode & 0o777, 0o600);
  }
  assert.equal(lstatSync(out).mode & 0o777, 0o700);
  assert.match(readFileSync(join(out, "headObject.raw.json"), "utf8"), /customer-sensitive-metadata/);
  assert.doesNotMatch(readFileSync(join(out, "G04.bin"), "utf8"), /customer-sensitive-metadata/);
  assert.equal(validateS3RetentionObservation(observation, fx.request.requirements, {
    now: Date.now(), reviewedAtUtc: new Date().toISOString(), approvedRetentionUntilUtc: fx.request.requirements.minRetentionUntilUtc,
    archiveSha256: hash(fx.archive), archiveSizeBytes: fx.archive.length
  }).verifiedObservations, 5);
  assert.equal(hash(readFileSync(join(out, "collection-manifest.json"))), result.manifestSha256);
});

test("consent, independent request pin and archive byte match are required before any subprocess", t => {
  for (const mutation of [fx => { fx.options.allowReadOnlyAws = false; }, fx => { fx.options.expectedRequestSha256 = "a".repeat(64); },
    fx => writeFileSync(fx.options.archivePath, "changed"), fx => { fx.options.extra = "unapproved"; }]) {
    const fx = fixture(t); mutation(fx); noBundle(fx, collect(fx)); assert.deepEqual(log(fx), []);
  }
});

test("request rejects endpoint injection, unsupported partition, aliases and unexpected fields before credentials or network", t => {
  for (const mutation of [fx => { fx.request.region = "eu-central-1.evil.test"; }, fx => { fx.request.region = "us-gov-west-1"; },
    fx => { fx.request.endpoint = "https://evil.test"; }, fx => { fx.request.requirements.bucket = "evil-s3alias"; },
    fx => { fx.request.requirements.versionId = "null"; }, fx => { fx.request.requirements.minRetentionUntilUtc = "2000-01-01T00:00:00.000Z"; }]) {
    const fx = fixture(t); mutation(fx); saveRequest(fx); noBundle(fx, collect(fx)); assert.deepEqual(log(fx), []);
  }
});

test("duplicate keys, pretty request JSON and linked request files cannot become a collection plan", t => {
  for (const mode of ["duplicate", "pretty", "link"]) {
    const fx = fixture(t);
    if (mode === "duplicate") saveRequest(fx, encode(fx.request).replace('{"schemaVersion":1', '{"schemaVersion":2,"schemaVersion":1'));
    if (mode === "pretty") saveRequest(fx, JSON.stringify(fx.request, null, 2) + "\n");
    if (mode === "link") { symlinkSync(fx.options.requestPath, join(fx.root, "link")); fx.options.requestPath = join(fx.root, "link"); }
    noBundle(fx, collect(fx)); assert.deepEqual(log(fx), []);
  }
});

test("only temporary environment credentials pass; profiles, proxies, custom CA and loader overrides are stripped", t => {
  const fx = fixture(t), source = { ...credentials, HTTP_PROXY: "https://evil.test", AWS_PROFILE: "wrong",
    AWS_ENDPOINT_URL: "https://evil.test", AWS_DATA_PATH: "/evil", AWS_CA_BUNDLE: "/evil",
    AWS_CONTAINER_CREDENTIALS_FULL_URI: "https://evil.test", NODE_OPTIONS: "--require=/evil", LD_PRELOAD: "/evil", PRIVATE_DB: "secret" };
  const child = collectorChildEnvironment(source);
  for (const key of Object.keys(source).filter(key => !Object.hasOwn(credentials, key))) assert.equal(child[key], undefined);
  assert.equal(collect(fx, { environment: source }).ok, true);
  for (const call of log(fx)) {
    assert.equal(call.config, "/dev/null"); assert.equal(call.credentialsFile, "/dev/null");
    assert.equal(call.retries, "1"); assert.equal(call.metadata, "true"); assert.equal(call.credentialsPresent, true);
    assert.ok(!call.envKeys.includes("AWS_PROFILE") && !call.envKeys.includes("HTTP_PROXY"));
  }
  for (const key of Object.keys(credentials)) {
    const q = fixture(t), environment = { ...credentials }; delete environment[key];
    noBundle(q, collect(q, { environment })); assert.deepEqual(log(q), []);
  }
});

test("dangerous-looking object keys remain literal JSON rather than flags, URLs or local file arguments", t => {
  for (const key of ["file:///etc/passwd", "--endpoint-url", "a'; touch /tmp/must-not-exist; '"]) {
    const fx = fixture(t); fx.request.requirements.key = key; saveRequest(fx);
    assert.equal(collect(fx).ok, true);
    for (const call of log(fx).slice(3)) {
      assert.equal(JSON.parse(call.args[call.args.indexOf("--cli-input-json") + 1]).Key, key);
      assert.equal(call.args.filter(arg => arg === "--endpoint-url").length, 1);
    }
  }
});

test("existing outputs and symlinked parents are refused before AWS is launched", t => {
  const fx = fixture(t); mkdirSync(fx.options.outputDirectory); writeFileSync(join(fx.options.outputDirectory, "keep"), "unchanged");
  assert.equal(collect(fx).code, "COLLECTION_OUTPUT_EXISTS"); assert.deepEqual(log(fx), []);
  assert.equal(readFileSync(join(fx.options.outputDirectory, "keep"), "utf8"), "unchanged");
  const q = fixture(t); symlinkSync(q.root, join(q.root, "parent-link"));
  q.options.outputDirectory = join(q.root, "parent-link", "new-result");
  noBundle(q, collect(q)); assert.deepEqual(log(q), []);
});

test("CLI v1 cannot start read operations", t => {
  const fx = fixture(t); fake(fx, { version: "aws-cli/1.40.0 Python/3.12 Linux/test" });
  noBundle(fx, collect(fx)); assert.equal(log(fx).length, 1);
});

for (const command of commands) test(`failure at ${command} stops the sequence without retry or partial evidence`, t => {
  const fx = fixture(t); fake(fx, { failAt: command }); const result = collect(fx);
  assert.equal(result.code, "AWS_COMMAND_FAILED"); noBundle(fx, result);
  assert.equal(log(fx).length, commands.indexOf(command) + 2);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|private\/bucket/);
});
for (const settings of [{ oversizeAt: "head-object" }, { malformedAt: "head-object" }, { badUtfAt: "head-object" }, { killAt: "head-object" }]) {
  test(`bounded subprocess handling fails closed for ${Object.keys(settings)[0]}`, t => {
    const fx = fixture(t); fake(fx, settings); noBundle(fx, collect(fx)); assert.equal(log(fx).length, 4);
  });
}
for (const [name, mutate] of [
  ["missing checksum", r => { delete r["head-object"].ChecksumSHA256; }],
  ["missing checksum type", r => { delete r["head-object"].ChecksumType; }],
  ["multipart checksum", r => { r["head-object"].ChecksumType = "COMPOSITE"; }],
  ["missing legal hold", r => { delete r["head-object"].ObjectLockLegalHoldStatus; }],
  ["governance mode", r => { r["head-object"].ObjectLockMode = "GOVERNANCE"; }],
  ["wrong object version", r => { r["head-object"].VersionId = "substituted"; }],
  ["disabled lock", r => { r["get-object-lock-configuration"].ObjectLockConfiguration.ObjectLockEnabled = "Disabled"; }],
  ["event hold", r => { r["head-object"].ObjectLockEventHold = "ON"; }],
  ["invalid calendar date", r => { r["head-object"].ObjectLockRetainUntilDate = "2027-02-30T00:00:00Z"; }],
  ["missing retention", r => { r["get-object-retention"] = {}; }],
  ["provider error envelope", r => { r["get-bucket-versioning"].Error = { Code: "AccessDenied" }; }]
]) test(`normalization cannot turn ${name} into compliant evidence`, t => {
  const fx = fixture(t); mutate(fx.outputs); fake(fx); noBundle(fx, collect(fx));
});

test("collection clock cannot move backwards or produce observations outside the freshness window", t => {
  const fx = fixture(t); let tick = fx.now;
  noBundle(fx, collect(fx, { clock: () => tick-- }));
  const q = fixture(t); let other = q.now;
  noBundle(q, collect(q, { clock: () => (other += 86400_000) }));
});

test("version subprocess timeout actually kills a stalled executable without creating an output bundle", { timeout: 10_000 }, t => {
  const fx = fixture(t); fake(fx, { hangVersion: true });
  const start = Date.now(), result = collect(fx);
  assert.equal(result.code, "AWS_COMMAND_FAILED"); assert.ok(Date.now() - start < 9000); noBundle(fx, result);
});

test("real collector CLI returns sanitized summary and never prints target identifiers or credentials", t => {
  const fx = fixture(t);
  const child = spawnSync(process.execPath, [cli, ...cliArgs(fx)], { env: credentials, encoding: "utf8", timeout: 10_000 });
  assert.equal(child.status, 0); assert.equal(child.stderr, ""); assert.equal(JSON.parse(child.stdout).ok, true);
  for (const secret of [...Object.values(credentials), fx.request.requirements.bucket, fx.request.requirements.key, fx.root]) {
    assert.ok(!child.stdout.includes(secret));
  }
});

test("real CLI rejects missing consent and extra, duplicate, malformed arguments without running AWS", t => {
  for (const mutate of [args => args.slice(0, -1), args => [...args, "--endpoint-url", "https://evil.test"],
    args => [...args, "--allow-read-only-aws"], args => [...args, "--out-dir"], () => []]) {
    const fx = fixture(t);
    const child = spawnSync(process.execPath, [cli, ...mutate(cliArgs(fx))], { env: credentials, encoding: "utf8", timeout: 10_000 });
    assert.equal(child.status, 1); assert.equal(child.stderr, ""); assert.equal(JSON.parse(child.stdout).ok, false);
    assert.ok(!child.stdout.includes(fx.root)); assert.deepEqual(log(fx), []);
  }
});

test("importing the collector is inert and unknown normalization operations are refused", () => {
  assert.throws(() => normalizeS3Readback("delete-object", {}));
  const source = readFileSync(new URL("./audit-pilot-s3-collector.mjs", import.meta.url), "utf8");
  assert.match(source, /shell: false/); assert.match(source, /killSignal: "SIGKILL"/);
  assert.doesNotMatch(source, /"(?:put-object|delete-object|put-object-retention|put-bucket-versioning)"/);
});

import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { REQUIRED_GATES } from "./audit-pilot-gate-evaluator.mjs";
import { S3_COLLECTION_PROFILE } from "./audit-pilot-s3-provenance.mjs";

// Integration fixtures invoke the real collector with local synthetic child processes,
// then create genuine dual Ed25519 signatures. No live AWS credentials or API are used.
const rawNames = ["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"];
const verifierCli = fileURLToPath(new URL("./audit-pilot-evidence.mjs", import.meta.url));
function signedCollection(t) {
  const fx = fixture(t);
  assert.equal(collect(fx, { clock: () => fx.now - 10_000 }).ok, true);
  fx.dir = fx.options.outputDirectory;
  const roles = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
  fx.keys = roles.map(() => generateKeyPairSync("ed25519"));
  const reviewedAtUtc = new Date(fx.now - 6000).toISOString();
  const approvedAtUtc = new Date(fx.now - 4000).toISOString();
  for (const name of [...REQUIRED_GATES, ...roles]) {
    if (!["G04", "G05"].includes(name)) writeFileSync(join(fx.dir, `${name}.bin`), Buffer.from(`synthetic evidence ${name}`));
  }
  fx.packet = {
    schemaVersion: 1, customerReference: "customer-test-01", sourceCommitSha: "a".repeat(40),
    deployedWorkerVersionId: "test-worker-version-01", decisionAtUtc: new Date(fx.now - 2000).toISOString(),
    nextReviewAtUtc: new Date(fx.now + 86400_000).toISOString(), approvedRetentionUntilUtc: fx.request.requirements.minRetentionUntilUtc,
    evidence: REQUIRED_GATES.map(gate => ({ gate, status: "PASS", sha256: hash(readFileSync(join(fx.dir, `${gate}.bin`))),
      controlledLocator: "evidence-locator-01", reviewerRole: "AUDIT_REVIEWER", reviewerReference: "audit-reviewer-01", reviewedAtUtc,
      evidenceType: gate === "G01" ? "DEPLOYED_REVISION_READBACK" : gate === "G03" ? "APPROVED_TSA_RFC3161" :
        gate === "G04" ? "INDEPENDENT_PROVIDER_LOCK_READBACK" : "CONTROLLED_EVIDENCE" })),
    customerSecurityApproval: { reviewerRole: roles[0], reviewerReference: "security-reviewer-01", approvedAtUtc,
      evidenceSha256: hash(readFileSync(join(fx.dir, `${roles[0]}.bin`))) },
    recordsLegalApproval: { reviewerRole: roles[1], reviewerReference: "legal-reviewer-01", approvedAtUtc,
      evidenceSha256: hash(readFileSync(join(fx.dir, `${roles[1]}.bin`))) }
  };
  fx.policy = {
    schemaVersion: 3, scope: "HRBP_AUDIT_PILOT_TRUST:3", packetSha256: "",
    customerReference: fx.packet.customerReference, sourceCommitSha: fx.packet.sourceCommitSha,
    deployedWorkerVersionId: fx.packet.deployedWorkerVersionId,
    validFromUtc: new Date(fx.now - 60_000).toISOString(), validUntilUtc: new Date(fx.now + 86400_000).toISOString(),
    approvers: roles.map((role, i) => ({ role,
      reviewerReference: [fx.packet.customerSecurityApproval, fx.packet.recordsLegalApproval][i].reviewerReference,
      publicKeyPem: fx.keys[i].publicKey.export({ type: "spki", format: "pem" }).toString() })),
    retentionRequirements: structuredClone(fx.request.requirements),
    collectionRequirements: { profile: S3_COLLECTION_PROFILE,
      manifestSha256: hash(readFileSync(join(fx.dir, "collection-manifest.json"))), requestSha256: fx.options.expectedRequestSha256 }
  };
  fx.verifyOptions = { packetPath: join(fx.root, "packet.json"), policyPath: join(fx.root, "policy.json"),
    signaturesPath: join(fx.root, "signatures.json"), evidenceDir: fx.dir, expectedPolicySha256: "", now: fx.now };
  seal(fx); return fx;
}
function seal(fx) {
  fx.policy.packetSha256 = hash(encode(fx.packet));
  writeFileSync(fx.verifyOptions.packetPath, encode(fx.packet));
  const policySha256 = hash(encode(fx.policy));
  writeFileSync(fx.verifyOptions.policyPath, encode(fx.policy));
  fx.verifyOptions.expectedPolicySha256 = policySha256;
  // Deliberately construct the documented payload independently of the implementation helper.
  const signatures = fx.policy.approvers.map((entry, i) => {
    const keyId = hash(fx.keys[i].publicKey.export({ type: "spki", format: "der" }));
    const bytes = Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" + JSON.stringify([
      policySha256, fx.policy.packetSha256, entry.role, entry.reviewerReference, keyId
    ]));
    return { role: entry.role, reviewerReference: entry.reviewerReference, keyId,
      signature: sign(null, bytes, fx.keys[i].privateKey).toString("base64") };
  });
  writeFileSync(fx.verifyOptions.signaturesPath, encode({ schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1",
    packetSha256: fx.policy.packetSha256, trustPolicySha256: policySha256, signatures }));
}
function changeManifest(fx, mutate) {
  const path = join(fx.dir, "collection-manifest.json"), value = JSON.parse(readFileSync(path));
  mutate(value); const bytes = encode(value); writeFileSync(path, bytes);
  fx.policy.collectionRequirements.manifestSha256 = hash(bytes); seal(fx);
}
function rebindFile(fx, name, bytes) {
  writeFileSync(join(fx.dir, name), bytes);
  changeManifest(fx, manifest => {
    Object.assign(manifest.files.find(file => file.name === name), { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) });
    const operation = manifest.operations.find(item => item.rawFile === name);
    if (operation) operation.rawSha256 = hash(bytes);
  });
}
function rejectCollection(fx, reason) {
  const result = verifyPilotEvidence(fx.verifyOptions);
  assert.equal(result.decision, "NO_GO", JSON.stringify(result));
  assert.equal(result.verifiedArtifacts, 0);
  if (reason) assert.deepEqual(result.reasons, [reason]);
  for (const sensitive of [fx.root, fx.request.requirements.bucket, fx.request.requirements.expectedBucketOwner]) {
    assert.ok(!JSON.stringify(result).includes(sensitive));
  }
}
function verifierArgs(fx) {
  return ["--packet", fx.verifyOptions.packetPath, "--trust-policy", fx.verifyOptions.policyPath,
    "--expected-policy-sha256", fx.verifyOptions.expectedPolicySha256, "--signatures", fx.verifyOptions.signaturesPath,
    "--evidence-dir", fx.dir];
}

test("v3 authenticates actual collector output, nineteen files and five raw response projections without executing AWS again", t => {
  const fx = signedCollection(t);
  const calls = log(fx).length;
  const result = verifyPilotEvidence({ ...fx.verifyOptions, requiredRetentionProfile: S3_RETENTION_PROFILE,
    requiredCollectionProfile: S3_COLLECTION_PROFILE });
  assert.equal(result.decision, "READY_FOR_INDEPENDENT_AUTHORIZATION", JSON.stringify(result));
  assert.equal(result.assuranceLevel, "PINNED_SIGNATURES_DIGESTS_S3_SEMANTICS_AND_COLLECTION_PROVENANCE");
  assert.equal(result.verifiedSignatures, 2); assert.equal(result.verifiedArtifacts, 19);
  assert.deepEqual(result.collection, { profile: S3_COLLECTION_PROFILE, verifiedFiles: 7, verifiedRawResponses: 5,
    normalizedObservationMatched: true, providerAttestationVerified: false, lockEnforcementTested: false });
  assert.equal(result.retention.liveProviderVerified, false); assert.equal(log(fx).length, calls);
});

for (const name of ["collection-manifest.json", "collection-request.json", ...rawNames.map(op => `${op}.raw.json`)]) {
  test(`v3 rejects tampering and missing provenance file ${name}`, t => {
    const fx = signedCollection(t), path = join(fx.dir, name);
    writeFileSync(path, "changed"); rejectCollection(fx);
    rmSync(path); rejectCollection(fx);
  });
}
for (const [name, mutate, reason] of [
  ["unknown field", m => { m.extra = true; }, "S3_COLLECTION_MANIFEST_INVALID"],
  ["false provider attestation claim", m => { m.providerAttestationVerified = true; }, "S3_COLLECTION_MANIFEST_INVALID"],
  ["false lock test claim", m => { m.lockEnforcementTested = true; }, "S3_COLLECTION_MANIFEST_INVALID"],
  ["missing operation", m => { m.operations.pop(); }, "S3_COLLECTION_OPERATIONS_INVALID"],
  ["reordered operations", m => { m.operations.reverse(); }, "S3_COLLECTION_OPERATIONS_INVALID"],
  ["duplicate operation", m => { m.operations[1] = m.operations[0]; }, "S3_COLLECTION_OPERATIONS_INVALID"],
  ["raw path traversal", m => { m.operations[0].rawFile = "../../outside"; }, "S3_COLLECTION_OPERATIONS_INVALID"],
  ["inventory path traversal", m => { m.files[0].name = "../../outside"; }, "S3_COLLECTION_INVENTORY_INVALID"],
  ["missing file entry", m => { m.files.pop(); }, "S3_COLLECTION_INVENTORY_INVALID"],
  ["duplicate file entry", m => { m.files[1] = m.files[0]; }, "S3_COLLECTION_INVENTORY_INVALID"],
  ["incorrect length", m => { m.files[0].bytes++; }, "S3_COLLECTION_FILE_DIGEST_MISMATCH"],
  ["incorrect raw digest", m => { m.operations[0].rawSha256 = "a".repeat(64); }, "S3_COLLECTION_RAW_DIGEST_MISMATCH"],
  ["endpoint substitution", m => { m.endpoint = "https://evil.test"; }, "S3_COLLECTION_REQUEST_MISMATCH"],
  ["region substitution", m => { m.region = "us-east-1"; }, "S3_COLLECTION_REQUEST_MISMATCH"],
  ["wrong CLI major", m => { m.awsCliVersion = "aws-cli/1.0.0 Python/test"; }, "S3_COLLECTION_MANIFEST_INVALID"],
  ["invalid start date", m => { m.startedAtUtc = "not-a-date"; }, "S3_COLLECTION_CHRONOLOGY_INVALID"],
  ["post-review completion", m => { m.finishedAtUtc = new Date(Date.now() + 86400_000).toISOString(); }, "S3_COLLECTION_CHRONOLOGY_INVALID"],
  ["backwards operation time", m => { m.operations[0].startedAtUtc = m.finishedAtUtc; m.operations[0].finishedAtUtc = "2000-01-01T00:00:00.000Z"; }, "S3_COLLECTION_CHRONOLOGY_INVALID"]
]) test(`v3 rejects ${name} even with a newly approved policy pin and valid signatures`, t => {
  const fx = signedCollection(t); changeManifest(fx, mutate); rejectCollection(fx, reason);
});

test("v3 rejects raw HEAD contradicting G04 even after every raw digest, manifest pin and signature is refreshed", t => {
  const fx = signedCollection(t), raw = JSON.parse(readFileSync(join(fx.dir, "headObject.raw.json")));
  raw.ObjectLockMode = "GOVERNANCE";
  rebindFile(fx, "headObject.raw.json", JSON.stringify(raw, null, 2));
  rejectCollection(fx, "S3_COLLECTION_NORMALIZATION_MISMATCH");
});

test("v3 binds omitted normalized fields too: raw metadata edits cannot reuse an existing manifest pin", t => {
  const fx = signedCollection(t), raw = JSON.parse(readFileSync(join(fx.dir, "headObject.raw.json")));
  raw.Metadata.sensitive = "changed private metadata";
  writeFileSync(join(fx.dir, "headObject.raw.json"), JSON.stringify(raw, null, 2));
  rejectCollection(fx, "S3_COLLECTION_FILE_DIGEST_MISMATCH");
});

test("v3 rejects raw error envelopes and malformed UTF-8 even when re-signed", t => {
  const fx = signedCollection(t);
  rebindFile(fx, "headObject.raw.json", encode({ Error: { Code: "AccessDenied" } }));
  rejectCollection(fx, "AWS_RESPONSE_INVALID");
  rebindFile(fx, "headObject.raw.json", Buffer.from([0xff, 0xfe]));
  rejectCollection(fx);
});

test("v3 collection request must match both the enrollment pin and exact retained policy requirements", t => {
  const fx = signedCollection(t);
  const request = structuredClone(fx.request); request.requirements.key = "substituted/key";
  const bytes = encode(request);
  rebindFile(fx, "collection-request.json", bytes);
  rejectCollection(fx, "S3_COLLECTION_REQUEST_DIGEST_MISMATCH");
  fx.policy.collectionRequirements.requestSha256 = hash(bytes);
  changeManifest(fx, m => { m.requestSha256 = hash(bytes); });
  rejectCollection(fx, "S3_COLLECTION_REQUEST_MISMATCH");
});

test("v3 cannot omit collection pins or smuggle them into older policy versions", t => {
  const fx = signedCollection(t), original = structuredClone(fx.policy);
  for (const mutate of [p => { delete p.collectionRequirements; }, p => { p.schemaVersion = 2; p.scope = "HRBP_AUDIT_PILOT_TRUST:2"; },
    p => { p.collectionRequirements.extra = true; }, p => { p.collectionRequirements.profile = "OTHER_PROFILE"; }]) {
    fx.policy = structuredClone(original); mutate(fx.policy); seal(fx); rejectCollection(fx);
  }
});

test("v1 and v2 remain compatible but cannot satisfy a required collection profile", t => {
  const fx = signedCollection(t);
  for (const version of [2, 1]) {
    fx.policy.schemaVersion = version; fx.policy.scope = `HRBP_AUDIT_PILOT_TRUST:${version}`;
    delete fx.policy.collectionRequirements;
    if (version === 1) delete fx.policy.retentionRequirements;
    seal(fx);
    const legacy = verifyPilotEvidence(fx.verifyOptions);
    assert.equal(legacy.decision, "READY_FOR_INDEPENDENT_AUTHORIZATION"); assert.equal(legacy.verifiedArtifacts, 12);
    assert.equal(legacy.collection, undefined);
    assert.deepEqual(verifyPilotEvidence({ ...fx.verifyOptions, requiredCollectionProfile: S3_COLLECTION_PROFILE }).reasons,
      ["COLLECTION_PROFILE_REQUIRED"]);
  }
});

test("v3 refuses changed manifest without replacing the independently approved policy pin", t => {
  const fx = signedCollection(t), approved = fx.verifyOptions.expectedPolicySha256;
  changeManifest(fx, m => { m.awsCliVersion = "aws-cli/2.38.1 Python/test"; });
  fx.verifyOptions.expectedPolicySha256 = approved; rejectCollection(fx, "TRUST_POLICY_DIGEST_MISMATCH");
});

test("v3 checks both signatures before reading provenance files", t => {
  const fx = signedCollection(t);
  writeFileSync(fx.verifyOptions.signaturesPath, encode({}));
  rmSync(join(fx.dir, "collection-manifest.json"));
  rejectCollection(fx, "SIGNATURE_ENVELOPE_INVALID");
});

test("v3 uses bounded single-link inputs for all provenance data", t => {
  const fx = signedCollection(t), path = join(fx.dir, "headObject.raw.json"), raw = readFileSync(path);
  rmSync(path); symlinkSync(fx.options.requestPath, path); rejectCollection(fx);
  rmSync(path); writeFileSync(path, raw); linkSync(path, join(fx.root, "raw-hardlink")); rejectCollection(fx);
  rmSync(join(fx.root, "raw-hardlink")); truncateSync(path, 1024 * 1024 * 1024); rejectCollection(fx);
});

test("v3 CLI authenticates provenance and refuses FIFO without exposing target names or credentials", t => {
  const fx = signedCollection(t), args = [...verifierArgs(fx), "--require-retention-profile", S3_RETENTION_PROFILE,
    "--require-collection-profile", S3_COLLECTION_PROFILE];
  const run = () => spawnSync(process.execPath, [verifierCli, ...args], { encoding: "utf8", timeout: 5000 });
  const good = run(); assert.equal(good.status, 0); assert.equal(good.stderr, "");
  assert.equal(JSON.parse(good.stdout).verifiedArtifacts, 19);
  for (const secret of [fx.root, fx.request.requirements.bucket, fx.request.requirements.key, ...Object.values(credentials)]) {
    assert.ok(!good.stdout.includes(secret));
  }
  const path = join(fx.dir, "headObject.raw.json"); rmSync(path);
  assert.equal(spawnSync("mkfifo", [path]).status, 0);
  const bad = run(); assert.equal(bad.error, undefined); assert.equal(bad.status, 1);
  assert.equal(bad.stderr, ""); assert.equal(JSON.parse(bad.stdout).decision, "NO_GO");
});

test("collection profile flags reject unknown, duplicate or missing values and legacy downgrade", t => {
  const fx = signedCollection(t);
  for (const extra of [["--require-collection-profile", "unknown"], ["--require-collection-profile"],
    ["--require-collection-profile", S3_COLLECTION_PROFILE, "--require-collection-profile", S3_COLLECTION_PROFILE]]) {
    const child = spawnSync(process.execPath, [verifierCli, ...verifierArgs(fx), ...extra], { encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 1); assert.equal(child.stderr, "");
  }
  fx.policy.schemaVersion = 2; fx.policy.scope = "HRBP_AUDIT_PILOT_TRUST:2"; delete fx.policy.collectionRequirements; seal(fx);
  const child = spawnSync(process.execPath, [verifierCli, ...verifierArgs(fx), "--require-collection-profile", S3_COLLECTION_PROFILE],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 1); assert.deepEqual(JSON.parse(child.stdout).reasons, ["COLLECTION_PROFILE_REQUIRED"]);
});

test("offline provenance and shared normalization modules have no subprocess, network or credential imports", () => {
  for (const name of ["audit-pilot-s3-provenance.mjs", "audit-pilot-s3-readback.mjs"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:(?:child_process|https?|net)|\b(?:spawn|exec|fetch)\s*\(|process\.env|s3-collector\.mjs/);
  }
});
