import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import path from "node:path";
import { parseEnvText, validateOnpremEnv, validateSecretFileMode } from "./onprem-preflight-lib.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function command(command, args, { env = process.env, allowMissing = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) {
    if (allowMissing && result.error.code === "ENOENT") return null;
    throw result.error;
  }
  return result;
}

const args = process.argv.slice(2);
let envFile = ".env.onprem";
let phase = "install";
let requireCleanSource = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--env-file") envFile = args[++index];
  else if (arg === "--phase") phase = args[++index];
  else if (arg === "--require-clean-source") requireCleanSource = true;
  else fail(`Unsupported argument: ${arg}`);
}
if (!envFile) fail("--env-file requires a path.");
if (!["install", "upgrade"].includes(phase)) fail("--phase must be install or upgrade.");

const requiredFiles = [
  "Dockerfile.onprem",
  "docker-compose.onprem.yml",
  "package.json",
  "package-lock.json",
  "prisma/migrations/migration_lock.toml",
  "scripts/deploy-prisma-migrations.mjs",
  "scripts/onprem-backup.sh",
  "scripts/onprem-restore.sh"
];
for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`Release package is missing required file: ${file}`);
}
if (!existsSync(envFile)) fail(`Environment file does not exist: ${envFile}`);

const parsed = parseEnvText(readFileSync(envFile, "utf8"));
const result = validateOnpremEnv(parsed);
const mode = validateSecretFileMode(envFile);
if (!mode.ok) result.errors.push(mode.error);
if (mode.warning) result.warnings.push(mode.warning);

const docker = command("docker", ["version", "--format", "{{.Server.Version}}"], { allowMissing: true });
if (!docker) result.errors.push("Docker CLI is not installed or not on PATH.");
else if (docker.status !== 0) result.errors.push("Docker daemon is not available to the current operator.");

const compose = command("docker", ["compose", "version"], { allowMissing: true });
if (!compose || compose.status !== 0) result.errors.push("Docker Compose plugin is required.");

if (result.errors.length === 0) {
  const composeEnv = { ...process.env, HRBP_ENV_FILE: envFile };
  const config = command("docker", ["compose", "--env-file", envFile, "-f", "docker-compose.onprem.yml", "config", "--quiet"], { env: composeEnv });
  if (!config || config.status !== 0) result.errors.push("Docker Compose configuration validation failed.");
}

let revision = process.env.GITHUB_SHA && /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA)
  ? process.env.GITHUB_SHA.toLowerCase()
  : null;
const gitHead = command("git", ["rev-parse", "HEAD"], { allowMissing: true });
if (gitHead?.status === 0 && /^[a-f0-9]{40}$/i.test(gitHead.stdout.trim())) revision = gitHead.stdout.trim().toLowerCase();

if (requireCleanSource || phase === "upgrade") {
  const gitStatus = command("git", ["status", "--porcelain", "--untracked-files=no"], { allowMissing: true });
  if (gitStatus?.status === 0 && gitStatus.stdout.trim()) {
    result.errors.push("Tracked release files are modified. Upgrade requires an approved clean source tree.");
  } else if (!gitStatus && requireCleanSource) {
    result.errors.push("Git is required when --require-clean-source is used.");
  }
}

try {
  const fs = statfsSync(path.resolve("."));
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  if (Number.isFinite(freeBytes)) {
    const freeGiB = freeBytes / (1024 ** 3);
    if (freeGiB < 1) result.errors.push("Less than 1 GiB of free filesystem space is available for the release workspace.");
    else if (freeGiB < 5) result.warnings.push(`Only ${freeGiB.toFixed(1)} GiB of free filesystem space is available; verify image/backup capacity before upgrade.`);
  }
} catch {
  result.warnings.push("Filesystem free-space validation was unavailable.");
}

if (!revision) result.warnings.push("A 40-character release revision could not be resolved from GITHUB_SHA or Git.");

for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
if (result.errors.length) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  phase,
  revision,
  composeValidated: true,
  secretFilePermissionsValidated: mode.ok,
  warnings: result.warnings.length
}));
