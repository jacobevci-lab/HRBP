import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const service = readFileSync("lib/position-bulk-actions.ts", "utf8");
const action = readFileSync("lib/position-bulk-action.ts", "utf8");
const control = readFileSync("components/position-bulk-action-form.tsx", "utf8");
const workspace = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");

function loadService() {
  const output = ts.transpileModule(service, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "@prisma/client") return { DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" } };
    if (name === "@/lib/audit") return { appendAudit: async () => {} };
    if (name === "@/lib/authorization") return { can: () => true };
    if (name === "@/lib/db") return { withDb: () => { throw new Error("not used"); } };
    throw new Error("Unexpected dependency " + name);
  }, module, module.exports);
  return module.exports;
}

test("position bulk identifiers are bounded, deduplicated and reject malformed input", () => {
  const api = loadService();
  assert.deepEqual(api.normalizePositionBulkIds(["p1", "p2", "p1"]), ["p1", "p2"]);
  assert.equal(api.normalizePositionBulkIds([]), null);
  assert.equal(api.normalizePositionBulkIds(["bad\nid"]), null);
  assert.equal(api.normalizePositionBulkIds(Array.from({ length: 101 }, (_, i) => `p-${i}`)), null);
  assert.equal(api.MAX_POSITION_BULK_SELECTION, 100);
});

test("position criticality bulk mutation is write-authorized, tenant scoped and atomic", () => {
  assert.match(service, /can\(ctx, "positions:write"\)/);
  assert.match(service, /client\.\$transaction/);
  assert.match(service, /tenantId: ctx\.tenantId/);
  assert.match(service, /validTo: null/);
  assert.match(service, /if \(positions\.length !== ids\.length\) throw new Error\("POSITION_BULK_SCOPE_MISMATCH"\)/);
  assert.match(service, /if \(update\.count !== changedIds\.length\) throw new Error\("POSITION_BULK_CONFLICT"\)/);
  assert.match(service, /POSITION_MARKED_CRITICAL/);
  assert.match(service, /POSITION_CRITICALITY_CLEARED/);
  assert.match(service, /await appendAudit\(tx, ctx/);
});

test("bulk server action derives identity from the signed server session and revalidates Positions only", () => {
  assert.match(action, /getServerRequestContext\(\)/);
  assert.match(action, /formData\.getAll\("positionIds"\)/);
  assert.match(action, /bulkSetPositionCriticality/);
  assert.match(action, /revalidatePath\("\/module\/positions"\)/);
  assert.doesNotMatch(action, /x-tenant-id|x-user-id|x-role/);
});

test("bulk action UI is capability gated, confirmed and never rendered as a fake disabled preview", () => {
  assert.match(workspace, /canBulkManagePositions = !!ctx && can\(ctx, "positions:write"\)/);
  assert.match(workspace, /<PositionBulkActionForm locale=\{locale\} enabled=\{canBulkManagePositions\}>/);
  assert.match(workspace, /name="positionIds"/);
  assert.match(workspace, /data-position-select-all/);
  assert.match(control, /window\.confirm\(prompt\)/);
  assert.match(control, /selected/);
  assert.match(control, /mark-critical/);
  assert.match(control, /clear-critical/);
  assert.doesNotMatch(control, /localStorage|sessionStorage/);
});

test("position bulk controls participate in responsive Warm Enterprise styling", () => {
  for (const selector of [".position-bulk-form", ".position-bulk-bar", ".position-bulk-actions", ".position-bulk-select"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.position-bulk-actions/);
});
