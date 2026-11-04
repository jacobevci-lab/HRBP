import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("lib/enterprise-saved-views.ts", "utf8");
const actions = readFileSync("lib/enterprise-saved-view-actions.ts", "utf8");
const control = readFileSync("components/enterprise-saved-views.tsx", "utf8");
const workspace = readFileSync("components/core-hr-live-workspace.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261103101500_saved_enterprise_views/migration.sql", "utf8");

function loadService() {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "@/lib/authorization") return { can: () => true };
    if (name === "@/lib/db") return { db: {}, withDb: () => { throw new Error("not used"); } };
    throw new Error("Unexpected dependency " + name);
  }, module, module.exports);
  return module.exports;
}

test("SavedEnterpriseView is a tenant/user/module scoped preference model", () => {
  assert.match(schema, /model SavedEnterpriseView/);
  assert.match(schema, /tenantId\s+String/);
  assert.match(schema, /userId\s+String/);
  assert.match(schema, /moduleKey\s+String/);
  assert.match(schema, /columns\s+String\[\]\s+@default\(\[\]\)/);
  assert.match(schema, /density\s+String\s+@default\("comfortable"\)/);
  assert.match(schema, /sortKey\s+String\?/);
  assert.match(schema, /sortDirection\s+String\s+@default\("asc"\)/);
  assert.match(schema, /pageSize\s+Int\s+@default\(50\)/);
  assert.match(schema, /@@unique\(\[tenantId, userId, moduleKey, normalizedName\]\)/);
  assert.match(migration, /CHECK \("moduleKey" IN \('people', 'positions'\)\)/);
  assert.match(migration, /CHECK \("density" IN \('comfortable', 'compact'\)\)/);
  assert.match(migration, /CHECK \("sortDirection" IN \('asc', 'desc'\)\)/);
  assert.match(migration, /CHECK \("pageSize" IN \(25, 50, 100\)\)/);
  assert.match(migration, /FOREIGN KEY \("tenantId"\) REFERENCES "Tenant"/);
  assert.match(migration, /FOREIGN KEY \("userId"\) REFERENCES "UserAccount"/);
});

test("saved view state is allowlisted and produces a shareable URL", () => {
  const api = loadService();
  const state = api.sanitizeEnterpriseViewState("people", {
    query: "  Deniz & Team  ",
    status: "active",
    columns: ["status", "position", "evil", "status"],
    columnsCustomized: true,
    density: "compact",
    sortKey: "employeeNumber",
    sortDirection: "desc",
    pageSize: 100
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    query: "Deniz & Team",
    status: "ACTIVE",
    columns: ["status", "position"],
    columnsCustomized: true,
    density: "compact",
    sortKey: "employeeNumber",
    sortDirection: "desc",
    pageSize: 100
  });
  const href = api.buildEnterpriseViewHref("people", state);
  const url = new URL(href, "https://hrbp.invalid");
  assert.equal(url.pathname, "/module/people");
  assert.equal(url.searchParams.get("q"), "Deniz & Team");
  assert.equal(url.searchParams.get("status"), "ACTIVE");
  assert.equal(url.searchParams.get("columnsMode"), "custom");
  assert.deepEqual(url.searchParams.getAll("columns"), ["status", "position"]);
  assert.equal(url.searchParams.get("density"), "compact");
  assert.equal(url.searchParams.get("sort"), "employeeNumber");
  assert.equal(url.searchParams.get("dir"), "desc");
  assert.equal(url.searchParams.get("pageSize"), "100");
  assert.equal(url.searchParams.get("page"), null);
});

test("saved view names are bounded and normalized for case-insensitive upsert", () => {
  const api = loadService();
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeSavedViewName("  Active   Team  "))), {
    name: "Active Team",
    normalizedName: "active team"
  });
  assert.equal(api.normalizeSavedViewName(""), null);
  assert.equal(api.normalizeSavedViewName("x".repeat(65)), null);
  assert.equal(api.normalizeSavedViewName("bad\nname"), null);
});

