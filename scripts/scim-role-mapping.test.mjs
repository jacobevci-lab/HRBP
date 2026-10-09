import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  const prisma = {
    PlatformRole: {
      EMPLOYEE: "EMPLOYEE",
      MANAGER: "MANAGER",
      HRBP: "HRBP",
      RECRUITER: "RECRUITER",
      HR_OPERATIONS: "HR_OPERATIONS",
      TIME_ADMIN: "TIME_ADMIN",
      TALENT_ADMIN: "TALENT_ADMIN",
      COMPENSATION_ADMIN: "COMPENSATION_ADMIN",
      PAYROLL_ADMIN: "PAYROLL_ADMIN",
      ER_INVESTIGATOR: "ER_INVESTIGATOR",
      LEGAL: "LEGAL",
      PRIVACY_OFFICER: "PRIVACY_OFFICER",
      SECURITY_AUDITOR: "SECURITY_AUDITOR",
      TENANT_ADMIN: "TENANT_ADMIN"
    },
    ScimRoleMappingStatus: { DRAFT: "DRAFT", ACTIVE: "ACTIVE", DISABLED: "DISABLED" }
  };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name === "@prisma/client") return prisma;
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

const runtime = load("lib/scim-role-mapping.ts");

function fixture({ users, memberships, mappings }) {
  const state = users.map((user) => ({ ...user }));
  const updates = [];
  const tx = {
    userAccount: {
      findMany: async ({ where }) => state.filter((user) =>
        user.tenantId === where.tenantId &&
        user.provisioningSource === "SCIM" &&
        where.id.in.includes(user.id)
      ).map(({ id, displayName, role, roleManagedByScimGroup }) => ({
        id, displayName, role, roleManagedByScimGroup
      })),
      update: async ({ where, data }) => {
        const user = state.find((item) => item.id === where.id);
        if (!user) throw new Error("missing user");
        user.role = data.role;
        user.roleManagedByScimGroup = data.roleManagedByScimGroup;
        user.sessionVersion += 1;
        user.sessionsRevokedAt = data.sessionsRevokedAt;
        updates.push({ id: user.id, data });
        return user;
      }
    },
    scimGroupMember: {
      findMany: async ({ where }) => memberships.filter((row) =>
        row.tenantId === where.tenantId && where.userId.in.includes(row.userId)
      ).map(({ userId, groupId }) => ({ userId, groupId }))
    },
    scimGroupRoleMapping: {
      findMany: async ({ where }) => mappings.filter((row) =>
        row.tenantId === where.tenantId &&
        row.status === "ACTIVE" &&
        where.groupId.in.includes(row.groupId)
      ).map(({ groupId, role }) => ({ groupId, role }))
    }
  };
  return { tx, state, updates };
}

function baseUser(id, role = "EMPLOYEE", managed = false) {
  return {
    id,
    tenantId: "tenant-1",
    displayName: id,
    role,
    roleManagedByScimGroup: managed,
    provisioningSource: "SCIM",
    sessionVersion: 1,
    sessionsRevokedAt: null
  };
}

test("directory role mapping allowlist excludes privileged administrative roles", () => {
  for (const role of ["EMPLOYEE", "MANAGER", "HRBP", "RECRUITER"]) {
    assert.equal(runtime.isScimDirectoryAssignableRole(role), true, role);
  }
  for (const role of [
    "HR_OPERATIONS", "TIME_ADMIN", "TALENT_ADMIN", "COMPENSATION_ADMIN",
    "PAYROLL_ADMIN", "ER_INVESTIGATOR", "LEGAL", "PRIVACY_OFFICER",
    "SECURITY_AUDITOR", "TENANT_ADMIN"
  ]) {
    assert.equal(runtime.isScimDirectoryAssignableRole(role), false, role);
  }
});

test("one active mapping promotes a SCIM employee and revokes stale sessions", async () => {
  const { tx, state, updates } = fixture({
    users: [baseUser("user-1")],
    memberships: [{ tenantId: "tenant-1", userId: "user-1", groupId: "group-1" }],
    mappings: [{ tenantId: "tenant-1", groupId: "group-1", role: "MANAGER", status: "ACTIVE" }]
  });

  const result = await runtime.reconcileScimManagedRoles(tx, "tenant-1", ["user-1"]);
  assert.deepEqual(result, { changed: 1, managed: 1, released: 0 });
  assert.equal(state[0].role, "MANAGER");
  assert.equal(state[0].roleManagedByScimGroup, true);
  assert.equal(state[0].sessionVersion, 2);
  assert.ok(state[0].sessionsRevokedAt instanceof Date);
  assert.equal(updates.length, 1);
});

test("equal roles from multiple active groups remain deterministic", async () => {
  const { tx, state } = fixture({
    users: [baseUser("user-1")],
    memberships: [
      { tenantId: "tenant-1", userId: "user-1", groupId: "group-1" },
      { tenantId: "tenant-1", userId: "user-1", groupId: "group-2" }
    ],
    mappings: [
      { tenantId: "tenant-1", groupId: "group-1", role: "HRBP", status: "ACTIVE" },
      { tenantId: "tenant-1", groupId: "group-2", role: "HRBP", status: "ACTIVE" }
    ]
  });

  await runtime.reconcileScimManagedRoles(tx, "tenant-1", ["user-1"]);
  assert.equal(state[0].role, "HRBP");
  assert.equal(state[0].roleManagedByScimGroup, true);
});

test("conflicting active group roles fail closed without changing the account", async () => {
  const { tx, state, updates } = fixture({
    users: [baseUser("user-1")],
    memberships: [
      { tenantId: "tenant-1", userId: "user-1", groupId: "group-1" },
      { tenantId: "tenant-1", userId: "user-1", groupId: "group-2" }
    ],
    mappings: [
      { tenantId: "tenant-1", groupId: "group-1", role: "MANAGER", status: "ACTIVE" },
      { tenantId: "tenant-1", groupId: "group-2", role: "RECRUITER", status: "ACTIVE" }
    ]
  });

  await assert.rejects(
    runtime.reconcileScimManagedRoles(tx, "tenant-1", ["user-1"]),
    new RegExp(runtime.SCIM_ROLE_MAPPING_AMBIGUOUS)
  );
  assert.equal(state[0].role, "EMPLOYEE");
  assert.equal(updates.length, 0);
});

test("directory mapping never overwrites a manually governed non-employee role", async () => {
  const { tx, state, updates } = fixture({
    users: [baseUser("user-1", "HRBP", false)],
    memberships: [{ tenantId: "tenant-1", userId: "user-1", groupId: "group-1" }],
    mappings: [{ tenantId: "tenant-1", groupId: "group-1", role: "MANAGER", status: "ACTIVE" }]
  });

  await assert.rejects(
    runtime.reconcileScimManagedRoles(tx, "tenant-1", ["user-1"]),
    new RegExp(runtime.SCIM_ROLE_MAPPING_MANUAL_CONFLICT)
  );
  assert.equal(state[0].role, "HRBP");
  assert.equal(updates.length, 0);
});

test("removing the last active mapping releases a managed role back to EMPLOYEE", async () => {
  const { tx, state } = fixture({
    users: [baseUser("user-1", "RECRUITER", true)],
    memberships: [{ tenantId: "tenant-1", userId: "user-1", groupId: "group-1" }],
    mappings: []
  });

  const result = await runtime.reconcileScimManagedRoles(tx, "tenant-1", ["user-1"]);
  assert.deepEqual(result, { changed: 1, managed: 0, released: 1 });
  assert.equal(state[0].role, "EMPLOYEE");
  assert.equal(state[0].roleManagedByScimGroup, false);
});
