import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the actual TSX with explicit hook/JSX/icon/locale/data doubles.
// These are component-output/control-flow tests, not browser hydration or native
// keyboard tests. No tenant, API, SMTP, database or network boundary is supplied.
const componentPath = "components/core-hr-workspace.tsx";
const source = readFileSync(componentPath, "utf8");
const validatorPath = "scripts/validate-public-staging.mjs";
const validator = readFileSync(validatorPath, "utf8");
const reason = {
  en: "Read-only preview; this action is unavailable.",
  tr: "Salt-okunur önizleme; bu işlem kullanılamaz."
};
const fixtures = {
  employees: [
    { id: "DEMO-1", name: "Ada Example", initials: "AE", role: "Engineer", department: "Engineering", position: "P-1", location: "Istanbul", status: "Active", start: "2026-01-01", manager: "Demo Manager" },
    { id: "DEMO-2", name: "Deniz Sample", initials: "DS", role: "Analyst", department: "Finance", position: "P-2", location: "Ankara", status: "On leave", start: "2026-02-01", manager: "Demo Manager" }
  ],
  orgUnits: [{ code: "ORG-1", name: "Demo Org", type: "Department", people: 2 }],
  positions: [{ code: "P-1", title: "Engineer", org: "Demo Org", grade: "G1", location: "Istanbul", incumbent: "Ada Example", status: "Filled", critical: true }],
  documents: [{ name: "Demo document", owner: "Demo Owner", category: "Sample", classification: "Internal", retention: "Demo only", updated: "2026-01-01" }],
  auditEvents: [{ actor: "Demo actor", action: "demo.read", resource: "demo-1", purpose: "Preview", classification: "Internal", time: "2026-01-01" }]
};
for (const rows of Object.values(fixtures)) {
  rows.forEach(Object.freeze);
  Object.freeze(rows);
}
Object.freeze(fixtures);

function compile(text, filename) {
  const result = ts.transpileModule(text, {
    // Compile .mjs input as a TS virtual filename for the explicit CJS VM boundary.
    fileName: filename.replace(/\.mjs$/, ".ts"),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true
  });
  assert.deepEqual((result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
const compiled = compile(source, componentPath);
function harness(initialLocale = "en") {
  let locale = initialLocale, state = "";
  const imported = [];
  const jsx = (type, props = {}) => ({ type, props });
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    react: { useState: () => [state, (value) => { state = value; }], useMemo: (run) => run() },
    "lucide-react": new Proxy({}, { get: () => () => jsx("svg", { "aria-hidden": true }) }),
    "@/lib/demo-data": fixtures,
    "@/components/locale-provider": { useLocale: () => ({ locale }) }
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      imported.push(name);
      assert.ok(Object.hasOwn(dependencies, name), `Unreviewed preview dependency: ${name}`);
      return dependencies[name];
    }
  }, { filename: componentPath, timeout: 2000 });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (node === null || node === undefined || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return {
    render: (slug) => expand(module.exports.CoreHRWorkspace({ slug })),
    setLocale: (value) => { locale = value; },
    imported,
    slugs: [...module.exports.coreWorkspaceSlugs]
  };
}
function elements(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children, type)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? text(node.props.children) : String(node);
}
const expectedButtons = { people: 3, organization: 1, positions: 1, "employee-360": 8, documents: 1, audit: 1 };
for (const locale of ["en", "tr"]) {
  for (const [slug, expected] of Object.entries(expectedButtons)) {
    test(`${locale}/${slug}: every unavailable action is named, explained and natively disabled`, () => {
      const view = harness(locale).render(slug);
      const buttons = elements(view, "button");
      assert.equal(buttons.length, expected, "Do not hide controls to satisfy the check");
      for (const button of buttons) {
        assert.equal(button.props.disabled, true);
        assert.equal(button.props.type, "button", "Preview controls must not accidentally submit an outer form");
        assert.equal(button.props.title, reason[locale]);
        assert.ok((button.props["aria-label"] || text(button)).trim(), "Every action must have an accessible name");
        assert.equal(button.props.onClick, undefined);
        assert.equal(button.props.onKeyDown, undefined);
        assert.equal(button.props.formAction, undefined);
      }
    });
  }
  test(`${locale}/people: local search still filters and clears without disabling the input`, () => {
    const h = harness(locale);
    let view = h.render("people");
    const input = elements(view, "input")[0];
    assert.notEqual(input.props.disabled, true);
    assert.equal(typeof input.props.onChange, "function");
    assert.ok(text(view).includes("Ada Example") && text(view).includes("Deniz Sample"));
    for (const query of ["FINANCE", "Analyst", "DEMO-2", "Deniz"]) {
      input.props.onChange({ target: { value: query } });
      view = h.render("people");
      assert.ok(text(view).includes("Deniz Sample"));
      assert.ok(!text(view).includes("Ada Example"));
      assert.equal(elements(view, "input")[0].props.value, query);
      assert.equal(elements(view, "button").length, 2);
    }
    input.props.onChange({ target: { value: "no-such-demo-record" } });
    assert.equal(elements(h.render("people"), "button").length, 1);
    input.props.onChange({ target: { value: "" } });
    assert.equal(elements(h.render("people"), "button").length, 3);
  });
  test(`${locale}/privacy: the existing noninteractive preview content is retained`, () => {
    const view = harness(locale).render("privacy");
    assert.equal(elements(view, "button").length, 0);
    assert.ok(text(view).includes(locale === "tr" ? "Gizlilik kontrolleri" : "Privacy controls"));
  });
}
test("locale changes update disabled-action explanations without losing a search draft", () => {
  const h = harness();
  elements(h.render("people"), "input")[0].props.onChange({ target: { value: "DEMO-2" } });
  h.setLocale("tr");
  const view = h.render("people");
  assert.equal(elements(view, "input")[0].props.value, "DEMO-2");
  assert.ok(elements(view, "button").every((button) => button.props.title === reason.tr && button.props.disabled));
  assert.equal(elements(view, "button")[1].props["aria-label"], "Deniz Sample kaydını aç");
});
test("the existing preview slug inventory and unknown-slug result remain unchanged", () => {
  const h = harness();
  assert.deepEqual(h.slugs, ["people", "organization", "positions", "employee-360", "documents", "privacy", "audit"]);
  assert.equal(h.render("unknown-preview"), null);
});
test("all preview branches use only explicit synthetic dependencies and never modify fixtures", () => {
  const before = JSON.stringify(fixtures), h = harness();
  for (const slug of h.slugs) h.render(slug);
  assert.deepEqual([...new Set(h.imported)].sort(), ["@/components/locale-provider", "@/lib/demo-data", "lucide-react", "react", "react/jsx-runtime"].sort());
  assert.equal(JSON.stringify(fixtures), before);
});

