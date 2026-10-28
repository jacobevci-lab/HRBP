import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const workflow = readFileSync(new URL("../.github/workflows/audit-pilot-gate.yml", import.meta.url), "utf8");

test("the pilot validation command executes all six test suites without optional failure", () => {
  assert.equal(pkg.scripts["audit-pilot:validate"],
    "node --test scripts/audit-pilot-gate-evaluator.test.mjs scripts/audit-pilot-gate-ci.test.mjs scripts/audit-pilot-s3-retention.test.mjs scripts/audit-pilot-s3-collector.test.mjs scripts/audit-pilot-s3-readback.test.mjs scripts/audit-pilot-current-trust.test.mjs");
});

test("production prebuild retains the mandatory pilot validation chain", () => {
  assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run audit-integrity:validate"));
  assert.ok(pkg.scripts["audit-integrity:validate"].split(" && ").includes("npm run audit-pilot:validate"));
  assert.doesNotMatch(pkg.scripts.prebuild + pkg.scripts["audit-integrity:validate"], /\|\||;/);
});

test("the dedicated workflow covers stacked draft PRs without conditional skips", () => {
  assert.match(workflow, /^  pull_request: \{\}$/m);
  assert.match(workflow, /^  push:\n    branches: \[main\]$/m);
  assert.doesNotMatch(workflow, /^\s*(if|continue-on-error|paths|paths-ignore|pull_request_target):/m);
  assert.match(workflow, /^        run: npm run audit-pilot:validate$/m);
  assert.match(workflow, /^    timeout-minutes: 5$/m);
});

test("the offline job needs no installation, deployment credentials or writable token", () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /^          persist-credentials: false$/m);
  assert.match(workflow, /^          node-version-file: \.node-version$/m);
  assert.doesNotMatch(workflow, /secrets\.|: write\b|npm (ci|install)\b|wrangler|cf:deploy|workflow_run:/);
});
