import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseEnvText } from "./onprem-preflight-lib.mjs";
import {
  SUPPORT_BUNDLE_VERSION,
  boundedJsonParse,
  diagnosticsContainSecretMaterial,
  sanitizeAuthHealth,
  sanitizeComposeService,
  sanitizeDatabaseHealth,
  sanitizeImage,
  sanitizeRuntimeHealth,
  sanitizeSchedulerStatus
} from "./onprem-support-bundle-lib.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let envFile = ".env.onprem";
let outputDir = "support-bundles";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--env-file") envFile = args[++index];
  else if (args[index] === "--output-dir") outputDir = args[++index];
  else fail(`Unsupported argument: ${args[index]}`);
}
if (!envFile || !outputDir) fail("Support bundle paths must not be empty.");

const env = parseEnvText(readFileSync(envFile, "utf8"));
const composeEnv = { ...process.env, HRBP_ENV_FILE: envFile };
const port = env.HRBP_HTTP_PORT || "3000";
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail("HRBP_HTTP_PORT is invalid.");
const bind = env.HRBP_HTTP_BIND || "127.0.0.1";
const localHost = bind === "::1" ? "[::1]" : "127.0.0.1";
const origin = `http://${localHost}:${port}`;

function command(commandName, commandArgs, { discardStdout = false, timeout = 20_000 } = {}) {
  return spawnSync(commandName, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: composeEnv,
    timeout,
    maxBuffer: 1024 * 1024,
    ...(discardStdout ? { stdio: ["ignore", "ignore", "pipe"] } : {})
  });
}

function compose(commandArgs, options = {}) {
  return command("docker", ["compose", "--env-file", envFile, "-f", "docker-compose.onprem.yml", ...commandArgs], options);
}

function jsonRecords(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];
  try {
    const value = boundedJsonParse(trimmed);
    return Array.isArray(value) ? value : [value];
  } catch {
    const rows = [];
    for (const line of trimmed.split(/\r?\n/).filter(Boolean)) {
      try { rows.push(boundedJsonParse(line)); } catch { return []; }
    }
    return rows;
  }
}

