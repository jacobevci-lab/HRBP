import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/platform.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /documentVersionId\s+String\?/, "signature envelopes must retain the immutable document version identity");
expect(schemaPath, schema, /documentVersion\s+DocumentVersion\?\s+@relation/, "signature envelope version identity must be relationally governed");
expect(schemaPath, schema, /signatureEnvelopes\s+SignatureEnvelope\[\]/, "document versions must expose the inverse signature evidence relationship");
expect(schemaPath, schema, /@@index\(\[tenantId,\s*documentVersionId\]\)/, "signature version references must be tenant-indexed");

const grantsPath = "app/api/documents/[id]/access-grants/route.ts";
const grants = await source(grantsPath);
expect(grantsPath, grants, /readJsonObject/, "grant mutations must safely parse JSON objects");
expect(grantsPath, grants, /asEnumValue\(body\.principalType/, "principal type must use an allow-list parser");
expect(grantsPath, grants, /asEnumValue\(body\.permission/, "document permissions must use an allow-list parser");
expect(grantsPath, grants, /asIdentifier\(body\.principalId\)/, "grant principal identity must be bounded and validated");
expect(grantsPath, grants, /asOptionalText\(body\.purpose,\s*500\)/, "delegation purpose must be bounded");
expect(grantsPath, grants, /asDate\(body\.expiresAt\)/, "grant expiry must use validated dates");
expect(grantsPath, grants, /employmentPrincipalsWithinScope\(tx,\s*ctx,\s*\[principalId\]\)/, "employment grants must remain inside actor relationship scope");
expect(grantsPath, grants, /take:\s*200/, "grant reads must remain bounded");

const signaturesPath = "app/api/documents/[id]/signatures/route.ts";
const signatures = await source(signaturesPath);
expect(signaturesPath, signatures, /maxParticipants\s*=\s*50/, "signature participant fan-out must be bounded");
expect(signaturesPath, signatures, /asText\(body\.title,\s*200\)/, "signature title must be bounded");
expect(signaturesPath, signatures, /normalizeEmail/, "external signer email inputs must be normalized and validated");
expect(signaturesPath, signatures, /signingOrder[\s\S]*Number\.isInteger[\s\S]*1000/, "signing order must be a bounded integer");
expect(signaturesPath, signatures, /Duplicate employment participants/, "duplicate employment signers must be rejected");
expect(signaturesPath, signatures, /Duplicate email participants/, "duplicate email signers must be rejected");
expect(signaturesPath, signatures, /employmentPrincipalsWithinScope\(tx,\s*ctx,\s*\[\.\.\.employmentIds\]\)/, "employment signers must remain inside actor relationship scope");
expect(signaturesPath, signatures, /scanStatus:\s*VaultScanStatus\.CLEAN/, "signature creation must require a CLEAN immutable document version");
expect(signaturesPath, signatures, /uploadedAt:\s*\{\s*not:\s*null\s*\}/, "signature creation must require an uploaded version");
expect(signaturesPath, signatures, /documentVersionId:\s*immutableVersion\.id/, "new signature envelopes must pin the exact immutable version");
expect(signaturesPath, signatures, /contentHash:\s*immutableVersion\.contentHash/, "signature evidence must retain the signed content hash");
expect(signaturesPath, signatures, /VERSION_NOT_READY/, "signature creation must fail closed when no clean version exists");
expect(signaturesPath, signatures, /take:\s*100/, "signature envelope reads must remain bounded");
expect(signaturesPath, signatures, /events:[\s\S]*take:\s*200/, "signature event reads must remain bounded");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /document-access-signature:validate/, "document access/signature validator must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*document-access-signature:validate/, "document access/signature governance validation must run before production builds");

if (failures.length) {
  console.error("Document access/signature governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Document access/signature governance validation passed.");
