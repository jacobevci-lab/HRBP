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
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--env-file") envFile = args[++index];
  else if (args[index] === "--timeout-seconds") timeoutSeconds = Number(args[++index]);
  else if (args[index] === "--mode") mode = args[++index];
  else fail(`Unsupported argument: ${args[index]}`);
}
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 1800) {
  fail("--timeout-seconds must be between 30 and 1800.");
}
if (!["pre-upgrade", "post-deploy"].includes(mode)) fail("--mode must be pre-upgrade or post-deploy.");

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
  (body) => body?.ok === true && body?.service === "hrbp",
  "Runtime health"
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

function compose(args) {
  return spawnSync("docker", ["compose", "--env-file", envFile, "-f", "docker-compose.onprem.yml", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
}

let migrationStatus = "not-checked-pre-upgrade";
if (mode === "post-deploy") {
  const migration = compose(["run", "--rm", "--no-deps", "-T", "schema", "npm", "run", "db:migrate:status"]);
  if (migration.error || migration.status !== 0) fail("Prisma migration status is not clean after deployment.");
  migrationStatus = "clean";
}

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

console.log(JSON.stringify({
  ok: true,
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
  mode,
  migrations: migrationStatus,
  scheduler: "healthy"
}));
