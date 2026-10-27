import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
