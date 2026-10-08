import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  applyScimPatch,
  normalizeScimDomain,
  normalizeScimEmail,
  parsePagination,
  parseScimFilter,
  parseScimUserInput,
  scimEmailAllowed,
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