test("persistence queries fail closed to the signed tenant, user and module", () => {
  assert.match(source, /tenantId: ctx\.tenantId, userId: ctx\.actorId, moduleKey/);
  assert.match(source, /count >= 20/);
  assert.match(source, /deleteMany\(\{[\s\S]*id, tenantId: ctx\.tenantId, userId: ctx\.actorId, moduleKey/);
  assert.match(source, /code === "P2021" \|\| code === "P2022"/);
  assert.match(source, /if \(isPreferenceSchemaUnavailable\(error\)\) return \[\]/);
  assert.match(source, /assertViewAccess\(ctx, moduleKey\)/);
});

test("saved view server actions use verified server context and revalidate only governed module paths", () => {
  assert.match(actions, /getServerRequestContext\(\)/);
  assert.match(actions, /upsertSavedEnterpriseView\(ctx, moduleKey/);
  assert.match(actions, /deleteSavedEnterpriseView\(ctx, moduleKey, id\)/);
  assert.match(actions, /revalidatePath\(enterpriseViewBasePath\(moduleKey\)\)/);
  assert.doesNotMatch(actions, /redirect\(formData|returnTo/);
});

test("People and Positions expose persisted view controls without localStorage persistence", () => {
  assert.ok((workspace.match(/listSavedEnterpriseViews\(ctx, "(?:people|positions)"\)/g) ?? []).length >= 2);
  assert.match(workspace, /moduleKey="people"/);
  assert.match(workspace, /moduleKey="positions"/);
  assert.ok((workspace.match(/savedViews=\{savedViews\}/g) ?? []).length >= 2);
  assert.match(control, /saveEnterpriseViewAction/);
  assert.match(control, /deleteEnterpriseViewAction/);
  assert.match(control, /Saved views/);
  assert.doesNotMatch(control, /localStorage|sessionStorage/);
});


test("invalid density fails closed to comfortable and is part of saved-view identity state", () => {
  const api = loadService();
  assert.equal(api.sanitizeEnterpriseViewState("positions", { density: "dense" }).density, "comfortable");
  assert.equal(api.sanitizeEnterpriseViewState("positions", { density: "compact" }).density, "compact");
  assert.match(source, /density: state\.density/);
  assert.match(actions, /density: formData\.get\("density"\)/);
  assert.match(control, /name="density" value=\{current\.density\}/);
});


test("saved sorting is module-allowlisted and invalid sort state falls back to default order", () => {
  const api = loadService();
  const people = api.sanitizeEnterpriseViewState("people", { sortKey: "critical", sortDirection: "desc" });
  assert.equal(people.sortKey, undefined);
  assert.equal(people.sortDirection, "asc");
  const positions = api.sanitizeEnterpriseViewState("positions", { sortKey: "critical", sortDirection: "desc" });
  assert.equal(positions.sortKey, "critical");
  assert.equal(positions.sortDirection, "desc");
  assert.match(source, /sortKey: state\.sortKey \?\? null/);
  assert.match(actions, /sortKey: formData\.get\("sort"\)/);
  assert.match(actions, /sortDirection: formData\.get\("dir"\)/);
});


test("saved page size is allowlisted while transient page number is never persisted", () => {
  const api = loadService();
  assert.equal(api.sanitizeEnterpriseViewState("people", { pageSize: 25 }).pageSize, 25);
  assert.equal(api.sanitizeEnterpriseViewState("people", { pageSize: 100 }).pageSize, 100);
  assert.equal(api.sanitizeEnterpriseViewState("people", { pageSize: 999 }).pageSize, 50);
  assert.match(source, /pageSize: state\.pageSize/);
  assert.match(actions, /pageSize: Number\(formData\.get\("pageSize"\)\)/);
  assert.match(control, /name="pageSize" value=\{current\.pageSize\}/);
  assert.doesNotMatch(source, /state\.page\b|page:\s*row\.page/);
});


test("pagination links preserve saved view state but page itself remains transient", () => {
  const api = loadService();
  const state = api.sanitizeEnterpriseViewState("people", {
    query: "Deniz",
    status: "ACTIVE",
    columns: ["status"],
    columnsCustomized: true,
    density: "compact",
    sortKey: "employeeNumber",
    sortDirection: "desc",
    pageSize: 25
  });
  const pageHref = api.buildEnterprisePageHref("people", state, 3);
  const pageUrl = new URL(pageHref, "https://hrbp.invalid");
  assert.equal(pageUrl.searchParams.get("page"), "3");
  assert.equal(pageUrl.searchParams.get("pageSize"), "25");
  assert.equal(pageUrl.searchParams.get("density"), "compact");
  assert.equal(pageUrl.searchParams.get("sort"), "employeeNumber");
  assert.equal(pageUrl.searchParams.get("dir"), "desc");
  const savedUrl = new URL(api.buildEnterpriseViewHref("people", state), "https://hrbp.invalid");
  assert.equal(savedUrl.searchParams.get("page"), null);
});

test("saved view summaries localize technical status and sort keys", () => {
  assert.match(control, /function savedStatusLabel/);
  assert.match(control, /ACTIVE: \["Active", "Aktif"\]/);
  assert.match(control, /OPEN: \["Open", "Açık"\]/);
  assert.match(control, /function savedSortLabel/);
  assert.match(control, /employeeNumber: \["Employee ID", "Çalışan no"\]/);
  assert.match(control, /critical: \["Criticality", "Kritiklik"\]/);
  assert.match(control, /savedStatusLabel\(moduleKey, view\.state\.status, tr\)/);
  assert.match(control, /savedSortLabel\(moduleKey, view\.state\.sortKey, tr\)/);
  assert.doesNotMatch(control, /view\.state\.status \? view\.state\.status : null/);
});
