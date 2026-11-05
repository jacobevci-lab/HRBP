import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const openNext = process.platform === "win32" ? "opennextjs-cloudflare.cmd" : "opennextjs-cloudflare";

const env = {
  ...process.env,
  // Prisma CLI validates env("DATABASE_URL") during generation/type-check.
  // Cloudflare Workers Builds does not need a live database connection to
  // compile this app, so use a loopback-only placeholder when no build-time
  // DATABASE_URL is configured. Runtime database access remains Hyperdrive.
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://build:build@127.0.0.1:5432/hrbp_build",
  // OpenNext invokes `npm run build` internally. npm would normally execute the
  // repository's full `prebuild` integration suite again. That suite is already
  // mandatory in GitHub CI and requires disposable PostgreSQL. Suppress only the
  // npm lifecycle hooks inside Cloudflare packaging; the named build script still runs.
  npm_config_ignore_scripts: "true"
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npm, ["run", "typecheck"]);
run(openNext, ["build"]);
