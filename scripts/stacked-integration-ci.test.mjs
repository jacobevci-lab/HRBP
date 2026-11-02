import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Declarative regression checks, not a YAML parser or a runtime security sandbox.
const workflow = readFileSync(new URL("../.github/workflows/stacked-integration.yml", import.meta.url), "utf8");
const application = workflow.split("  application:\n")[1]?.split("\n  dependencies:\n")[0];
const dependencies = workflow.split("  dependencies:\n")[1]?.split("\n  platform:\n")[0];
const platform = workflow.split("\n  platform:\n")[1]?.split("\n  result:\n")[0];
const result = workflow.split("\n  result:\n")[1];
const checkout = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
const setup = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38";

test("stacked PRs require integration and the shared platform suite before main", () => {
  assert.match(workflow, /^on:\n  pull_request:\n    branches-ignore: \[main\]\n/m);
  assert.doesNotMatch(workflow, /^\s*(pull_request_target|push|workflow_run|paths|paths-ignore):/m);
  assert.deepEqual([...workflow.matchAll(/^  ([a-z]+):\n    name:/gm)].map(match => match[1]),
    ["application", "dependencies", "platform", "result"]);
  assert.match(workflow, /^  group: hrbp-stacked-integration-\$\{\{ github.ref \}\}$/m);
});

test("all jobs retain read-only credentials and no deployment or production secrets", () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /secrets\.|: write\b|pull_request_target|id-token|environment:|--no-verify|--no-verify-ssl/);
  assert.doesNotMatch(workflow, /cf:deploy|wrangler (?:publish|versions upload)|db:push|prisma db push|--ignore-scripts|--if-present|continue-on-error|\|\|\s*true/);
  const deployLines = workflow.split("\n").filter(line => /\bwrangler\b/.test(line));
  assert.deepEqual(deployLines, ["        run: npx --no-install wrangler deploy --dry-run"]);
  assert.match(application, /^      DATABASE_URL: postgresql:\/\/hrbp:hrbp@localhost:5432\/hrbp$/m);
  assert.doesNotMatch(dependencies, /DATABASE_URL|HRBP_MAINTENANCE_TOKEN/);
});

test("both work jobs test the merge candidate with pinned actions and repository Node", () => {
  for (const job of [application, dependencies]) {
    assert.ok(job.includes(`uses: ${checkout} # v6`));
    assert.ok(job.includes(`uses: ${setup} # v6`));
    assert.match(job, /^          persist-credentials: false$/m);
    assert.match(job, /^          node-version-file: \.node-version$/m);
    assert.doesNotMatch(job, /^\s+(ref|if|continue-on-error|permissions):/m);
    assert.match(job, /^        run: npm ci$/m);
    assert.match(job, /^        run: node --test scripts\/stacked-integration-ci.test.mjs$/m);
  }
  assert.match(application, /test "\$\(git rev-parse HEAD\)" = "\$MERGE_SHA"/);
  assert.match(application, /CANDIDATE_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(application, /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
});

test("application runs migrations and the real PostgreSQL audit and domain cases", () => {
  const commands = ["npx --no-install prisma validate", "npm run db:migrate:verify", "npm run db:migrate:upgrade",
    ...["audit-ledger-concurrency.test.mjs", "audit-full-history-postgres.test.mjs",
      "audit-assurance-rehearsal.postgres.test.mjs", "audit-verification-progress.postgres.test.mjs",
      "job-change-impact-preview.postgres.test.mjs", "scheduled-job-changes.postgres.test.mjs",
      "emergency-access.postgres.test.mjs", "identity-provider-lifecycle.postgres.test.mjs"].map(file => `node --test scripts/${file}`)];
  let position = -1;
  for (const command of commands) {
    const next = application.indexOf(command);
    assert.ok(next > position, `missing or reordered mandatory command: ${command}`);
    position = next;
  }
  assert.match(application, /^          HRBP_DISPOSABLE_AUDIT_LEDGER_TEST: "true"$/m);
  assert.match(application, /^    timeout-minutes: 35$/m);
});

test("typecheck, full prebuild, Next build and OpenNext packaging remain mandatory", () => {
  const commands = ["npm run typecheck", "npm run build", "npm run cf:build", "npx --no-install wrangler deploy --dry-run"];
  let position = -1;
  for (const command of commands) {
    const next = application.indexOf(`run: ${command}\n`);
    assert.ok(next > position, `missing or reordered mandatory build: ${command}`);
    position = next;
  }
  assert.doesNotMatch(application, /--ignore-scripts|--skip|SKIP_|DISABLE_|npm exec.*next|npx next|npm run build --/);
});

test("production and development dependency audits are separate from build success", () => {
  assert.match(dependencies, /^        run: npm run security:audit:prod$/m);
  assert.match(dependencies, /^        run: npm run security:audit:full$/m);
  assert.match(dependencies, /^    timeout-minutes: 15$/m);
  assert.doesNotMatch(dependencies, /--audit-level|--omit=dev|--production|--force/);
  assert.doesNotMatch(application + dependencies, /^\s*(needs|if):/m);
});

test("the aggregate result runs even on failed or skipped dependencies", () => {
  assert.match(result, /^    needs: \[application, dependencies, platform\]$/m);
  assert.match(result, /^    if: \$\{\{ always\(\) \}\}$/m);
  assert.match(result, /^    timeout-minutes: 2$/m);
  assert.match(result, /^          APPLICATION_RESULT: \$\{\{ needs.application.result \}\}$/m);
  assert.match(result, /^          DEPENDENCIES_RESULT: \$\{\{ needs.dependencies.result \}\}$/m);
  assert.match(result, /^          PLATFORM_RESULT: \$\{\{ needs.platform.result \}\}$/m);
  assert.doesNotMatch(result, /^\s*(uses|continue-on-error):/m);
});

test("platform reuses the same-commit suite without inputs, secrets or skip conditions", () => {
  assert.equal(platform.trim(), [
    "name: Stacked browser and platform regression",
    "    uses: ./.github/workflows/platform-regression.yml",
    "    permissions:",
    "      contents: read"
  ].join("\n"));
});

test("actual aggregate shell rejects all 215 non-success combinations", () => {
  const shell = result.split("        run: |\n")[1].split("\n").map(line => line.slice(10)).join("\n");
  assert.equal(shell.trim(), 'set -euo pipefail\ntest "$APPLICATION_RESULT" = success\ntest "$DEPENDENCIES_RESULT" = success\ntest "$PLATFORM_RESULT" = success');
  const outcomes = ["success", "failure", "cancelled", "skipped", "", "unknown"];
  let checked = 0;
  for (const application of outcomes) {
    for (const dependencies of outcomes) {
      for (const platform of outcomes) {
        const child = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", shell], {
          env: { PATH: "/usr/bin:/bin", APPLICATION_RESULT: application,
            DEPENDENCIES_RESULT: dependencies, PLATFORM_RESULT: platform },
          timeout: 2000, maxBuffer: 4096, encoding: "utf8"
        });
        assert.equal(child.error, undefined);
        assert.equal(child.signal, null);
        assert.equal(child.status, [application, dependencies, platform].every(value => value === "success") ? 0 : 1);
        checked++;
      }
    }
  }
  assert.equal(checked, 216);
});
