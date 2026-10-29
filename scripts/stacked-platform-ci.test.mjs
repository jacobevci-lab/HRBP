import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Declarative wiring checks plus execution of the actual identity recorder.
// These are not browser tests, a YAML parser, or a sandbox for hostile PR code.
const platform = readFileSync(new URL("../.github/workflows/platform-regression.yml", import.meta.url), "utf8");
const stacked = readFileSync(new URL("../.github/workflows/stacked-integration.yml", import.meta.url), "utf8");
function step(name) {
  const prefix = `      - name: ${name}\n`;
  assert.equal(platform.split(prefix).length, 2, `unique step required: ${name}`);
  return platform.split(prefix)[1].split(/\n      - /)[0];
}
function run(name) {
  const body = step(name).split("        run: |\n")[1];
  assert.ok(body, `multiline script required: ${name}`);
  return body.split("\n").map(line => line.slice(10)).join("\n");
}
const identityScript = run("Record platform source identity");
const identityCode = identityScript.match(/^node --input-type=module -e '\n([\s\S]*)\n'\s*$/)?.[1];
assert.ok(identityCode, "identity recorder must remain an explicit inline Node program");

test("reusable platform retains both existing main triggers without additional selectors", () => {
  assert.equal(platform.split("permissions:\n")[0],
    "name: Platform Regression\non:\n  workflow_call:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n");
  assert.doesNotMatch(platform, /pull_request_target|workflow_run|paths-ignore:|paths:|workflow_dispatch:/);
});

test("caller and callee keep separate concurrency groups", () => {
  assert.match(stacked, /^  group: hrbp-stacked-integration-\$\{\{ github.ref \}\}$/m);
  assert.match(platform, /^  group: platform-audit-\$\{\{ github.ref \}\}$/m);
  assert.match(platform, /^  cancel-in-progress: true$/m);
  assert.doesNotMatch(platform, /github.workflow/);
});

