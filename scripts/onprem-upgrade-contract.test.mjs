import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("scripts/onprem-upgrade.sh", "utf8");

function position(token) {
  const value = source.indexOf(token);
  assert.ok(value >= 0, `Missing upgrade contract token: ${token}`);
  return value;
}

test("upgrade sequence builds before downtime and backs up before migration", () => {
  const preflight = position("onprem-preflight.mjs");
  const currentHealth = position("Verifying current deployment health before upgrade");
  const build = position("Building target release before downtime");
  const stop = position("stop maintenance-scheduler app");
  const backup = position("onprem-backup.sh");
  const migration = position("--exit-code-from schema");
  const start = position("Starting target application and maintenance scheduler");
  const postflight = position("onprem-postflight.mjs");

  assert.ok(preflight < currentHealth);
  assert.ok(currentHealth < build);
  assert.ok(build < stop);
  assert.ok(stop < backup);
  assert.ok(backup < migration);
  assert.ok(migration < start);
  assert.ok(start < postflight);
});

test("upgrade never changes source revision or automatically restores", () => {
  assert.doesNotMatch(source, /\bgit\s+(?:pull|fetch|checkout)\b/);
  assert.doesNotMatch(source, /bash\s+scripts\/onprem-restore\.sh\s+"?\$backup_dir/);
  assert.match(source, /Do not force migrations/);
  assert.match(source, /fail-closed-no-automatic-schema-rollback/);
});

test("upgrade requires an explicit maintenance window acknowledgement", () => {
  assert.match(source, /--maintenance-window/);
  assert.match(source, /ACKNOWLEDGED=false/);
  assert.match(source, /upgrade requires --maintenance-window acknowledgement/);
});

test("upgrade records intent before migration and receipt only after postflight", () => {
  const preHealth = position("pre-upgrade-health.json");
  const intent = position("upgrade-intent.json");
  const migration = position("--exit-code-from schema");
  const postflight = position("onprem-postflight.mjs");
  const receipt = position("upgrade-receipt.json");
  assert.ok(preHealth < intent);
  assert.ok(intent < migration);
  assert.ok(migration < postflight);
  assert.ok(postflight < receipt);
});

test("upgrade captures pre-upgrade health without checking target migration status", () => {
  assert.match(source, /--mode pre-upgrade/);
  assert.match(source, /pre-upgrade-health\.json/);
  assert.match(source, /--mode post-deploy/);
});

test("target image and postflight are bound to the exact approved revision", () => {
  assert.match(source, /git -C "\$ROOT_DIR" rev-parse HEAD/);
  assert.match(source, /export GITHUB_SHA="\$TARGET_REVISION"/);
  assert.match(source, /--expected-revision "\$TARGET_REVISION"/);
  assert.match(source, /upgrade requires a full Git target revision/);
});
