import { IdentityProviderType } from "@prisma/client";

const MAX_METADATA_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export type IdentityValidationConnection = {
  type: IdentityProviderType;
  issuer: string | null;
  metadataUrl: string | null;
  clientId: string | null;
  directoryTenantId: string | null;
  secretRef: string | null;
};

export type IdentityValidationResult =
  | { ok: true; code: string; evidence: Record<string, string | number | boolean | null> }
  | { ok: false; code: string };

function safeHost(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::" || host === "::1" || host === "0.0.0.0") return false;
  if (/^127\./.test(host) || /^169\.254\./.test(host)) return false;
  if (host === "100.100.100.200" || host === "metadata.google.internal") return false;
  return true;
}

function secureUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !safeHost(url)) return null;
    return url;
  } catch {
    return null;
  }
}

function sameIssuer(left: string, right: string) {
  const normalize = (value: string) => value.replace(/\/+$/, "");
  return normalize(left) === normalize(right);
}

async function boundedFetch(
  url: URL,
  fetchImpl: typeof fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ response: Response; body: string }> {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json, application/xml, text/xml;q=0.9, */*;q=0.1" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("IDENTITY_REMOTE_HTTP_ERROR");

  const declared = Number(response.headers.get("content-length") || "0");
  if (declared && (!Number.isInteger(declared) || declared < 0 || declared > MAX_METADATA_BYTES)) {
    throw new Error("IDENTITY_REMOTE_RESPONSE_TOO_LARGE");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("IDENTITY_REMOTE_EMPTY_RESPONSE");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (!item.value?.length) continue;
      total += item.value.length;
      if (total > MAX_METADATA_BYTES) {
        await reader.cancel();
        throw new Error("IDENTITY_REMOTE_RESPONSE_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("IDENTITY_REMOTE_EMPTY_RESPONSE");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { response, body };
}

function jsonObject(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function validateOidc(
  connection: IdentityValidationConnection,
  fetchImpl: typeof fetch
): Promise<IdentityValidationResult> {
  const issuer = secureUrl(connection.issuer);
  if (!issuer) return { ok: false, code: "OIDC_ISSUER_INVALID" };

  const discovery = connection.metadataUrl
    ? secureUrl(connection.metadataUrl)
    : secureUrl(issuer.toString().replace(/\/+$/, "") + "/.well-known/openid-configuration");
  if (!discovery) return { ok: false, code: "OIDC_DISCOVERY_URL_INVALID" };

  let document: Record<string, unknown>;
  try {
    const { body } = await boundedFetch(discovery, fetchImpl);
    const parsed = jsonObject(body);
    if (!parsed) return { ok: false, code: "OIDC_DISCOVERY_JSON_INVALID" };
    document = parsed;
  } catch (error) {
    const code = error instanceof Error && /^IDENTITY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "OIDC_DISCOVERY_UNAVAILABLE";
    return { ok: false, code };
  }

  const remoteIssuer = typeof document.issuer === "string" ? document.issuer : null;
  const authorizationEndpoint = typeof document.authorization_endpoint === "string"
    ? secureUrl(document.authorization_endpoint)
    : null;
  const tokenEndpoint = typeof document.token_endpoint === "string"
    ? secureUrl(document.token_endpoint)
    : null;
  const jwksUri = typeof document.jwks_uri === "string" ? secureUrl(document.jwks_uri) : null;

  if (!remoteIssuer || !sameIssuer(remoteIssuer, issuer.toString())) {
    return { ok: false, code: "OIDC_ISSUER_MISMATCH" };
  }
  if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    return { ok: false, code: "OIDC_DISCOVERY_ENDPOINTS_INVALID" };
  }

  let keyCount = 0;
  try {
    const { body } = await boundedFetch(jwksUri, fetchImpl);
    const jwks = jsonObject(body);
    if (!jwks || !Array.isArray(jwks.keys)) return { ok: false, code: "OIDC_JWKS_INVALID" };
    const usable = jwks.keys.filter((key) =>
      key && typeof key === "object" && !Array.isArray(key) &&
      typeof (key as Record<string, unknown>).kty === "string"
    );
    if (!usable.length) return { ok: false, code: "OIDC_JWKS_EMPTY" };
    keyCount = usable.length;
  } catch (error) {
    const code = error instanceof Error && /^IDENTITY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "OIDC_JWKS_UNAVAILABLE";
    return { ok: false, code };
  }

  return {
    ok: true,
    code: "OIDC_LIVE_VALIDATED",
    evidence: {
      issuer: issuer.toString(),
      discoveryHost: discovery.hostname,
      jwksHost: jwksUri.hostname,
      jwksKeyCount: keyCount
    }
  };
}

async function validateSaml(
  connection: IdentityValidationConnection,
  fetchImpl: typeof fetch
): Promise<IdentityValidationResult> {
  const metadata = secureUrl(connection.metadataUrl);
  if (!metadata) return { ok: false, code: "SAML_METADATA_URL_INVALID" };

  let body: string;
  try {
    ({ body } = await boundedFetch(metadata, fetchImpl));
  } catch (error) {
    const code = error instanceof Error && /^IDENTITY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "SAML_METADATA_UNAVAILABLE";
    return { ok: false, code };
  }

  if (/<!DOCTYPE|<!ENTITY/i.test(body)) return { ok: false, code: "SAML_METADATA_UNSAFE_XML" };
  if (!/<(?:[A-Za-z0-9_-]+:)?(?:EntityDescriptor|EntitiesDescriptor)\b/.test(body)) {
    return { ok: false, code: "SAML_METADATA_ENTITY_MISSING" };
  }
  const sso = /<(?:[A-Za-z0-9_-]+:)?SingleSignOnService\b[^>]*\bLocation=(?:"([^"]+)"|'([^']+)')/i.exec(body);
  const location = secureUrl(sso?.[1] ?? sso?.[2] ?? null);
  if (!location) return { ok: false, code: "SAML_SSO_ENDPOINT_INVALID" };

  return {
    ok: true,
    code: "SAML_METADATA_LIVE_VALIDATED",
    evidence: {
      metadataHost: metadata.hostname,
      ssoHost: location.hostname
    }
  };
}

export async function validateIdentityProviderLive(
  connection: IdentityValidationConnection,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<IdentityValidationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  switch (connection.type) {
    case IdentityProviderType.ENTRA_ID:
    case IdentityProviderType.OKTA:
    case IdentityProviderType.OIDC:
      return validateOidc(connection, fetchImpl);
    case IdentityProviderType.SAML:
      return validateSaml(connection, fetchImpl);
    case IdentityProviderType.LDAP:
      return { ok: false, code: "LDAPS_LIVE_VALIDATION_AGENT_REQUIRED" };
    case IdentityProviderType.LOCAL:
      return { ok: true, code: "LOCAL_RUNTIME_MANAGED", evidence: { local: true } };
  }
}
