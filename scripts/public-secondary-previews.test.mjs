import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const reason = {
  en: "Read-only preview; this action is unavailable.",
  tr: "Salt-okunur önizleme; bu işlem kullanılamaz."
};
const label = {
  en: "More actions unavailable in preview",
  tr: "Önizlemede diğer işlemler kullanılamaz"
};
const suites = [
  {
    path: "components/employee-services-workspace.tsx",
    exportName: "EmployeeServicesWorkspace",
    expected: { "employee-relations": 1, "hr-service": 1, policies: 1, workflows: 1 }
  },
  {
    path: "components/growth-workspace.tsx",
    exportName: "GrowthWorkspace",
    expected: { benefits: 1, performance: 1, talent: 0, succession: 1, learning: 1 }
  },
  {
    path: "components/work-pay-workspace.tsx",
    exportName: "WorkPayWorkspace",
    expected: { "time-attendance": 1, leave: 1, compensation: 1, payroll: 1 }
  }
];

function compile(source, filename) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    },
    reportDiagnostics: true
  });
  assert.deepEqual((result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
function loader(spec, locale) {
  const source = readFileSync(spec.path, "utf8");
  const compiled = compile(source, spec.path);
  const jsx = (type, props = {}) => ({ type, props });
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol("fragment") },
    "lucide-react": new Proxy({}, { get: () => () => jsx("svg", { "aria-hidden": true }) }),
    "@/lib/i18n-server": { getServerLocale: async () => locale }
  };
  const imported = [];
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      imported.push(name);
      assert.ok(Object.hasOwn(dependencies, name), `Unreviewed preview dependency: ${name}`);
      return dependencies[name];
    }
  }, { filename: spec.path, timeout: 2000 });
  return { workspace: module.exports[spec.exportName], imported };
}
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}
function elements(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children, type)];
}

for (const locale of ["en", "tr"]) {
  for (const spec of suites) {
    for (const [slug, expectedCount] of Object.entries(spec.expected)) {
      test(`${locale}/${slug}: synthetic secondary preview never exposes an enabled placeholder menu`, async () => {
        const h = loader(spec, locale);
        const view = expand(await h.workspace({ slug }));
        const buttons = elements(view, "button");
        assert.equal(buttons.length, expectedCount, "Do not hide or add preview actions to satisfy the check");
        for (const button of buttons) {
          assert.equal(button.props.disabled, true);
          assert.equal(button.props.type, "button");
          assert.equal(button.props.title, reason[locale]);
          assert.equal(button.props["aria-label"], label[locale]);
          assert.equal(button.props.onClick, undefined);
          assert.equal(button.props.onKeyDown, undefined);
          assert.equal(button.props.formAction, undefined);
        }
        assert.deepEqual([...new Set(h.imported)].sort(), ["@/lib/i18n-server", "lucide-react", "react/jsx-runtime"].sort());
      });
    }
  }
}
test("the three secondary preview sources contain exactly the twelve reviewed placeholder declarations", () => {
  let total = 0;
  for (const spec of suites) {
    const source = readFileSync(spec.path, "utf8");
    const count = [...source.matchAll(/<button\s+\{\.\.\.previewActionProps\(locale\)\}>/g)].length;
    assert.equal(count, 4, spec.path);
    assert.doesNotMatch(source, /<button><MoreHorizontal\s+size=\{18\}\/><\/button>/);
    total += count;
  }
  assert.equal(total, 12);
});
