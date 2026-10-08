import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDir = path.resolve(root, process.argv[2] || ".release-evidence");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...options
    }).trim();
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(-4000) : "";
    fail(`${command} failed${stderr ? `: ${stderr}` : ""}`);
  }
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

const revision = run("git", ["rev-parse", "HEAD"]).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(revision)) fail("Git HEAD is not a full commit SHA.");

const declaredRevision = (process.env.GITHUB_SHA || "").trim().toLowerCase();
if (declaredRevision && declaredRevision !== revision) {
  fail("GITHUB_SHA does not match the checked-out commit.");
}

const trackedChanges = run("git", ["status", "--porcelain", "--untracked-files=no"]);
if (trackedChanges) fail("Tracked files changed before release evidence generation.");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const sbomResult = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["sbom", "--omit=dev", "--sbom-format=cyclonedx"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
if (sbomResult.error || sbomResult.status !== 0) {
  const diagnostic = String(sbomResult.stderr || "").slice(-4000);
  fail(`npm sbom failed${diagnostic ? `: ${diagnostic}` : ""}`);
}

let sbom;
try {
  sbom = JSON.parse(sbomResult.stdout);
} catch {
  fail("npm sbom did not produce valid JSON.");
}
if (sbom?.bomFormat !== "CycloneDX" || !Array.isArray(sbom?.components)) {
  fail("npm sbom did not produce the expected CycloneDX structure.");
}

const sbomPath = path.join(outputDir, "hrbp-one.cdx.json");
writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });

const archivePath = path.join(outputDir, "hrbp-one-source.tar");
const archiveResult = spawnSync("git", ["archive", "--format=tar", "--prefix=hrbp-one/", revision], {
  cwd: root,
  encoding: null,
  maxBuffer: 128 * 1024 * 1024
});
if (archiveResult.error || archiveResult.status !== 0 || !archiveResult.stdout?.length) {
  fail("git archive failed to produce the reviewed source bundle.");
}
writeFileSync(archivePath, archiveResult.stdout, { mode: 0o600 });

const fixedInputs = [
  "package.json",
  "package-lock.json",
  "Dockerfile.onprem",
  "docker-compose.onprem.yml",
  ".env.onprem.example"
];
const migrationLock = "prisma/migrations/migration_lock.toml";
if (existsSync(path.join(root, migrationLock))) fixedInputs.push(migrationLock);

for (const relative of fixedInputs) {
  if (!existsSync(path.join(root, relative))) fail(`Required release input is missing: ${relative}`);
}

const migrationPaths = walkSql(path.join(root, "prisma", "migrations"));
if (!migrationPaths.length) fail("No committed Prisma migration SQL was found.");

const releaseInputs = fixedInputs.map((relative) => ({
  path: relative,
  sha256: sha256File(path.join(root, relative))
}));
const migrations = migrationPaths.map((relative) => ({
  path: relative,
  sha256: sha256File(path.join(root, relative))
}));

const npmVersion = run(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
const manifest = {
  schemaVersion: 1,
  product: "HRBP One",
  revision,
  toolchain: {
    node: process.version,
    npm: npmVersion
  },
  sourceArchive: {
    file: path.basename(archivePath),
    sha256: sha256File(archivePath),
    bytes: statSync(archivePath).size
  },
  sbom: {
    file: path.basename(sbomPath),
    format: "CycloneDX",
    sha256: sha256File(sbomPath),
    bytes: statSync(sbomPath).size
  },
  releaseInputs,
  migrations
};

const manifestPath = path.join(outputDir, "release-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

const checksumEntries = [archivePath, sbomPath, manifestPath]
  .map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`)
  .join("\n");
writeFileSync(path.join(outputDir, "SHA256SUMS"), `${checksumEntries}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  ok: true,
  revision,
  output: path.relative(root, outputDir).split(path.sep).join("/"),
  sbomComponents: sbom.components.length,
  migrations: migrations.length
}));