async function safeHealth(pathname, sanitizer) {
  try {
    const response = await fetch(`${origin}${pathname}`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    const body = boundedJsonParse(text, 64 * 1024);
    return { reachable: true, httpStatus: response.status, ...sanitizer(body) };
  } catch {
    return { reachable: false, httpStatus: null };
  }
}

const createdAt = new Date();
const stamp = createdAt.toISOString().replaceAll(/[-:.]/g, "").replace("Z", "Z");
mkdirSync(outputDir, { recursive: true, mode: 0o700 });
chmodSync(outputDir, 0o700);
const target = path.resolve(outputDir, `hrbp-support-${stamp}.json`);
const checksumTarget = `${target}.sha256`;

const composePs = compose(["ps", "--all", "--format", "json"]);
const services = composePs.error || composePs.status !== 0
  ? []
  : jsonRecords(composePs.stdout).map(sanitizeComposeService).filter(Boolean);

const composeImages = compose(["images", "--format", "json"]);
const images = composeImages.error || composeImages.status !== 0
  ? []
  : jsonRecords(composeImages.stdout).map(sanitizeImage).filter(Boolean);

const runtime = await safeHealth("/api/health/runtime", sanitizeRuntimeHealth);
const database = await safeHealth("/api/health/db", sanitizeDatabaseHealth);
const authentication = await safeHealth("/api/health/auth", sanitizeAuthHealth);

let schedulerBody = null;
for (const mode of ["exec", "run"]) {
  const commandArgs = mode === "exec"
    ? ["exec", "-T", "maintenance-scheduler", "node", "scripts/onprem-maintenance-control.mjs", "status"]
    : ["run", "--rm", "--no-deps", "-T", "maintenance-scheduler", "node", "scripts/onprem-maintenance-control.mjs", "status"];
  const result = compose(commandArgs);
  if (!result.error && result.status === 0) {
    try {
      schedulerBody = boundedJsonParse(result.stdout, 64 * 1024);
      break;
    } catch {
      schedulerBody = null;
    }
  }
}
const scheduler = schedulerBody ? { reachable: true, ...sanitizeSchedulerStatus(schedulerBody) } : { reachable: false };

const migration = compose(["run", "--rm", "--no-deps", "-T", "schema", "npm", "run", "db:migrate:status"], { discardStdout: true, timeout: 60_000 });
const migrationStatus = {
  checked: !migration.error,
  clean: !migration.error && migration.status === 0,
  exitCode: Number.isInteger(migration.status) ? migration.status : null
};

const bucket = env.OBJECT_STORAGE_BUCKET || "hrbp-private";
const objectProbe = /^[A-Za-z0-9._-]{3,63}$/.test(bucket)
  ? compose(["run", "--rm", "--no-deps", "-T", "object-storage-tool", "lsd", `hrbp:${bucket}`, "--max-depth", "1"], { discardStdout: true, timeout: 30_000 })
  : null;
const objectStorage = {
  checked: objectProbe !== null && !objectProbe.error,
  accessible: objectProbe !== null && !objectProbe.error && objectProbe.status === 0
};

const gitHead = command("git", ["rev-parse", "HEAD"]);
const gitStatus = command("git", ["status", "--porcelain", "--untracked-files=no"]);
const source = {
  revision: !gitHead.error && gitHead.status === 0 && /^[a-f0-9]{40}$/i.test(gitHead.stdout.trim())
    ? gitHead.stdout.trim().toLowerCase()
    : null,
  trackedTreeClean: !gitStatus.error && gitStatus.status === 0 ? gitStatus.stdout.trim() === "" : null
};

const dockerVersion = command("docker", ["version", "--format", "{{.Server.Version}}"]);
const docker = {
  serverVersion: !dockerVersion.error && dockerVersion.status === 0 && /^[A-Za-z0-9._+-]{1,64}$/.test(dockerVersion.stdout.trim())
    ? dockerVersion.stdout.trim()
    : null
};

let filesystem = { freeGiB: null };
try {
  const fs = statfsSync(path.resolve("."));
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  if (Number.isFinite(freeBytes)) filesystem = { freeGiB: Math.round((freeBytes / (1024 ** 3)) * 10) / 10 };
} catch {
  // Optional host diagnostic only.
}

const report = {
  formatVersion: SUPPORT_BUNDLE_VERSION,
  redaction: "bounded-allowlist-v1",
  createdAtUtc: createdAt.toISOString(),
  source,
  docker,
  configuration: {
    localAuthEnabled: (env.HRBP_LOCAL_AUTH_ENABLED || "false").toLowerCase() === "true",
    httpBindLoopback: ["127.0.0.1", "::1"].includes(bind),
    httpPort: Number(port),
    maintenanceIntervalSeconds: /^[0-9]+$/.test(env.HRBP_MAINTENANCE_INTERVAL_SECONDS || "")
      ? Number(env.HRBP_MAINTENANCE_INTERVAL_SECONDS)
      : null,
    objectStorageProfile: env.OBJECT_STORAGE_ENDPOINT ? "external" : "bundled"
  },
  services,
  images,
  health: { runtime, database, authentication, objectStorage, migrations: migrationStatus, scheduler },
  filesystem
};

if (diagnosticsContainSecretMaterial(report)) {
  fail("Support bundle redaction guard rejected the generated diagnostics.");
}

const serialized = JSON.stringify(report, null, 2) + "\n";
writeFileSync(target, serialized, { encoding: "utf8", mode: 0o600 });
chmodSync(target, 0o600);
const digest = createHash("sha256").update(serialized).digest("hex");
writeFileSync(checksumTarget, `${digest}  ${path.basename(target)}\n`, { encoding: "utf8", mode: 0o600 });
chmodSync(checksumTarget, 0o600);

console.log(JSON.stringify({
  ok: true,
  bundle: target,
  checksum: checksumTarget,
  formatVersion: SUPPORT_BUNDLE_VERSION,
  redaction: "bounded-allowlist-v1"
}));
