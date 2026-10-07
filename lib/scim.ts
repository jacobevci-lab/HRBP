import { PlatformRole, type UserAccount } from "@prisma/client";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runtimeBoolean, runtimeString } from "@/lib/runtime-env";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export type ScimUserInput = {
  userName: string;
  displayName: string;
  externalId: string | null;
  active: boolean;
};

export function scimRuntimeConfig() {
  const enabled = runtimeBoolean("HRBP_SCIM_ENABLED", false);
  const tenantId = runtimeString("HRBP_AUTH_TENANT_ID") ?? "";
  const baseUrl = runtimeString("APP_URL") ?? "";
  const allowedDomains = (runtimeString("HRBP_ALLOWED_EMAIL_DOMAINS") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))
    .slice(0, 50);
  return {
    enabled,
    tenantId,
    baseUrl,
    allowedDomains,
    configured: enabled &&
      /^[A-Za-z0-9._-]{3,64}$/.test(tenantId) &&
      allowedDomains.length > 0 &&
      Boolean(runtimeString("HRBP_SCIM_TOKEN"))
  };
}

export function scimAuthorized(request: Request) {
  const config = scimRuntimeConfig();
  return config.configured && internalBearerAuthorized(request, "HRBP_SCIM_TOKEN");
}

export function scimHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/scim+json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return headers;
}

export function scimJson(body: unknown, status = 200, extra?: HeadersInit) {
  return Response.json(body, { status, headers: scimHeaders(extra) });
}

export function scimError(status: number, detail: string, scimType?: string) {
  return scimJson({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail
  }, status);
}

export async function readScimObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body) return null;
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/scim+json" && contentType !== "application/json") return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let source = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        await reader.cancel();
        return null;
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function boundedText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function normalizeScimEmail(value: unknown) {
  const email = boundedText(value, 254)?.toLowerCase();
  if (!email || !/^[^\s@<>(),;:\\"]+@[^\s@<>(),;:\\"]+\.[^\s@<>(),;:\\"]+$/.test(email)) return null;
  return email;
}

export function scimEmailAllowed(email: string, allowedDomains: string[]) {
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.includes(domain));
}

export function parseScimUserInput(body: Record<string, unknown>, current?: {
  email: string | null;
  displayName: string;
  active: boolean;
  provisioningExternalId: string | null;
}): ScimUserInput | null {
  const userName = body.userName === undefined && current?.email
    ? current.email
    : normalizeScimEmail(body.userName);
  if (!userName) return null;

  let displayName: string | null = current?.displayName ?? null;
  if (body.displayName !== undefined) displayName = boundedText(body.displayName, 200);
  if (!displayName && body.name && typeof body.name === "object" && !Array.isArray(body.name)) {
    displayName = boundedText((body.name as Record<string, unknown>).formatted, 200);
  }
  if (!displayName) displayName = userName;

  const externalId = body.externalId === undefined
    ? current?.provisioningExternalId ?? null
    : body.externalId === null || body.externalId === ""
      ? null
      : boundedText(body.externalId, 191);
  if (body.externalId !== undefined && body.externalId !== null && body.externalId !== "" && !externalId) return null;

  const active = body.active === undefined ? current?.active ?? true : body.active;
  if (typeof active !== "boolean") return null;

  return { userName, displayName, externalId, active };
}

export function scimUserProjection(
  user: Pick<UserAccount,
    "id" | "email" | "displayName" | "active" | "provisioningExternalId" |
    "provisionedAt" | "provisioningUpdatedAt">,
  baseUrl: string
) {
  const created = user.provisionedAt ?? user.provisioningUpdatedAt ?? new Date(0);
  const modified = user.provisioningUpdatedAt ?? user.provisionedAt ?? created;
  const location = baseUrl
    ? new URL("/api/scim/v2/Users/" + encodeURIComponent(user.id), baseUrl).toString()
    : undefined;

  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    ...(user.provisioningExternalId ? { externalId: user.provisioningExternalId } : {}),
    userName: user.email ?? "",
    displayName: user.displayName,
    active: user.active,
    meta: {
      resourceType: "User",
      created: created.toISOString(),
      lastModified: modified.toISOString(),
      ...(location ? { location } : {})
    }
  };
}

export function defaultScimRole() {
  return PlatformRole.EMPLOYEE;
}

export function scimSubject(externalId: string | null, email: string) {
  return ("scim:" + (externalId || email)).slice(0, 191);
}

export function parseScimFilter(value: string | null) {
  if (!value) return { kind: "none" as const };
  const match = /^\s*(userName|externalId)\s+eq\s+"([^"]{1,254})"\s*$/i.exec(value);
  if (!match) return null;
  if (match[1].toLowerCase() === "username") {
    const email = normalizeScimEmail(match[2]);
    return email ? { kind: "userName" as const, value: email } : null;
  }
  const externalId = boundedText(match[2], 191);
  return externalId ? { kind: "externalId" as const, value: externalId } : null;
}

export function parsePagination(url: URL) {
  const startRaw = url.searchParams.get("startIndex") ?? "1";
  const countRaw = url.searchParams.get("count") ?? "100";
  if (!/^\d+$/.test(startRaw) || !/^\d+$/.test(countRaw)) return null;
  const startIndex = Number(startRaw);
  const count = Number(countRaw);
  if (!Number.isSafeInteger(startIndex) || startIndex < 1 ||
      !Number.isSafeInteger(count) || count < 0 || count > 100) return null;
  return { startIndex, count };
}

export function provisioningSelect() {
  return {
    id: true,
    email: true,
    displayName: true,
    active: true,
    provisioningExternalId: true,
    provisionedAt: true,
    provisioningUpdatedAt: true
  } as const;
}
