import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
const secret = "job-change-preview-secret-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ-123456";

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error("Unmocked dependency " + name);
    return require(name);
  });
  return module.exports;
}

const auth = load("lib/auth-session.ts", {
  "@prisma/client": { PlatformRole: { EMPLOYEE: "EMPLOYEE" } },
  "@/lib/runtime-env": {
    runtimeString: (key) => key === "HRBP_SESSION_SECRET" ? secret : undefined,
    runtimeNumber: (_key, fallback) => fallback
  },
  "@/lib/safe-redirect": { sanitizeReturnTo: (value) => value }
});

const api = load("lib/employee-position-change-preview.ts", {
  "@/lib/auth-session": auth
});

const impactState = () => ({
  sourcePositionId: "position-old",
  sourceOrgUnitId: "org-old",
  sourceGrade: "G6",
  sourceLocation: "Istanbul",
  sourceCritical: false,
  managerEmploymentId: "manager-employment",
  directReportCount: 4,
  targetPositionId: "position-new",
  targetOrgUnitId: "org-new",
  targetGrade: "G7",
  targetLocation: "Istanbul",
  targetCritical: true,
  openTargetRequisitionCount: 1
});

const input = () => ({
  tenantId: "tenant-a",
  actorId: "actor-a",
  personId: "person-a",
  employmentId: "employment-a",
  sourcePositionId: "position-old",
  targetPositionId: "position-new",
  eventType: "PROMOTED",
  effectiveAt: new Date("2026-10-08T00:00:00.000Z"),
  reason: "Approved promotion reference HR-2026-77",
  impactDigest: api.positionChangeImpactDigest(impactState())
});

function expected() {
  const value = input();
  return {
    tenantId: value.tenantId,
    actorId: value.actorId,
    personId: value.personId,
    targetPositionId: value.targetPositionId,
    eventType: value.eventType,
    effectiveAt: value.effectiveAt,
    reason: value.reason
  };
}

test("signed preview receipt is bound to actor, employee and requested change", () => {
  const receipt = api.createPositionChangePreviewReceipt(input());
  const claims = api.verifyPositionChangePreviewReceipt(receipt.token, expected());
  assert.ok(claims);
  assert.equal(claims.employmentId, "employment-a");
  assert.equal(claims.sourcePositionId, "position-old");
});

test("impact digest changes when governed relationship state changes", () => {
  const baseline = api.positionChangeImpactDigest(impactState());
  assert.notEqual(baseline, api.positionChangeImpactDigest({ ...impactState(), directReportCount: 5 }));
  assert.notEqual(baseline, api.positionChangeImpactDigest({ ...impactState(), managerEmploymentId: "manager-other" }));
  assert.notEqual(baseline, api.positionChangeImpactDigest({ ...impactState(), openTargetRequisitionCount: 2 }));
  assert.notEqual(baseline, api.positionChangeImpactDigest({ ...impactState(), targetCritical: false }));
});

test("preview receipt rejects field drift and token tampering", () => {
  const receipt = api.createPositionChangePreviewReceipt(input());
  const cases = [
    { ...expected(), actorId: "actor-b" },
    { ...expected(), personId: "person-b" },
    { ...expected(), targetPositionId: "position-other" },
    { ...expected(), eventType: "TRANSFERRED" },
    { ...expected(), effectiveAt: new Date("2026-10-09T00:00:00.000Z") },
    { ...expected(), reason: "Changed reason" }
  ];
  for (const candidate of cases) {
    assert.equal(api.verifyPositionChangePreviewReceipt(receipt.token, candidate), null);
  }
  const tail = receipt.token.at(-1);
  const tampered = receipt.token.slice(0, -1) + (tail === "A" ? "B" : "A");
  assert.equal(api.verifyPositionChangePreviewReceipt(tampered, expected()), null);
});

test("preview receipt expires after ten minutes", () => {
  const originalNow = Date.now;
  try {
    const base = Date.parse("2026-10-08T08:00:00.000Z");
    Date.now = () => base;
    const receipt = api.createPositionChangePreviewReceipt(input());
    Date.now = () => base + 9 * 60 * 1000;
    assert.ok(api.verifyPositionChangePreviewReceipt(receipt.token, expected()));
    Date.now = () => base + 10 * 60 * 1000 + 1000;
    assert.equal(api.verifyPositionChangePreviewReceipt(receipt.token, expected()), null);
  } finally {
    Date.now = originalNow;
  }
});
