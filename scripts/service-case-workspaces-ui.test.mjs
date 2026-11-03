import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const services = readFileSync("components/employee-services-live-workspace.tsx", "utf8");
const modulePage = readFileSync("app/module/[slug]/page.tsx", "utf8");
const hrLifecycle = readFileSync("lib/hr-service-lifecycle-live-data.ts", "utf8");
const hrAccess = readFileSync("lib/hr-service-access.ts", "utf8");
const caseLifecycle = readFileSync("lib/employee-relations-lifecycle-live-data.ts", "utf8");
const caseWall = readFileSync("lib/case-wall.ts", "utf8");
const css = readFileSync("app/workspace-shell.css", "utf8");
const servicesCss = readFileSync("app/employee-services.css", "utf8");

test("HR Service starts with work, queue, lifecycle and escalation context", () => {
  assert.match(services, /\/module\/workflows\?view=hr-service/);
  assert.match(services, /id="hr-service-queue"/);
  assert.match(services, /href="#hr-service-lifecycle"/);
  assert.match(services, /href="#hr-service-escalation"/);
  assert.match(services, /className="service-admin-panel"/);
});

test("HR Service lifecycle and escalation are progressive disclosure, not always-open duplicate workspaces", () => {
  assert.match(modulePage, /<details id="hr-service-lifecycle" className="service-governance-panel"/);
  assert.match(modulePage, /open=\{Boolean\(query\)\}/);
  assert.match(modulePage, /!isHRServiceSelfServiceRole\(ctx\.role\)/);
  assert.match(modulePage, /<details id="hr-service-escalation" className="service-governance-panel"/);
  assert.match(modulePage, /open=\{Boolean\(escalation\)\}/);
});

test("HR Service read scope remains relationship and queue governed", () => {
  assert.match(hrLifecycle, /hrServiceRequestWhere\(db, ctx\)/);
  assert.match(hrLifecycle, /tenantId: ctx\.tenantId/);
  assert.match(hrAccess, /hrServiceRequestWhere/);
  assert.match(services, /data\.queueManage\?<details className="service-admin-panel"/);
});

test("Employee Relations keeps Case Wall as the primary need-to-know boundary", () => {
  assert.match(services, /\/module\/workflows\?view=employee-relations/);
  assert.match(services, /id="er-case-register"/);
  assert.match(services, /id="er-case-wall"/);
  assert.match(services, /href="#er-lifecycle"/);
  assert.match(modulePage, /<details id="er-lifecycle" className="service-governance-panel"/);
  assert.match(caseLifecycle, /listCaseWallCases\(ctx, db\)/);
  assert.match(caseLifecycle, /getCaseWallCase\(ctx,/);
  assert.match(caseWall, /ownerUserId: ctx\.actorId/);
  assert.match(caseWall, /assignments: \{ some:/);
});

test("Case Wall emergency access remains explicit and does not become generic Tenant Admin access", () => {
  assert.match(caseWall, /ctx\.breakGlassActive === true && ctx\.role === PlatformRole\.TENANT_ADMIN/);
  assert.doesNotMatch(caseWall, /ctx\.role === PlatformRole\.TENANT_ADMIN\s*\?\s*\{\}/);
});

test("service/case cockpit follows responsive Warm Enterprise styling", () => {
  for (const selector of [".services-focus-grid", ".services-focus-card", ".service-governance-panel", ".service-admin-panel"]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media\(max-width:620px\)/);
});


test("HR Service and Employee Relations registers deep-link scoped rows into lifecycle detail", () => {
  assert.ok((services.match(/services-master-link/g) ?? []).length >= 2);
  assert.match(services, /\/module\/hr-service\?q=/);
  assert.match(services, /#hr-service-lifecycle/);
  assert.match(services, /\/module\/employee-relations\?q=/);
  assert.match(services, /&case=/);
  assert.match(services, /#er-lifecycle/);
  assert.ok((services.match(/aria-current=\{focusId===/g) ?? []).length >= 2);
  assert.match(servicesCss, /\.services-master-link/);
  assert.match(servicesCss, /\.services-table tbody tr\.focused/);
});
