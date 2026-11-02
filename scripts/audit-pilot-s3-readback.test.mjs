import assert from "node:assert/strict";
import test from "node:test";
import { parseS3CollectionJson, S3ReadbackError } from "./audit-pilot-s3-readback.mjs";

const parse = (text, compact = false) => parseS3CollectionJson(Buffer.from(text), compact);
const invalid = error => error instanceof S3ReadbackError && error.code === "COLLECTION_JSON_INVALID" &&
  error.message === "S3 readback decoding failed.";

for (const [name, text] of [
  ["top-level status", '{"Status":"Suspended","Status":"Enabled"}'],
  ["nested retention mode", '{"Retention":{"Mode":"GOVERNANCE","Mode":"COMPLIANCE"}}'],
  ["Unicode-escaped member name", '{"Retention":{"Mode":"GOVERNANCE","Mo\\u0064e":"COMPLIANCE"}}'],
  ["escaped backslash name", '{"a\\\\b":1,"a\\u005Cb":2}'],
  ["surrogate-pair name", '{"😀":1,"\\ud83d\\ude00":2}'],
  ["array member object", '{"items":[{"Status":"OFF","Status":"ON"}]}'],
  ["discarded metadata", '{"Status":"Enabled","Metadata":{"private":"first","private":"last"}}'],
  ["equal duplicate values", '{"Status":"Enabled","Status":"Enabled"}'],
  ["empty member name", '{"":1,"":2}'],
  ["prototype-named member", '{"__proto__":1,"__proto__":2}']
]) test(`decoder rejects duplicate ${name} before normalization`, () => {
  assert.throws(() => parse(text), invalid);
});

test("decoder accepts pretty raw JSON and repeated names in different objects", () => {
  const text = ' \r\n{ "items": [{"Status":"ON"}, {"Status":"OFF"}], "Status":"Enabled" }\t';
  assert.deepEqual(parse(text), JSON.parse(text));
});

test("decoder distinguishes strings from structural punctuation and supports JSON escapes", () => {
  const value = { text: '"Status":true, {} [ ] : \\ /\n\t', nested: { text: "second" },
    unicode: "İstanbul 😀", e: "\u2028\u2029", flags: [true, false, null], n: [-1, 1.5, 2e4] };
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  const before = Buffer.from(bytes);
  assert.deepEqual(parseS3CollectionJson(bytes), value);
  assert.deepEqual(bytes, before);
  assert.deepEqual(parse('{"\\u0041":"a\\/b","quoted\\\"key":"escaped\\\\value"}'),
    { A: "a/b", 'quoted"key': "escaped\\value" });
});

