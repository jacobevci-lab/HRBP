import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

test("emergency access resolves only active time-bounded tenant-admin grants", async () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  const calls = { grant: 0, policy: 0 };
  const emergency = load("lib/emergency-access.ts", {
    "@prisma/client": {
      EmergencyAccessStatus: { ACTIVE: "ACTIVE" },
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN", HRBP: "HRBP" }
    },
    "@/lib/db": {
      db: {
        tenantSecurityPolicy: {
          findUnique: async () => { calls.policy += 1; return { breakGlassEnabled: true }; }
        },
        emergencyAccessGrant: {
          findFirst: async () => {
            calls.grant += 1;
            return { id: "grant-1", validTo: new Date("2026-10-08T12:30:00.000Z") };
          }
        }
      }
    }
  });

  const active = await emergency.resolveEmergencyAccess({
    tenantId: "tenant-1",
    actorId: "admin-1",
    role: "TENANT_ADMIN",
    now
  });
  assert.deepEqual(active, {
    breakGlassActive: true,
    breakGlassGrantId: "grant-1",
    breakGlassExpiresAt: new Date("2026-10-08T12:30:00.000Z")
  });
  assert.equal(calls.policy, 1);
  assert.equal(calls.grant, 1);

  const nonAdmin = await emergency.resolveEmergencyAccess({
    tenantId: "tenant-1",
    actorId: "hrbp-1",
    role: "HRBP",
    now
  });
  assert.deepEqual(nonAdmin, { breakGlassActive: false });
  assert.equal(calls.policy, 1);
  assert.equal(calls.grant, 1);
});

test("disabled tenant break-glass policy fails closed", async () => {
  const emergency = load("lib/emergency-access.ts", {
    "@prisma/client": {
      EmergencyAccessStatus: { ACTIVE: "ACTIVE" },
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN" }
    },
    "@/lib/db": {
      db: {
        tenantSecurityPolicy: { findUnique: async () => ({ breakGlassEnabled: false }) },
        emergencyAccessGrant: { findFirst: async () => ({ id: "grant-1", validTo: new Date(Date.now() + 60_000) }) }
      }
    }
  });
  assert.deepEqual(await emergency.resolveEmergencyAccess({
    tenantId: "tenant-1",
    actorId: "admin-1",
    role: "TENANT_ADMIN"
  }), { breakGlassActive: false });
});

test("database failure never grants emergency access", async () => {
  const emergency = load("lib/emergency-access.ts", {
    "@prisma/client": {
      EmergencyAccessStatus: { ACTIVE: "ACTIVE" },
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN" }
    },
    "@/lib/db": {
      db: {
        tenantSecurityPolicy: { findUnique: async () => { throw new Error("database unavailable"); } },
        emergencyAccessGrant: { findFirst: async () => { throw new Error("database unavailable"); } }
      }
    }
  });
  assert.deepEqual(await emergency.resolveEmergencyAccess({
    tenantId: "tenant-1",
    actorId: "admin-1",
    role: "TENANT_ADMIN"
  }), { breakGlassActive: false });
});

test("classification helper grants only highly-restricted read while break-glass is active", () => {
  const authorization = load("lib/authorization.ts", {
    "@prisma/client": {
      DataClassification: {
        INTERNAL: "INTERNAL",
        CONFIDENTIAL: "CONFIDENTIAL",
        RESTRICTED: "RESTRICTED",
        HIGHLY_RESTRICTED: "HIGHLY_RESTRICTED"
      },
      PlatformRole: {
        EMPLOYEE: "EMPLOYEE",
        MANAGER: "MANAGER",
        HRBP: "HRBP",
        HR_OPERATIONS: "HR_OPERATIONS",
        RECRUITER: "RECRUITER",
        TIME_ADMIN: "TIME_ADMIN",
        TALENT_ADMIN: "TALENT_ADMIN",
        COMPENSATION_ADMIN: "COMPENSATION_ADMIN",
        PAYROLL_ADMIN: "PAYROLL_ADMIN",
        ER_INVESTIGATOR: "ER_INVESTIGATOR",
        LEGAL: "LEGAL",
        PRIVACY_OFFICER: "PRIVACY_OFFICER",
        SECURITY_AUDITOR: "SECURITY_AUDITOR",
        TENANT_ADMIN: "TENANT_ADMIN"
      }
    },
    "@/lib/request-context": {}
  });

  assert.equal(authorization.canReadClassification(
    { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", breakGlassActive: false },
    "HIGHLY_RESTRICTED"
  ), false);
  assert.equal(authorization.canReadClassification(
    { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", breakGlassActive: true },
    "HIGHLY_RESTRICTED"
  ), true);
  assert.equal(authorization.canReadClassification(
    { tenantId: "tenant-1", actorId: "hrbp-1", role: "HRBP", breakGlassActive: true },
    "HIGHLY_RESTRICTED"
  ), false);
  assert.equal(authorization.canReadClassification(
    { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", breakGlassActive: false },
    "RESTRICTED"
  ), true);

  const breakGlassAdmin = { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", breakGlassActive: true };
  assert.equal(authorization.can(breakGlassAdmin, "cases:read"), true);
  assert.equal(authorization.can(breakGlassAdmin, "privacy:read"), true);
  assert.equal(authorization.can(breakGlassAdmin, "cases:write"), false);
  assert.equal(authorization.can(breakGlassAdmin, "privacy:write"), false);
  assert.equal(authorization.can(breakGlassAdmin, "payroll:read"), false);
});


test("case wall keeps ordinary assignment scoping but allows active tenant-admin emergency reads", async () => {
  const calls = [];
  const client = {
    employeeCase: {
      findFirst: async (args) => { calls.push({ kind: "one", args }); return null; },
      findMany: async (args) => { calls.push({ kind: "many", args }); return []; }
    }
  };
  const caseWall = load("lib/case-wall.ts", {
    "@prisma/client": {
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN", ER_INVESTIGATOR: "ER_INVESTIGATOR" }
    },
    "@/lib/db": { db: client },
    "@/lib/request-context": {}
  });

  await caseWall.getCaseWallCase({
    tenantId: "tenant-1",
    actorId: "admin-1",
    role: "TENANT_ADMIN",
    breakGlassActive: true
  }, "case-1", client);
  assert.equal("OR" in calls[0].args.where, false);

  await caseWall.listCaseWallCases({
    tenantId: "tenant-1",
    actorId: "investigator-1",
    role: "ER_INVESTIGATOR",
    breakGlassActive: false
  }, client);
  assert.ok(Array.isArray(calls[1].args.where.OR));
  assert.equal(calls[1].args.where.tenantId, "tenant-1");
});
