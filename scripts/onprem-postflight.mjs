import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnvText } from "./onprem-preflight-lib.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let envFile = ".env.onprem";
let timeoutSeconds = 300;
let mode = "post-deploy";
let expectedRevision = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--env-file") envFile = args[++index];
  else if (args[index] === "--timeout-seconds") timeoutSeconds = Number(args[++index]);
  else if (args[index] === "--mode") mode = args[++index];
  else if (args[index] === "--expected-revision") expectedRevision = args[++index];
  else fail(`Unsupported argument: ${args[index]}`);
}
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 1800) {
  fail("--timeout-seconds must be between 30 and 1800.");
}
if (!["pre-upgrade", "post-deploy"].includes(mode)) fail("--mode must be pre-upgrade or post-deploy.");
if (expectedRevision !== null && !/^[a-f0-9]{40}$/i.test(expectedRevision)) {
  fail("--expected-revision must be a full 40-character commit SHA.");
}
if (expectedRevision) expectedRevision = expectedRevision.toLowerCase();

const env = parseEnvText(readFileSync(envFile, "utf8"));
const port = env.HRBP_HTTP_PORT || "3000";
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail("HRBP_HTTP_PORT is invalid.");
const bind = env.HRBP_HTTP_BIND || "127.0.0.1";
const localHost = bind === "::1" ? "[::1]" : "127.0.0.1";
const origin = `http://${localHost}:${port}`;
const deadline = Date.now() + timeoutSeconds * 1000;

async function boundedJson(pathname) {
  const response = await fetch(`${origin}${pathname}`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" }
  });
  const length = Number(response.headers.get("content-length") || "0");
  if (length > 64 * 1024) throw new Error("oversized health response");
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("oversized health response");
  let body;
  try { body = JSON.parse(text); } catch { throw new Error("invalid JSON health response"); }
  return { response, body };
}

async function waitFor(pathname, predicate, label) {
  let last = "unavailable";
  while (Date.now() < deadline) {
    try {
      const { response, body } = await boundedJson(pathname);
      if (response.ok && predicate(body)) return body;
      last = `HTTP ${response.status}`;
    } catch {
      last = "unavailable";
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  fail(`${label} did not become healthy within ${timeoutSeconds}s (${last}).`);
}

const runtime = await waitFor(
  "/api/health/runtime",
  (body) => body?.ok === true && body?.service === "hrbp" &&
    (!expectedRevision || body?.release?.revision === expectedRevision),
  expectedRevision ? "Runtime/release identity" : "Runtime health"
);
const database = await waitFor(
  "/api/health/db",
  (body) => body?.status === "ok" && body?.database === "postgresql",
  "Database health"
);
const auth = await waitFor(
  "/api/health/auth",
  (body) => body?.status === "ok" && body?.configured === true,
  "Authentication health"
);
const notifications = await waitFor(
  "/api/health/notifications",
  (body) => body?.status === "ok" && typeof body?.email?.enabled === "boolean" &&
    typeof body?.email?.configured === "boolean" && Number.isInteger(body?.email?.eventCount),
  "Notification provider health"
);

function compose(args, { discardStdout = false } = {}) {
  return spawnSync("docker", ["compose", "--env-file", envFile, "-f", "docker-compose.onprem.yml", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HRBP_ENV_FILE: envFile },
    maxBuffer: 8 * 1024 * 1024,
    ...(discardStdout ? { stdio: ["ignore", "ignore", "pipe"] } : {})
  });
}

const bucket = env.OBJECT_STORAGE_BUCKET || "hrbp-private";
if (!/^[A-Za-z0-9._-]{3,63}$/.test(bucket)) fail("OBJECT_STORAGE_BUCKET is invalid for postflight.");
const objectStorage = compose([
  "run", "--rm", "--no-deps", "-T", "object-storage-tool",
  "lsd", `hrbp:${bucket}`, "--max-depth", "1"
], { discardStdout: true });
if (objectStorage.error || objectStorage.status !== 0) {
  fail("Private object storage/bucket access is not healthy.");
}

let migrationStatus = "not-checked-pre-upgrade";
if (mode === "post-deploy") {
  const migration = compose(["run", "--rm", "--no-deps", "-T", "schema", "npm", "run", "db:migrate:status"]);
  if (migration.error || migration.status !== 0) fail("Prisma migration status is not clean after deployment.");
  migrationStatus = "clean";
}

const runningServices = compose(["ps", "--status", "running", "--services"]);
const running = new Set(
  !runningServices.error && runningServices.status === 0
    ? runningServices.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    : []
);
let schedulerStatus = "healthy";
if (mode === "pre-upgrade" && !running.has("maintenance-scheduler")) {
  schedulerStatus = "not-running-pre-upgrade";
} else {
  let schedulerHealthy = false;
  while (Date.now() < deadline) {
    const scheduler = compose(["exec", "-T", "maintenance-scheduler", "node", "scripts/onprem-maintenance-health.mjs"]);
    if (!scheduler.error && scheduler.status === 0) {
      schedulerHealthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!schedulerHealthy) fail("Maintenance scheduler did not become healthy after deployment.");
}

console.log(JSON.stringify({
  ok: true,
  verifiedAt: new Date().toISOString(),
  runtime: {
    revision: runtime?.release?.revision ?? null,
    protocolVersion: runtime?.release?.protocolVersion ?? null
  },
  database: {
    transport: database?.transport ?? null,
    orm: database?.orm ?? null
  },
  authentication: {
    mode: auth?.authentication ?? null
  },
  notifications: {
    smtpEnabled: notifications?.email?.enabled ?? false,
    smtpConfigured: notifications?.email?.configured ?? false,
    emailEventCount: notifications?.email?.eventCount ?? 0
  },
  objectStorage: "healthy",
  mode,
  migrations: migrationStatus,
  scheduler: schedulerStatus
}));
