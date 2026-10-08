import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIM_GROUP_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  applyScimGroupPatch,
  applyScimPatch,
  normalizeScimDomain,
  normalizeScimEmail,
  parsePagination,
  parseScimFilter,
  parseScimGroupFilter,
  parseScimGroupInput,
  parseScimGroupMembers,
  parseScimUserInput,
  scimEmailAllowed,
  scimGroupProjection,
  scimGroupResourceType,
  scimGroupSchemaDefinition,
  scimSubject,
  scimUserProjection,
  scimUserResourceType,
  scimUserSchemaDefinition,
  validScimId
} from "../lib/scim-protocol.mjs";

test("normalizes bounded tenant SCIM identities", () => {
  assert.equal(normalizeScimEmail(" User@Example.COM "), "user@example.com");
  assert.equal(normalizeScimEmail("bad"), null);
  assert.equal(normalizeScimDomain("Example.COM"), "example.com");
  assert.equal(normalizeScimDomain("bad..example.com"), null);
  assert.equal(normalizeScimDomain("-bad.example.com"), null);
  assert.equal(normalizeScimDomain("bad-.example.com"), null);
  assert.equal(normalizeScimDomain(".example.com"), null);
  assert.equal(scimEmailAllowed("user@example.com", ["example.com"]), true);
  assert.equal(scimEmailAllowed("user@sub.example.com", ["example.com"]), false);
  assert.equal(scimSubject("ext-1", "user@example.com"), "scim:ext-1");
});

test("parses only bounded SCIM user and list inputs", () => {
  assert.deepEqual(parseScimUserInput({
    userName: "Person@Example.com",
    displayName: "Person Example",
    externalId: "external-1",
    active: true
  }), {
    userName: "person@example.com",
    displayName: "Person Example",
    externalId: "external-1",
    active: true
  });
  assert.equal(parseScimUserInput({ userName: "invalid", active: true }), null);
  assert.deepEqual(parseScimFilter('userName eq "Person@Example.com"'), {
    kind: "userName",
    value: "person@example.com"
  });
  assert.deepEqual(parseScimFilter('externalId eq "external-1"'), {
    kind: "externalId",
    value: "external-1"
  });
  assert.equal(parseScimFilter('displayName eq "Person"'), null);

  assert.deepEqual(parsePagination(new URL("https://example.test/Users?startIndex=2&count=50")), {
    startIndex: 2,
    count: 50
  });
  assert.equal(parsePagination(new URL("https://example.test/Users?startIndex=0&count=101")), null);
  assert.equal(validScimId("abc123"), true);
  assert.equal(validScimId("bad\nvalue"), false);
});

test("SCIM PatchOp is allowlisted and cannot mutate privileged attributes", () => {
  const current = {
    userName: "user@example.com",
    displayName: "User",
    externalId: "ext-1",
    active: true
  };
  assert.deepEqual(applyScimPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [
      { op: "Replace", path: "active", value: false },
      { op: "replace", path: "displayName", value: "Updated User" },
      { op: "remove", path: "externalId" }
    ]
  }, current), {
    userName: "user@example.com",
    displayName: "Updated User",
    externalId: null,
    active: false
  });
  assert.equal(applyScimPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [{ op: "replace", path: "role", value: "TENANT_ADMIN" }]
  }, current), null);
  assert.equal(applyScimPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [{ op: "replace", value: { role: "TENANT_ADMIN" } }]
  }, current), null, "pathless privileged attributes must be rejected");
  assert.equal(applyScimPatch({
    schemas: ["wrong"],
    Operations: [{ op: "replace", path: "active", value: false }]
  }, current), null);
});

