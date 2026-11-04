import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const peoplePage = readFileSync("app/module/people/new/page.tsx", "utf8");
const positionPage = readFileSync("app/module/positions/new/page.tsx", "utf8");
const peopleApi = readFileSync("app/api/people/route.ts", "utf8");
const access = readFileSync("lib/workforce-master-data-access.ts", "utf8");
const workforceMasterPolicy = readFileSync("lib/workforce-master-data-policy.ts", "utf8");
const moduleLanding = readFileSync("components/module-landing.tsx", "utf8");
const appShell = readFileSync("components/app-shell.tsx", "utf8");
const dedicatedPeoplePage = readFileSync("app/module/people/page.tsx", "utf8");

test("employee create workspace is signed-session and operational-role gated before reference data loads", () => {
  assert.match(peoplePage, /getServerRequestContext\(\)/);
  assert.match(peoplePage, /if \(!ctx\) redirect\("\/auth\/sign-in\?returnTo=%2Fmodule%2Fpeople%2Fnew"\)/);
  assert.match(peoplePage, /if \(!canCreateEmployeeMasterRecord\(ctx\)\)/);
  assert.match(peoplePage, /tenantId: ctx\.tenantId/);
  assert.doesNotMatch(peoplePage, /workspaceTenantId\(\)/);
  assert.doesNotMatch(peoplePage, /href="\/auth\/sign-in\?returnTo=%2Fmodule%2Fpeople%2Fnew"/);
  assert.match(peoplePage, /Employee creation access is restricted/);
  assert.match(peoplePage, /Çalışan oluşturma erişimi kısıtlı/);
});

test("employee page and API share one workforce master-data writer policy", () => {
  assert.match(workforceMasterPolicy, /"HR_OPERATIONS"/);
  assert.match(workforceMasterPolicy, /"TENANT_ADMIN"/);
  assert.match(workforceMasterPolicy, /roleCanCreateEmployeeMasterRecord/);
  assert.match(access, /can\(ctx, "people:write"\)/);
  assert.match(access, /roleCanCreateEmployeeMasterRecord\(ctx\.role\)/);
  assert.match(peopleApi, /canCreateEmployeeMasterRecord\(ctx\)/);
  assert.doesNotMatch(peopleApi, /workforceMasterDataWriters/);
});

test("position create workspace is signed-session and positions-write gated before organization data loads", () => {
  assert.match(positionPage, /getServerRequestContext\(\)/);
  assert.match(positionPage, /if \(!ctx\) redirect\("\/auth\/sign-in\?returnTo=%2Fmodule%2Fpositions%2Fnew"\)/);
  assert.match(positionPage, /if \(!can\(ctx, "positions:write"\)\)/);
  assert.match(positionPage, /tenantId: ctx\.tenantId/);
  assert.doesNotMatch(positionPage, /workspaceTenantId\(\)/);
  assert.doesNotMatch(positionPage, /href="\/auth\/sign-in\?returnTo=%2Fmodule%2Fpositions%2Fnew"/);
  assert.match(positionPage, /Position creation access is restricted/);
  assert.match(positionPage, /Pozisyon oluşturma erişimi kısıtlı/);
});


test("create CTAs use the same workforce master-data role policy as the page and API", () => {
  assert.match(moduleLanding, /canCreateEmployeeMasterRecord\(ctx\)/);
  assert.doesNotMatch(moduleLanding, /slug === "people" && can\(ctx, "people:read"\) && can\(ctx, "people:write"\)/);
  assert.match(appShell, /roleCanCreateEmployeeMasterRecord\(session\?\.user\?\.role\)/);
  assert.match(appShell, /navigationCapabilities\.has\("people:write"\)/);
});


test("dedicated People page uses the shared master-data create policy", () => {
  assert.match(dedicatedPeoplePage, /canCreateEmployeeMasterRecord\(ctx\)/);
  assert.doesNotMatch(dedicatedPeoplePage, /readable && can\(ctx, "people:write"\)/);
  assert.match(dedicatedPeoplePage, /href="\/module\/people\/new"/);
});