test("decoder keeps prototype-named properties as inert own data", () => {
  const value = parse('{"__proto__":{"polluted":true},"constructor":1,"toString":2}');
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("decoder accepts 32 container levels and rejects 33 before native object construction", () => {
  const nested = depth => '{"a":'.repeat(depth) + '0' + '}'.repeat(depth);
  assert.doesNotThrow(() => parse(nested(32)));
  assert.throws(() => parse(nested(33)), invalid);
  assert.throws(() => parse('{"a":' + '['.repeat(32) + '0' + ']'.repeat(32) + '}'), invalid);
});

test("decoder accepts the 8192-token boundary and rejects the next token", () => {
  // Seven structural/key tokens plus 2*n-1 array value/comma tokens = 2*n+6.
  const atLimit = '{"a":[' + Array(4093).fill('0').join(',') + ']}';
  assert.equal(parse(atLimit).a.length, 4093);
  assert.throws(() => parse(atLimit.replace(']}', ',0]}')), invalid);
});

test("decoder accepts exactly 64 KiB but bounds direct callers before UTF-8 decoding", () => {
  const base = '{"Status":"Enabled"}';
  assert.deepEqual(parse(base.padEnd(65536, " ")), { Status: "Enabled" });
  assert.throws(() => parse(base.padEnd(65537, " ")), invalid);
  const unicode = JSON.stringify({ text: "İ".repeat(32768) });
  assert.ok(unicode.length < 65536 && Buffer.byteLength(unicode) > 65536);
  assert.throws(() => parse(unicode), invalid);
});

test("decoder rejects non-byte input and non-boolean encoding options", () => {
  for (const value of [null, undefined, false, 3, "{}", {}, new ArrayBuffer(2), Buffer.alloc(0)]) {
    assert.throws(() => parseS3CollectionJson(value), invalid);
  }
  for (const option of [null, 0, "false", {}]) assert.throws(() => parse("{}", option), invalid);
  assert.deepEqual(parseS3CollectionJson(new Uint8Array(Buffer.from("{}"))), {});
});

test("decoder preserves compact request and manifest encoding requirements", () => {
  assert.deepEqual(parse('{"a":1}\n', true), { a: 1 });
  for (const text of ['{"a":1}', '{ "a":1}\n', '{"a":1,"a":2}\n', '{"a":1e0}\n']) {
    assert.throws(() => parse(text, true), invalid);
  }
});

test("decoder rejects malformed syntax, trailing values and non-JSON whitespace", () => {
  for (const text of ['{', '{"a":1,}', '{"a":01}', '{"a":+1}', '{"a":NaN}', '{"a":Infinity}',
    '{"a":1 2}', '{"a":[1,]}', '{"a":1}{"b":2}', '{"a":/*comment*/1}',
    '{"a":"\\x20"}', '{"a":"line\nfeed"}', '{"a":true\u00a0}', '\ufeff{}', '[]', 'null', 'true', '1', '"s"']) {
    assert.throws(() => parse(text), invalid);
  }
});

test("decoder rejects non-finite numbers rather than normalizing Infinity to null", () => {
  for (const text of ['{"value":1e400}', '{"a":[-1e400]}']) assert.throws(() => parse(text), invalid);
});

test("decoder rejects malformed UTF-8 and unpaired UTF-16 escapes with sanitized errors", () => {
  for (const bytes of [Buffer.from([0xff, 0x7b]), Buffer.from('{"secret":"\\ud800"}'),
    Buffer.from('{"\\udfff":1}')]) assert.throws(() => parseS3CollectionJson(bytes), invalid);
});

test("decoder preserves explicit provider error rejection", () => {
  for (const key of ["Error", "Errors"]) assert.throws(() => parse(JSON.stringify({ [key]: {} })),
    error => error instanceof S3ReadbackError && error.code === "AWS_RESPONSE_INVALID");
});

test("decoder agrees with native JSON for deterministic bounded unique-key fixtures", () => {
  let state = 123456789;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  const strings = ["", "normal", "quote\"slash\\", "İ😀", "a:b{}[]", "\n\r\t", "__proto__"];
  function value(depth) {
    const choice = Math.floor(random() * (depth < 4 ? 6 : 4));
    if (choice === 0) return strings[Math.floor(random() * strings.length)];
    if (choice === 1) return Math.floor(random() * 10000) - 5000;
    if (choice === 2) return random() > 0.5;
    if (choice === 3) return null;
    if (choice === 4) return Array.from({ length: 3 }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`k${i}`, value(depth + 1)]));
  }
  for (let index = 0; index < 200; index++) {
    const text = JSON.stringify({ data: value(0) }, null, index % 3 === 0 ? 2 : undefined);
    assert.deepEqual(parse(text), JSON.parse(text));
  }
});

// Exercise the actual collector and signed v3 verifier, not just the pure decoder.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { collectS3Retention } from "./audit-pilot-s3-collector.mjs";
import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { REQUIRED_GATES } from "./audit-pilot-gate-evaluator.mjs";
import { S3_RETENTION_PROFILE } from "./audit-pilot-s3-retention.mjs";
import { S3_COLLECTION_PROFILE } from "./audit-pilot-s3-provenance.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => JSON.stringify(value) + "\n";
const credentials = { AWS_ACCESS_KEY_ID: "synthetic-access", AWS_SECRET_ACCESS_KEY: "synthetic-secret",
  AWS_SESSION_TOKEN: "synthetic-session" };