test("SCIM projections expose bounded protocol metadata only", () => {
  const created = new Date("2026-10-08T00:00:00.000Z");
  const projection = scimUserProjection({
    id: "user-1",
    email: "user@example.com",
    displayName: "User",
    active: true,
    provisioningExternalId: "ext-1",
    provisionedAt: created,
    provisioningUpdatedAt: created
  }, "https://hrbp.example.com");
  assert.deepEqual(projection.schemas, [SCIM_USER_SCHEMA]);
  assert.equal(projection.userName, "user@example.com");
  assert.equal(projection.meta.location, "https://hrbp.example.com/api/scim/v2/Users/user-1");
  assert.ok(!JSON.stringify(projection).includes("password"));
  assert.equal(scimUserResourceType("https://hrbp.example.com").endpoint, "/Users");
  assert.equal(scimUserSchemaDefinition().id, SCIM_USER_SCHEMA);
});


test("SCIM Group inputs and filters are bounded", () => {
  assert.deepEqual(parseScimGroupMembers([
    { value: "user-1" },
    { value: "user-2" },
    { value: "user-1" }
  ]), ["user-1", "user-2"]);
  assert.equal(parseScimGroupMembers([{ value: "bad\nvalue" }]), null);
  assert.deepEqual(parseScimGroupInput({
    displayName: "HR Business Partners",
    externalId: "group-ext-1",
    members: [{ value: "user-1" }, { value: "user-2" }]
  }), {
    displayName: "HR Business Partners",
    externalId: "group-ext-1",
    members: ["user-1", "user-2"]
  });
  assert.deepEqual(parseScimGroupFilter('displayName eq "HR Business Partners"'), {
    kind: "displayName",
    value: "HR Business Partners"
  });
  assert.deepEqual(parseScimGroupFilter('externalId eq "group-ext-1"'), {
    kind: "externalId",
    value: "group-ext-1"
  });
  assert.equal(parseScimGroupFilter('members eq "user-1"'), null);
});

test("SCIM Group PatchOp supports membership delta without privileged attributes", () => {
  const current = {
    displayName: "HRBP",
    externalId: "group-ext-1",
    members: ["user-1", "user-2"]
  };

  assert.deepEqual(applyScimGroupPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [
      { op: "Add", path: "members", value: [{ value: "user-3" }] },
      { op: "Remove", path: 'members[value eq "user-1"]' },
      { op: "Replace", path: "displayName", value: "HR Business Partners" }
    ]
  }, current), {
    displayName: "HR Business Partners",
    externalId: "group-ext-1",
    members: ["user-2", "user-3"]
  });

  assert.deepEqual(applyScimGroupPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [
      { op: "Remove", path: "members", value: [{ value: "user-1" }] }
    ]
  }, current), {
    displayName: "HRBP",
    externalId: "group-ext-1",
    members: ["user-2"]
  }, "value-scoped member removal must preserve unrelated members");

  assert.equal(applyScimGroupPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [{ op: "replace", path: "role", value: "TENANT_ADMIN" }]
  }, current), null);

  assert.equal(applyScimGroupPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [{ op: "add", path: "members", value: [{ value: "bad\nmember" }] }]
  }, current), null);
});

test("SCIM Group projections expose directory membership without authorization state", () => {
  const created = new Date("2026-10-08T20:00:00.000Z");
  const projection = scimGroupProjection({
    id: "group-1",
    externalId: "ext-group-1",
    displayName: "HR Business Partners",
    createdAt: created,
    updatedAt: created
  }, [
    { id: "user-1", displayName: "User One" },
    { id: "user-2", displayName: "User Two" }
  ], "https://hrbp.example.com");

  assert.deepEqual(projection.schemas, [SCIM_GROUP_SCHEMA]);
  assert.equal(projection.displayName, "HR Business Partners");
  assert.equal(projection.members[0].value, "user-1");
  assert.equal(projection.members[0].$ref, "https://hrbp.example.com/api/scim/v2/Users/user-1");
  assert.equal(projection.meta.location, "https://hrbp.example.com/api/scim/v2/Groups/group-1");
  assert.ok(!JSON.stringify(projection).includes("role"));
  assert.equal(scimGroupResourceType("https://hrbp.example.com").endpoint, "/Groups");
  assert.equal(scimGroupSchemaDefinition().id, SCIM_GROUP_SCHEMA);
});