// Exercise the real prebuild validator with controlled source-reader and process
// boundaries. This tests propagation of child-test failure, not the other files.
async function runGate(result, invalidRouting = false) {
  const seen = [], output = [];
  const broadFixture = [
    "if (!authenticated) return true;", "if (loading) return !item.requiredCapability && !item.requiresAuthentication;",
    "Live tenant data and mutations are disabled", "PublicSettingsPreview",
    "if (!ctx) return <AppShell><PublicModuleLanding slug={slug}/></AppShell>;",
    "if (!ctx) return true;", "if (!ctx) return Response.json({ data: moduleResults }",
    "PublicCoreLanding", "if (!ctx) return", "GrowthWorkspace", "WorkPayWorkspace", "GovernancePlanningWorkspace"
  ].join("\n");
  const module = { exports: {} };
  const dependencies = {
    "node:fs/promises": { readFile: async (path) => invalidRouting && path === "app/module/[slug]/page.tsx" ? "" : broadFixture },
    "node:child_process": { spawnSync: (...args) => { seen.push(args); return result; } }
  };
  let exit = 0;
  try {
    await runInNewContext(`(async () => { ${compile(validator, validatorPath)} })()`, {
      module, exports: module.exports,
      require(name) { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
      process: { execPath: "/reviewed/node", exit(code) { throw Object.assign(new Error("gate exit"), { exitCode: code }); } },
      console: { log: (line) => output.push(line), error: (line) => output.push(line) }
    }, { timeout: 2000 });
  } catch (error) {
    if (error.exitCode !== 1) throw error;
    exit = error.exitCode;
  }
  return { exit, seen, output };
}
test("the mandatory staging validator runs this suite with Node, no shell, and a deadline", async () => {
  const result = await runGate({ status: 0, signal: null });
  assert.equal(result.exit, 0);
  assert.equal(result.seen.length, 1);
  const [command, args, options] = result.seen[0];
  assert.equal(command, "/reviewed/node");
  assert.deepEqual([...args], ["--test", "scripts/public-core-preview.test.mjs", "scripts/public-secondary-previews.test.mjs"]);
  assert.equal(options.stdio, "inherit");
  assert.equal(options.timeout, 30_000);
  assert.notEqual(options.shell, true);
  assert.match(result.output.at(-1), /^Validated public staging contract:/);
});
for (const [label, result] of [
  ["nonzero", { status: 1, signal: null }],
  ["missing exit", { status: null, signal: null }],
  ["termination", { status: 0, signal: "SIGTERM" }],
  ["spawn error", { status: 0, error: new Error("spawn failed") }],
  ["timeout", { status: null, signal: "SIGTERM", error: new Error("ETIMEDOUT") }]
]) {
  test(`prebuild cannot report success after preview test ${label}`, async () => {
    const gate = await runGate(result);
    assert.equal(gate.exit, 1);
    assert.equal(gate.seen.length, 1);
    assert.ok(!gate.output.some((line) => line.startsWith("Validated public staging contract:")));
  });
}
test("existing routing failures still stop staging before invoking the new suite", async () => {
  const gate = await runGate({ status: 0, signal: null }, true);
  assert.equal(gate.exit, 1);
  assert.equal(gate.seen.length, 0);
});