const operations = [
  ["bucketVersioning", "get-bucket-versioning", "Status", "Suspended"],
  ["objectLockConfiguration", "get-object-lock-configuration", "ObjectLockEnabled", "Disabled"],
  ["headObject", "head-object", "ObjectLockMode", "GOVERNANCE"],
  ["objectRetention", "get-object-retention", "Mode", "GOVERNANCE"],
  ["legalHold", "get-object-legal-hold", "Status", "OFF"]
];
function duplicate(text, key, first) {
  const pattern = new RegExp(`"${key}"\\s*:`);
  assert.match(text, pattern);
  return text.replace(pattern, `"${key}":${JSON.stringify(first)},"${key}":`);
}
function pipeline(t) {
  const root = mkdtempSync(join(tmpdir(), "hrbp-json-pipeline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now(), iso = delta => new Date(now + delta).toISOString();
  const archive = Buffer.from([0, 1, 254, 255]);
  const requirements = { profile: S3_RETENTION_PROFILE, bucket: "synthetic-json-vault", key: "private/archive.bin",
    versionId: "json-fixture-version", expectedBucketOwner: "123456789012", archiveSha256: hash(archive),
    archiveSizeBytes: archive.length, minRetentionUntilUtc: iso(365 * 86400_000),
    maxObservationAgeSeconds: 3600, legalHoldRequired: true };
  const request = { schemaVersion: 1, scope: "HRBP_S3_READ_COLLECTION:1", region: "eu-central-1", requirements };
  const options = { requestPath: join(root, "request.json"), expectedRequestSha256: hash(encoded(request)),
    archivePath: join(root, "archive.bin"), awsCliPath: join(root, "local-aws.mjs"),
    outputDirectory: join(root, "collected"), allowReadOnlyAws: true };
  writeFileSync(options.requestPath, encoded(request), { mode: 0o600 });
  writeFileSync(options.archivePath, archive, { mode: 0o600 });
  const outputs = {
    "get-bucket-versioning": { Status: "Enabled" },
    "get-object-lock-configuration": { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } },
    "head-object": { VersionId: requirements.versionId, ContentLength: archive.length,
      ChecksumSHA256: Buffer.from(requirements.archiveSha256, "hex").toString("base64"), ChecksumType: "FULL_OBJECT",
      ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: requirements.minRetentionUntilUtc,
      ObjectLockLegalHoldStatus: "ON", Metadata: { label: "test-only" } },
    "get-object-retention": { Retention: { Mode: "COMPLIANCE", RetainUntilDate: requirements.minRetentionUntilUtc } },
    "get-object-legal-hold": { LegalHold: { Status: "ON" } }
  };
  const raw = Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, JSON.stringify(value, null, 2) + "\n"]));
  const log = join(root, "calls.log");
  const writeFake = () => {
    // Actual local subprocess, no AWS SDK/network or real session credentials.
    const source = `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\n` +
      `const args=process.argv.slice(2); appendFileSync(${JSON.stringify(log)}, (args[1]||args[0])+"\\n");\n` +
      `if(args[0]==="--version") console.log("aws-cli/2.38.0 Python/3.13 Linux/test");\n` +
      `else process.stdout.write((${JSON.stringify(raw)})[args[1]]);\n`;
    writeFileSync(options.awsCliPath, source, { mode: 0o700 });
  };
  writeFake();
  const collect = () => collectS3Retention(options, { environment: credentials, clock: () => now - 10_000 });
  const keys = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
  const roles = ["CUSTOMER_SECURITY", "LEGAL_RECORDS"];
  function enroll() {
    const dir = options.outputDirectory;
    for (const gate of REQUIRED_GATES) if (!["G04", "G05"].includes(gate)) {
      writeFileSync(join(dir, `${gate}.bin`), `synthetic-${gate}`, { mode: 0o600 });
    }
    const approvals = roles.map((role, index) => {
      const bytes = Buffer.from(`synthetic-${role}`);
      writeFileSync(join(dir, `${role}.bin`), bytes, { mode: 0o600 });
      return { reviewerRole: role, reviewerReference: `test-reviewer-${index}`, approvedAtUtc: iso(-6000), evidenceSha256: hash(bytes) };
    });
    const packet = { schemaVersion: 1, customerReference: "synthetic-json-customer", sourceCommitSha: "b".repeat(40),
      deployedWorkerVersionId: "synthetic-worker-version", decisionAtUtc: iso(-5000), nextReviewAtUtc: iso(86400_000),
      approvedRetentionUntilUtc: requirements.minRetentionUntilUtc,
      evidence: REQUIRED_GATES.map(gate => ({ gate, status: "PASS", sha256: hash(readFileSync(join(dir, `${gate}.bin`))),
        controlledLocator: `synthetic-evidence-${gate}`, reviewerRole: "AUDIT_REVIEWER", reviewerReference: "test-operator-01",
        reviewedAtUtc: iso(-8000), evidenceType: gate === "G01" ? "DEPLOYED_REVISION_READBACK" :
          gate === "G03" ? "APPROVED_TSA_RFC3161" : gate === "G04" ? "INDEPENDENT_PROVIDER_LOCK_READBACK" : "CONTROLLED_EVIDENCE" })),
      customerSecurityApproval: approvals[0], recordsLegalApproval: approvals[1] };
    const packetSha256 = hash(encoded(packet));
    const policy = { schemaVersion: 3, scope: "HRBP_AUDIT_PILOT_TRUST:3", packetSha256,
      customerReference: packet.customerReference, sourceCommitSha: packet.sourceCommitSha,
      deployedWorkerVersionId: packet.deployedWorkerVersionId, validFromUtc: iso(-20_000), validUntilUtc: iso(86400_000),
      approvers: roles.map((role, index) => ({ role, reviewerReference: approvals[index].reviewerReference,
        publicKeyPem: keys[index].publicKey.export({ type: "spki", format: "pem" }).toString() })),
      retentionRequirements: requirements,
      collectionRequirements: { profile: S3_COLLECTION_PROFILE, manifestSha256: hash(readFileSync(join(dir, "collection-manifest.json"))),
        requestSha256: options.expectedRequestSha256 } };
    const policySha256 = hash(encoded(policy));
    const signatures = { schemaVersion: 1, scope: "HRBP_AUDIT_PILOT_SIGNATURES:1", packetSha256,
      trustPolicySha256: policySha256, signatures: roles.map((role, index) => {
        const reviewerReference = approvals[index].reviewerReference;
        const keyId = hash(keys[index].publicKey.export({ type: "spki", format: "der" }));
        // Construct signing bytes independently of the production helper.
        const payload = Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" +
          JSON.stringify([policySha256, packetSha256, role, reviewerReference, keyId]));
        return { role, reviewerReference, keyId, signature: sign(null, payload, keys[index].privateKey).toString("base64") };
      }) };
    const verifyOptions = { packetPath: join(root, "packet.json"), policyPath: join(root, "policy.json"),
      expectedPolicySha256: policySha256, signaturesPath: join(root, "signatures.json"), evidenceDir: dir,
      requiredCollectionProfile: S3_COLLECTION_PROFILE, now };
    for (const [path, value] of [[verifyOptions.packetPath, packet], [verifyOptions.policyPath, policy],
      [verifyOptions.signaturesPath, signatures]]) writeFileSync(path, encoded(value), { mode: 0o600 });
    return verifyOptions;
  }
  return { root, raw, log, options, writeFake, collect, enroll };
}

