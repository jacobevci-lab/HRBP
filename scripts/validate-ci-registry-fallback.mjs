import { readFile } from "node:fs/promises";

const [ci, dockerfile] = await Promise.all([
  readFile(".github/workflows/ci.yml", "utf8"),
  readFile("Dockerfile.onprem", "utf8")
]);

const failures = [];
function expect(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}
function reject(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

expect(dockerfile, /ARG NODE_BASE_IMAGE=node:22-bookworm-slim/, "customer-facing Dockerfile must preserve the reviewed Node default");
expect(dockerfile, /FROM \$\{NODE_BASE_IMAGE\} AS base/, "Dockerfile must allow CI to override the registry source");

expect(ci, /NODE_BASE_IMAGE=""/, "CI must resolve the Node base image dynamically from approved mirrors");
expect(ci, /mirror\.gcr\.io\/library\/node:22-bookworm-slim/, "CI must include the Google Docker Hub mirror");
expect(ci, /public\.ecr\.aws\/docker\/library\/node:22-bookworm-slim/, "CI must include the AWS Public ECR Docker Official Images mirror");
expect(ci, /"node:22-bookworm-slim"/, "CI must retain Docker Hub only as a final fallback");
expect(ci, /for candidate in[\s\S]*retry 2 5 docker pull "\$candidate"[\s\S]*NODE_BASE_IMAGE="\$candidate"[\s\S]*break/, "CI must use bounded per-mirror retries and stop after the first successful pull");
expect(ci, /if \[ -z "\$NODE_BASE_IMAGE" \][\s\S]*No approved Node base-image mirror was reachable/, "CI must fail explicitly when all approved mirrors are unavailable");

const buildArgMatches = ci.match(/--build-arg NODE_BASE_IMAGE="\$NODE_BASE_IMAGE"/g) ?? [];
if (buildArgMatches.length !== 3) failures.push("runtime, scheduler and scanner builds must all use the selected local Node base image");
expect(ci, /docker build --pull=false[\s\S]*--target runtime/, "runtime image build must not re-pull after the approved mirror is selected");
expect(ci, /docker build --pull=false[\s\S]*--target scheduler/, "scheduler image build must not re-pull after the approved mirror is selected");
expect(ci, /docker build --pull=false[\s\S]*--target scanner/, "scanner image build must not re-pull after the approved mirror is selected");

reject(ci, /retry 5 10 docker pull "public\.ecr\.aws\/docker\/library\/node:22-bookworm-slim"/, "CI must not spend all retries on one public registry before trying another mirror");
reject(ci, /docker pull clamav\/clamav/, "PR CI must not depend on Docker Hub for the pinned ClamAV image");

if (failures.length) {
  console.error("CI registry fallback validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("CI registry fallback validation passed.");
