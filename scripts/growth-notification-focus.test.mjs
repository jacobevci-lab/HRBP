import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports;
}

const { pickGrowthFocus } = load("lib/growth-route-focus.ts");
const { isOwnedSuccessionFocus } = load("lib/succession-focus.ts");

const routes = [
  { slug: "benefits", key: "enrollment" },
  { slug: "performance", key: "review" },
  { slug: "talent", key: "developmentPlan" },
  { slug: "learning", key: "assignment" },
  { slug: "succession", key: "candidate" }
];

test("each growth module accepts the exact notification resource key", () => {
  for (const { slug, key } of routes) {
    assert.equal(pickGrowthFocus(slug, { [key]: "owned-record-1" }), "owned-record-1");
  }
  assert.equal(pickGrowthFocus("succession", { plan: "owned-plan-2" }), "owned-plan-2");
  assert.equal(pickGrowthFocus("succession", { candidate: "candidate-2", plan: "plan-2" }), "plan-2");
  assert.equal(pickGrowthFocus("learning", { developmentPlan: "not-an-assignment" }), undefined);
});

test("the focus parser never coerces arrays, truncates ids or accepts control characters", () => {
  for (const value of [["candidate-1", "candidate-2"], "", " ".repeat(2) + "candidate", "a".repeat(129), "candidate\nspoofed", 9]) {
    assert.equal(pickGrowthFocus("succession", { candidate: value }), undefined);
  }
  assert.equal(pickGrowthFocus("talent", { developmentPlan: "record-with-.:_safe" }), "record-with-.:_safe");
});

test("explicit page routes forward matching notification parameters to GrowthModulePage", async () => {
  for (const { slug, key } of routes) {
    const page = load("app/module/" + slug + "/page.tsx", {
      "@/components/growth-module-page": { GrowthModulePage: args => args },
      "@/lib/growth-route-focus": { pickGrowthFocus }
    });
    const result = await page.default({ searchParams: Promise.resolve({ [key]: "target-1" }) });
    assert.deepEqual(result, { slug, focusId: "target-1" });
    const noFocus = await page.default({ searchParams: Promise.resolve({ other: "not-a-target" }) });
    assert.deepEqual(noFocus, { slug, focusId: undefined });
  }
  const succession = load("app/module/succession/page.tsx", {
    "@/components/growth-module-page": { GrowthModulePage: args => args },
    "@/lib/growth-route-focus": { pickGrowthFocus }
  });
  assert.deepEqual(await succession.default({ searchParams: Promise.resolve({ plan: "plan-1" }) }), {
    slug: "succession", focusId: "plan-1"
  });
});

test("succession candidate focus requires plan owner and a candidate in that already scoped plan", () => {
  const owned = { id: "plan-1", ownerId: "reviewer-1", candidates: [{ id: "candidate-1" }] };
  const otherOwned = { id: "plan-2", ownerId: "reviewer-2", candidates: [{ id: "candidate-2" }] };
  assert.equal(isOwnedSuccessionFocus(owned, "candidate-1", "reviewer-1"), true);
  assert.equal(isOwnedSuccessionFocus(owned, "plan-1", "reviewer-1"), true);
  assert.equal(isOwnedSuccessionFocus(owned, "candidate-1", "reviewer-2"), false);
  assert.equal(isOwnedSuccessionFocus(owned, "candidate-2", "reviewer-1"), false);
  assert.equal(isOwnedSuccessionFocus(otherOwned, "candidate-2", "reviewer-1"), false);
});

test("succession candidate ownership and tenant/relationship limits remain inside database loader", () => {
  const data = readFileSync("lib/succession-governance-data.ts", "utf8");
  assert.match(data, /tenantId: ctx\.tenantId/);
  assert.match(data, /employmentIdFilter\(scope\)/);
  assert.match(data, /plan\.ownerId === ctx\.actorId/);
  assert.match(data, /isOwnedSuccessionFocus\(plan, focusId, ctx\.actorId\)/);
  assert.match(data, /focused: candidate\.id === focusId/);
  assert.match(data, /focusVisible/);
  const ui = readFileSync("components/succession-governance-console.tsx", "utf8");
  assert.match(ui, /succession-candidate-\$\{candidate\.id\}/);
  assert.match(ui, /candidate\.focused \? " focused" : ""/);
  assert.match(ui, /scrollIntoView/);
});

test("notification resource hrefs and the generic growth route use the same focus keys", () => {
  const presentation = readFileSync("lib/notification-presentation.ts", "utf8");
  for (const uri of [
    "/module/benefits?enrollment=",
    "/module/performance?review=",
    "/module/talent?developmentPlan=",
    "/module/learning?assignment=",
    "/module/succession?candidate="
  ]) {
    assert.ok(presentation.includes(uri), "Missing notification URI: " + uri);
  }
  const generic = readFileSync("app/module/[slug]/page.tsx", "utf8");
  assert.match(generic, /pickGrowthFocus\(slug as GrowthSlug, search\)/);
  assert.match(generic, /focusId=\{growthFocus\}/);
});