for (const [name, command, field, bad] of operations) {
  test(`pipeline collector refuses duplicate ${name} without publishing a bundle`, t => {
    const fx = pipeline(t);
    fx.raw[command] = duplicate(fx.raw[command], field, bad); fx.writeFake();
    assert.deepEqual(fx.collect(), { ok: false, code: "COLLECTION_JSON_INVALID", observations: 0 });
    assert.equal(existsSync(fx.options.outputDirectory), false);
    const calls = readFileSync(fx.log, "utf8").trim().split("\n");
    assert.deepEqual(calls, ["--version", ...operations.slice(0, operations.findIndex(op => op[0] === name) + 1).map(op => op[1])]);
  });
  test(`pipeline v3 rejects validly re-signed duplicate ${name} after every digest is refreshed`, t => {
    const fx = pipeline(t);
    assert.equal(fx.collect().ok, true);
    assert.equal(verifyPilotEvidence(fx.enroll()).verifiedArtifacts, 19);
    const path = join(fx.options.outputDirectory, `${name}.raw.json`);
    const bytes = Buffer.from(duplicate(readFileSync(path, "utf8"), field, bad));
    writeFileSync(path, bytes);
    const manifestPath = join(fx.options.outputDirectory, "collection-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const entry = manifest.files.find(file => file.name === `${name}.raw.json`);
    entry.sha256 = hash(bytes); entry.bytes = bytes.length;
    manifest.operations.find(op => op.operation === name).rawSha256 = hash(bytes);
    writeFileSync(manifestPath, encoded(manifest));
    // Re-enroll the changed manifest pin and generate two VALID new signatures.
    // The old parser accepted this self-consistent but ambiguous raw document.
    const result = verifyPilotEvidence(fx.enroll());
    assert.equal(result.decision, "NO_GO");
    assert.deepEqual(result.reasons, ["COLLECTION_JSON_INVALID"]);
  });
}

test("pipeline collector CLI sanitizes duplicate-field errors and exits nonzero", t => {
  const fx = pipeline(t);
  fx.raw["head-object"] = duplicate(fx.raw["head-object"], "ObjectLockMode", "private-raw-value"); fx.writeFake();
  const cli = fileURLToPath(new URL("./audit-pilot-s3-collector.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [cli, "--request", fx.options.requestPath,
    "--expected-request-sha256", fx.options.expectedRequestSha256, "--archive", fx.options.archivePath,
    "--aws-cli", fx.options.awsCliPath, "--out-dir", fx.options.outputDirectory, "--allow-read-only-aws"],
  { env: credentials, encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stderr, "");
  assert.deepEqual(JSON.parse(child.stdout), { ok: false, code: "COLLECTION_JSON_INVALID", observations: 0 });
  assert.equal(existsSync(fx.options.outputDirectory), false);
});

test("pipeline benign metadata remains losslessly retained through collection and v3 authentication", t => {
  const fx = pipeline(t);
  const head = JSON.parse(fx.raw["head-object"]);
  head.Metadata = { text: 'İ😀 \\"Status":true {} []', nested: [{ name: "one" }, { name: "two" }] };
  fx.raw["head-object"] = JSON.stringify(head, null, 2) + "\n"; fx.writeFake();
  assert.equal(fx.collect().ok, true);
  assert.equal(readFileSync(join(fx.options.outputDirectory, "headObject.raw.json"), "utf8"), fx.raw["head-object"]);
  const result = verifyPilotEvidence(fx.enroll());
  assert.equal(result.verifiedArtifacts, 19);
  assert.equal(result.collection.providerAttestationVerified, false);
  assert.equal(result.retention.liveProviderVerified, false);
});

test("decoder handles a maximum-size single string and does not fold distinct Unicode names", () => {
  const prefix = '{"text":"', suffix = '"}';
  const text = prefix + "x".repeat(65536 - prefix.length - suffix.length) + suffix;
  assert.equal(parse(text).text.length, 65536 - prefix.length - suffix.length);
  assert.deepEqual(parse('{"é":1,"e\\u0301":2,"Status":3,"status":4}'),
    { "é": 1, "e\u0301": 2, Status: 3, status: 4 });
});

test("decoder treats escaped property syntax inside a value as data, not duplicate members", () => {
  const value = { Status: "Enabled", data: '\\"Status\\":\\"Suspended\\", "Status":"Enabled"' };
  assert.deepEqual(parse(JSON.stringify(value)), value);
});
