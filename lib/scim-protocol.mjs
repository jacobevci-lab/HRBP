export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function boundedText(value, max) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}
export function normalizeScimEmail(value) {
  const email = boundedText(value, 254)?.toLowerCase();
  if (!email || !/^[^\s@<>(),;:\\"]+@[^\s@<>(),;:\\"]+\.[^\s@<>(),;:\\"]+$/.test(email)) return null;
  return email;
}
export function normalizeScimDomain(value) {
  const domain = boundedText(value, 253)?.toLowerCase();
  if (!domain || domain.includes("..") || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return domain.replace(/^\.+|\.+$/g, "");
}
export function scimEmailAllowed(email, allowedDomains) {
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.includes(domain));
}
export function parseScimUserInput(body, current) {
  const userName = body.userName === undefined && current?.email ? current.email : normalizeScimEmail(body.userName);
  if (!userName) return null;
  let displayName = current?.displayName ?? null;
  if (body.displayName !== undefined) displayName = boundedText(body.displayName, 200);
  if (!displayName && body.name && typeof body.name === "object" && !Array.isArray(body.name)) {
    displayName = boundedText(body.name.formatted, 200);
  }
  if (!displayName) displayName = userName;
  const externalId = body.externalId === undefined
    ? current?.provisioningExternalId ?? null
    : body.externalId === null || body.externalId === "" ? null : boundedText(body.externalId, 191);
  if (body.externalId !== undefined && body.externalId !== null && body.externalId !== "" && !externalId) return null;
  const active = body.active === undefined ? current?.active ?? true : body.active;
  if (typeof active !== "boolean") return null;
  return { userName, displayName, externalId, active };
}
export function scimSubject(externalId, email) {
  return ("scim:" + (externalId || email)).slice(0, 191);
}
export function parseScimFilter(value) {
  if (!value) return { kind: "none" };
  const match = /^\s*(userName|externalId)\s+eq\s+"([^"]{1,254})"\s*$/i.exec(value);
  if (!match) return null;
  if (match[1].toLowerCase() === "username") {
    const email = normalizeScimEmail(match[2]);
    return email ? { kind: "userName", value: email } : null;
  }
  const externalId = boundedText(match[2], 191);
  return externalId ? { kind: "externalId", value: externalId } : null;
}
export function parsePagination(url) {
  const startRaw = url.searchParams.get("startIndex") ?? "1";
  const countRaw = url.searchParams.get("count") ?? "100";
  if (!/^\d+$/.test(startRaw) || !/^\d+$/.test(countRaw)) return null;
  const startIndex = Number(startRaw), count = Number(countRaw);
  if (!Number.isSafeInteger(startIndex) || startIndex < 1 || !Number.isSafeInteger(count) || count < 0 || count > 100) return null;
  return { startIndex, count };
}
export function validScimId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 191 && !/[\u0000-\u001f\u007f]/.test(value);
}
function patchValueObject(target, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    const normalized = key.toLowerCase();
    if (!["username","displayname","externalid","active"].includes(normalized)) continue;
    if (normalized === "username") target.userName = value[key];
    else if (normalized === "displayname") target.displayName = value[key];
    else if (normalized === "externalid") target.externalId = value[key];
    else target.active = value[key];
  }
  return true;
}
export function applyScimPatch(body, current) {
  if (body.schemas !== undefined && (!Array.isArray(body.schemas) || !body.schemas.includes(SCIM_PATCH_SCHEMA))) return null;
  const operations = body.Operations ?? body.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) return null;
  const next = { ...current };
  for (const raw of operations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const op = typeof raw.op === "string" ? raw.op.trim().toLowerCase() : "";
    if (!["add","replace","remove"].includes(op)) return null;
    const path = typeof raw.path === "string" ? raw.path.trim().toLowerCase() : "";
    if (!path) {
      if (op === "remove" || !patchValueObject(next, raw.value)) return null;
      continue;
    }
    if (!["username","displayname","externalid","active"].includes(path)) return null;
    if (op === "remove") {
      if (path !== "externalid") return null;
      next.externalId = null;
    } else if (path === "username") next.userName = raw.value;
    else if (path === "displayname") next.displayName = raw.value;
    else if (path === "externalid") next.externalId = raw.value;
    else next.active = raw.value;
  }
  return next;
}
export function scimUserProjection(user, baseUrl) {
  const created = user.provisionedAt ?? user.provisioningUpdatedAt ?? new Date(0);
  const modified = user.provisioningUpdatedAt ?? user.provisionedAt ?? created;
  let location;
  try { if (baseUrl) location = new URL("/api/scim/v2/Users/" + encodeURIComponent(user.id), baseUrl).toString(); } catch {}
  return {
    schemas: [SCIM_USER_SCHEMA], id: user.id,
    ...(user.provisioningExternalId ? { externalId: user.provisioningExternalId } : {}),
    userName: user.email ?? "", displayName: user.displayName, active: user.active,
    meta: { resourceType: "User", created: created.toISOString(), lastModified: modified.toISOString(), ...(location ? { location } : {}) }
  };
}
export function scimUserResourceType(baseUrl) {
  let location;
  try { if (baseUrl) location = new URL("/api/scim/v2/ResourceTypes/User", baseUrl).toString(); } catch {}
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User",
    endpoint: "/Users", schema: SCIM_USER_SCHEMA, schemaExtensions: [],
    meta: { resourceType: "ResourceType", ...(location ? { location } : {}) }
  };
}
export function scimUserSchemaDefinition() {
  return {
    id: SCIM_USER_SCHEMA, name: "User", description: "HRBP tenant application user",
    attributes: [
      { name:"userName", type:"string", multiValued:false, required:true, caseExact:false, mutability:"readWrite", returned:"default", uniqueness:"server" },
      { name:"displayName", type:"string", multiValued:false, required:false, caseExact:false, mutability:"readWrite", returned:"default", uniqueness:"none" },
      { name:"externalId", type:"string", multiValued:false, required:false, caseExact:true, mutability:"readWrite", returned:"default", uniqueness:"server" },
      { name:"active", type:"boolean", multiValued:false, required:false, mutability:"readWrite", returned:"default" }
    ], meta: { resourceType: "Schema" }
  };
}