test("platform uses read-only permissions without inherited secrets or publishing", () => {
  assert.match(platform, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(platform, /secrets\.|secrets:\s*inherit|: write\b|id-token|environment:|continue-on-error|cf:deploy|wrangler|prisma db push|db:push|--ignore-scripts|--if-present/);
  const beforeSteps = platform.split("jobs:\n  audit:\n")[1].split("    steps:\n")[0];
  assert.match(beforeSteps, /^    runs-on: ubuntu-latest$/m);
  assert.match(beforeSteps, /^    timeout-minutes: 30$/m);
  assert.match(beforeSteps, /^    defaults:\n      run:\n        shell: bash$/m);
  assert.doesNotMatch(beforeSteps, /^\s*(if|needs|permissions):/m);
});

test("platform checks the merge candidate using pinned checkout and repository Node", () => {
  assert.match(platform, /uses: actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6\n        with:\n          persist-credentials: false/);
  assert.match(platform, /uses: actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6\n        with:\n          node-version-file: \.node-version/);
  assert.doesNotMatch(platform, /^\s*(ref|repository|token):/m);
  assert.equal(step("Verify stacked and platform workflow contracts").trim(),
    "run: node --test scripts/stacked-integration-ci.test.mjs scripts/stacked-platform-ci.test.mjs");
  assert.ok(platform.indexOf("Record platform source identity") < platform.indexOf("Start PostgreSQL for regression audit"));
  const identity = step("Record platform source identity");
  assert.match(identity, /TESTED_SHA: \$\{\{ github.sha \}\}/);
  assert.match(identity, /CANDIDATE_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(identity, /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.doesNotMatch(identityScript, /\$\{\{/);
});

test("browser fixture database remains the fixed disposable loopback database", () => {
  for (const key of ["DATABASE_URL", "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"]) {
    assert.ok(platform.includes(`      ${key}: postgresql://hrbp:disposable-audit-only@127.0.0.1:5432/hrbp_audit\n`));
  }
  assert.match(platform, /^      HRBP_DISPOSABLE_AUDIT: "true"$/m);
  assert.match(platform, /^      HRBP_LOCAL_AUTH_ENABLED: "true"$/m);
  const database = run("Start PostgreSQL for regression audit");
  assert.match(database, /^set -euo pipefail$/m);
  assert.match(database, /psql -v ON_ERROR_STOP=1/);
  assert.match(database, /if \[ "\$ready" -ne 1 \]; then[\s\S]*exit 1/);
});

test("runtime secrets are generated and masked, not copied from production", () => {
  const secrets = run("Create ephemeral test secrets");
  for (const [variable, bytes, environment] of [
    ["session_secret", 48, "HRBP_SESSION_SECRET"],
    ["admin_password", 24, "HRBP_TEST_ADMIN_PASSWORD"],
    ["engagement_secret", 48, "HRBP_ENGAGEMENT_RESPONSE_SECRET"]
  ]) {
    assert.ok(secrets.includes(`${variable}=$(openssl rand -hex ${bytes})`));
    assert.ok(secrets.includes(`echo "::add-mask::$${variable}"`));
    assert.ok(secrets.includes(`echo "${environment}=$${variable}" >> "$GITHUB_ENV"`));
  }
});

test("committed dependencies, Chromium and independent native download calibration remain required", () => {
  const install = run("Install application and isolated browser tooling");
  assert.match(install, /^npm ci > \.audit\/install.log 2>&1$/m);
  assert.match(install, /^npm install --no-save --package-lock=false playwright@1\.56\.1 > \.audit\/playwright-install.log 2>&1$/m);
  assert.match(install, /^npx playwright install --with-deps chromium > \.audit\/browser-install.log 2>&1$/m);
  assert.equal(run("Verify native download observation independently of application code").trim(),
    "node --test scripts/audit-download-observer.test.mjs\nnode scripts/native-download-calibration.mjs");
});

test("committed migrations and all eight domain seeders remain mandatory", () => {
  const seed = run("Prepare disposable database and seed all product domains");
  assert.match(seed, /^npm run db:migrate:upgrade >> \.audit\/schema.log 2>&1$/m);
  assert.match(seed, /^for script in seed-staging seed-work-pay-staging seed-access-staging seed-growth-staging seed-connected-growth-staging seed-services-staging seed-service-governance-staging seed-governance-planning-staging; do$/m);
  assert.match(seed, /node "scripts\/\$script.mjs" >> \.audit\/seed.log 2>&1 \|\| \{ tail -40 \.audit\/seed.log; exit 1; \}/);
});

test("all fifteen existing pre-browser unit suites and the production build remain required", () => {
  const build = run("Build production application");
  const expected = ["platform-remediation", "platform-render", "locale-preference", "locale-progress",
    "core-workspace-resilience", "core-workspace-browser-wiring", "module-workspace-resilience",
    "leave-validation", "leave-client-action", "leave-decision", "action-center-leave",
    "action-center-queue", "action-center-source-health", "audit-locale-readiness", "logout-get-probe"];
  assert.equal(build.split("\n")[0], `node --test ${expected.map(name => `scripts/${name}.test.mjs`).join(" ")}`);
  assert.match(build, /^npx next build > \.audit\/build.log 2>&1 \|\| \{ tail -80 \.audit\/build.log; exit 1; \}$/m);
});

test("all fourteen browser/API gate invocations remain required in their original order", () => {
  const audit = run("Browser, link, API and workflow audit");
  const commands = audit.split("\n").filter(line => /^(node scripts\/|HRBP_)/.test(line));
  assert.deepEqual(commands, [
    "node scripts/platform-render-regression.mjs",
    "node scripts/platform-audit.mjs || { tail -70 .audit/server.log; exit 1; }",
    "node scripts/platform-auth-browser-audit.mjs || { tail -70 .audit/server.log; exit 1; }",
    "node scripts/action-center-queue-browser.mjs",
    "node scripts/action-center-source-health-browser.mjs",
    "node scripts/time-decision-browser-regression.mjs",
    "HRBP_TIME_DECISION_SURFACE=action-center node scripts/time-decision-browser-regression.mjs",
    "node scripts/leave-decision-browser-regression.mjs",
    "HRBP_LEAVE_DECISION_SURFACE=action-center node scripts/leave-decision-browser-regression.mjs",
    "node scripts/leave-api-regression.mjs",
    "node scripts/leave-browser-regression.mjs",
    "node scripts/module-workspace-browser-regression.mjs",
    "node scripts/core-workspace-browser-regression.mjs",
    "node scripts/platform-remediation-gate.mjs"
  ]);
  assert.match(audit, /next start --hostname localhost --port 3100/);
  assert.match(audit, /trap 'kill \$PID 2>\/dev\/null \|\| true' EXIT/);
  assert.match(audit, /test "\$ready" -eq 1 \|\| \{ tail -70 \.audit\/server.log; exit 1; \}/);
});

test("only evidence upload is unconditional; mandatory test steps cannot be skipped", () => {
  const conditional = platform.split("\n").filter(line => /^\s*if:/.test(line));
  assert.deepEqual(conditional, ["        if: always()"]);
  const evidence = step("Preserve complete audit evidence");
  assert.match(evidence, /^        if: always\(\)$/m);
  assert.match(evidence, /^          name: hrbp-platform-audit$/m);
  assert.match(evidence, /^          path: \.audit\/$/m);
  assert.match(evidence, /^          retention-days: 7$/m);
});

function exerciseIdentity(overrides = {}, setup = () => {}) {
  const cwd = mkdtempSync(join(tmpdir(), "hrbp-platform-identity-"));
  const environment = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: cwd,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null"
  };
  const git = args => execFileSync("git", args, { cwd, env: environment, encoding: "utf8" }).trim();
  try {
    git(["-c", "init.defaultBranch=main", "init", "--template=", "--quiet"]);
    git(["-c", "user.name=Local test", "-c", "user.email=test@example.test",
      "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "fixture"]);
    const sha = git(["rev-parse", "HEAD"]);
    setup(cwd);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", identityCode], {
      cwd, env: { ...environment, CI: "true", GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request",
        TESTED_SHA: sha, CANDIDATE_SHA: "a".repeat(40), BASE_SHA: "b".repeat(40), ...overrides },
      timeout: 5000, maxBuffer: 16384, encoding: "utf8"
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    const path = join(cwd, ".audit/source-identity.json");
    return { child, sha, file: existsSync(path) ? readFileSync(path, "utf8") : null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("actual PR identity recorder binds checked-out merge, head and base without claiming deployment", () => {
  const { child, sha, file } = exerciseIdentity();
  assert.equal(child.status, 0, child.stderr);
  const expected = { scope: "ci-local-platform-regression-only", testedRevision: sha,
    candidateRevision: "a".repeat(40), baseRevision: "b".repeat(40), releaseAuthorized: false, productionDeployed: false };
  assert.deepEqual(JSON.parse(file), expected);
  assert.deepEqual(JSON.parse(child.stdout), expected);
});

test("actual main-push recorder works without PR metadata", () => {
  const { child, sha, file } = exerciseIdentity({ GITHUB_EVENT_NAME: "push", CANDIDATE_SHA: "", BASE_SHA: "" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(file), { scope: "ci-local-platform-regression-only", testedRevision: sha,
    candidateRevision: null, baseRevision: null, releaseAuthorized: false, productionDeployed: false });
});

for (const [name, overrides, error] of [
  ["non-CI execution", { CI: "false" }, "INVALID"],
  ["non-GitHub execution", { GITHUB_ACTIONS: "false" }, "INVALID"],
  ["unsupported event", { GITHUB_EVENT_NAME: "workflow_dispatch" }, "INVALID"],
  ["missing tested revision", { TESTED_SHA: "" }, "INVALID"],
  ["short tested revision", { TESTED_SHA: "1db315f" }, "INVALID"],
  ["missing PR head", { CANDIDATE_SHA: "" }, "INVALID"],
  ["missing PR base", { BASE_SHA: "" }, "INVALID"],
  ["injected PR metadata", { CANDIDATE_SHA: "$(touch injected)" }, "INVALID"],
  ["different checkout", { TESTED_SHA: "0".repeat(40) }, "MISMATCH"]
]) {
  test(`actual identity recorder rejects ${name} without publishing evidence`, () => {
    const { child, file } = exerciseIdentity(overrides);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, new RegExp(`PLATFORM_SOURCE_IDENTITY_${error}`));
    assert.equal(child.stdout, "");
    assert.equal(file, null);
  });
}

test("actual recorder refuses to overwrite a pre-existing source identity", () => {
  const original = '{"untrusted":"existing"}\n';
  const { child, file } = exerciseIdentity({}, cwd => {
    mkdirSync(join(cwd, ".audit"));
    writeFileSync(join(cwd, ".audit/source-identity.json"), original);
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /EEXIST/);
  assert.equal(child.stdout, "");
  assert.equal(file, original);
});
