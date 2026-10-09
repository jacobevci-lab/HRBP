import { readFile } from "node:fs/promises";

const [ci, regression, dockerfile, upgrade] = await Promise.all([
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile(".github/workflows/platform-regression.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8"),
  readFile("scripts/onprem-upgrade.sh", "utf8")
]);

const failures = [];
function expect(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

expect(ci, /image:\s+public\.ecr\.aws\/docker\/library\/postgres:16/, "CI PostgreSQL service must use the public ECR Docker Official Images mirror.");
expect(regression, /image:\s+public\.ecr\.aws\/docker\/library\/postgres:16/, "Platform Regression PostgreSQL service must use the public ECR Docker Official Images mirror.");
expect(dockerfile, /ARG NODE_BASE_IMAGE=node:22-bookworm-slim/, "On-prem Dockerfile must preserve the reviewed Docker Hub Node image as the customer-facing default.");
expect(dockerfile, /FROM \$\{NODE_BASE_IMAGE\} AS base/, "On-prem Dockerfile must allow CI to override the Node registry source.");
expect(ci, /NODE_BASE_IMAGE=public\.ecr\.aws\/docker\/library\/node:22-bookworm-slim/g, "CI on-prem image builds must use the public ECR Node mirror.");
const mirrorBuilds = ci.match(/NODE_BASE_IMAGE=public\.ecr\.aws\/docker\/library\/node:22-bookworm-slim/g) ?? [];
if (mirrorBuilds.length !== 3) failures.push("CI must mirror runtime, scheduler and scanner Node builds exactly three times.");
if (/pull document-scanner-engine/.test(ci)) failures.push("Pull-request CI must not depend on Docker Hub availability for the third-party ClamAV image.");
expect(upgrade, /pull document-scanner-engine/, "The operator-controlled upgrade path must still pull and verify the pinned scanner engine.");
expect(regression, /retry\(\)[\s\S]*for attempt in 1 2 3/, "Platform Regression network installs must use bounded retry.");
expect(regression, /retry "npm ci"[\s\S]*retry "Playwright package install"[\s\S]*retry "Chromium install"/, "Platform Regression must retry npm and browser-tooling downloads without hiding final logs.");

if (failures.length) {
  console.error("CI registry resilience validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("CI registry resilience validation passed.");
