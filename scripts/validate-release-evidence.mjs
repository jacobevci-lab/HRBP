import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDir = path.resolve(root, process.argv[2] || ".release-evidence");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function walkSql(directory, relativeBase = root) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkSql(target, relativeBase));
    else if (entry.isFile() && entry.name.endsWith(".sql")) {
      files.push(path.relative(relativeBase, target).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function parseJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

const required = ["hrbp-one-source.tar", "hrbp-one.cdx.json", "release-manifest.json", "SHA256SUMS"];
for (const file of required) {
  if (!existsSync(path.join(outputDir, file))) fail(`Release evidence is missing ${file}.`);
}

const manifestPath = path.join(outputDir, "release-manifest.json");
const sbomPath = path.join(outputDir, "hrbp-one.cdx.json");
const manifest = parseJson(manifestPath, "Release manifest");
const sbom = parseJson(sbomPath, "SBOM");

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim().toLowerCase();
if (manifest?.schemaVersion !== 1 || manifest?.product !== "HRBP One") fail("Release manifest identity is invalid.");
if (manifest?.revision !== head || !/^[a-f0-9]{40}$/.test(manifest?.revision || "")) {
  fail("Release manifest revision does not match the checked-out commit.");
}

if (sbom?.bomFormat !== "CycloneDX" || !Array.isArray(sbom?.components) || sbom.components.length === 0) {
  fail("SBOM is not a populated CycloneDX document.");
}
const packageJson = parseJson(path.join(root, "package.json"), "package.json");
const serializedSbomIdentity = JSON.stringify(sbom.metadata ?? {});
if (!serializedSbomIdentity.includes(packageJson.name)) {
  fail("SBOM metadata does not identify the HRBP package.");
}

const directDependencyCount = Object.keys(packageJson.dependencies || {}).length;
if (sbom.components.length < directDependencyCount) {
  fail("SBOM component inventory is unexpectedly smaller than the direct production dependency set.");
}
if (!Array.isArray(sbom.dependencies) || sbom.dependencies.length === 0) {
  fail("SBOM dependency graph is empty.");
}

if (manifest?.sourceArchive?.sha256 !== sha256File(path.join(outputDir, "hrbp-one-source.tar"))) {
  fail("Source archive digest does not match the release manifest.");
}
if (manifest?.sbom?.sha256 !== sha256File(sbomPath)) fail("SBOM digest does not match the release manifest.");

if (!Array.isArray(manifest?.releaseInputs) || !manifest.releaseInputs.length) fail("Release input digest set is empty.");
for (const entry of manifest.releaseInputs) {
  if (!entry?.path || !/^[a-f0-9]{64}$/.test(entry?.sha256 || "")) fail("Release input digest entry is invalid.");
  const filePath = path.join(root, entry.path);
  if (!existsSync(filePath) || sha256File(filePath) !== entry.sha256) {
    fail(`Release input digest mismatch: ${entry.path}`);
  }
}

const actualMigrationPaths = walkSql(path.join(root, "prisma", "migrations"));
const manifestMigrationPaths = Array.isArray(manifest?.migrations)
  ? manifest.migrations.map((entry) => entry?.path).filter(Boolean).sort()
  : [];
if (JSON.stringify(actualMigrationPaths) !== JSON.stringify(manifestMigrationPaths)) {
  fail("Release manifest migration inventory does not match the repository.");
}
for (const entry of manifest.migrations) {
  const filePath = path.join(root, entry.path);
  if (!existsSync(filePath) || sha256File(filePath) !== entry.sha256) {
    fail(`Migration digest mismatch: ${entry.path}`);
  }
}

const checksums = readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/))
  .map((match) => {
    if (!match) fail("SHA256SUMS contains an invalid entry.");
    return { sha256: match[1], file: match[2] };
  });
const expectedChecksumFiles = ["hrbp-one-source.tar", "hrbp-one.cdx.json", "release-manifest.json"];
if (JSON.stringify(checksums.map((entry) => entry.file).sort()) !== JSON.stringify(expectedChecksumFiles.sort())) {
  fail("SHA256SUMS does not contain the exact release evidence set.");
}
for (const entry of checksums) {
  if (sha256File(path.join(outputDir, entry.file)) !== entry.sha256) fail(`Checksum mismatch: ${entry.file}`);
}

const evidenceText = [
  readFileSync(sbomPath, "utf8"),
  readFileSync(manifestPath, "utf8"),
  readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8")
].join("\n");
const sensitiveKeys = [
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "OBJECT_STORAGE_SECRET_KEY",
  "HRBP_SESSION_SECRET",
  "HRBP_ENGAGEMENT_RESPONSE_SECRET",
  "HRBP_DOCUMENT_SCAN_TOKEN",
  "HRBP_MAINTENANCE_TOKEN",
  "HRBP_METRICS_TOKEN",
  "HRBP_OIDC_CLIENT_SECRET",
  "HRBP_AI_PROCESSOR_TOKEN",
  "HRBP_SMTP_PASSWORD"
];
for (const key of sensitiveKeys) {
  const value = process.env[key];
  if (value && value.length >= 8 && evidenceText.includes(value)) fail(`Release evidence leaked ${key}.`);
}

console.log(JSON.stringify({
  ok: true,
  revision: manifest.revision,
  sbomComponents: sbom.components.length,
  releaseInputs: manifest.releaseInputs.length,
  migrations: manifest.migrations.length
}));
