import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { OidcConfig } from "@/lib/auth-config";

export type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
};

const metadataCache = new Map<string, Promise<OidcMetadata>>();
const OIDC_DISCOVERY_MAX_BYTES = 128 * 1024;
const OIDC_DISCOVERY_TIMEOUT_MS = 5000;

function normalizedOidcUrl(value: string, httpsRequired = false) {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (httpsRequired && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizedIssuer(value: string) {
  const parsed = normalizedOidcUrl(value);
  if (!parsed || parsed.search) return null;
  return parsed.toString().replace(/\/$/, "");
}

async function boundedJsonObject(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > OIDC_DISCOVERY_MAX_BYTES) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("OIDC discovery response is too large.");
  }
  if (!response.body) throw new Error("OIDC discovery response body is missing.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let source = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > OIDC_DISCOVERY_MAX_BYTES) {
        await reader.cancel();
        throw new Error("OIDC discovery response is too large.");
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OIDC provider metadata must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("OIDC ")) throw error;
    throw new Error("OIDC provider metadata is not valid JSON.");
  } finally {
    reader.releaseLock();
  }
}

function validatedOidcMetadata(expectedIssuer: string, value: Record<string, unknown>): OidcMetadata {
  const issuer = typeof value.issuer === "string" ? normalizedIssuer(value.issuer) : null;
  if (!issuer || issuer !== expectedIssuer) throw new Error("OIDC provider issuer does not match configured issuer.");

  const httpsRequired = expectedIssuer.startsWith("https://");
  const authorization = typeof value.authorization_endpoint === "string"
    ? normalizedOidcUrl(value.authorization_endpoint, httpsRequired)
    : null;
  const token = typeof value.token_endpoint === "string"
    ? normalizedOidcUrl(value.token_endpoint, httpsRequired)
    : null;
  const jwks = typeof value.jwks_uri === "string"
    ? normalizedOidcUrl(value.jwks_uri, httpsRequired)
    : null;
  if (!authorization || !token || !jwks) {
    throw new Error("OIDC provider metadata contains an invalid or insecure endpoint.");
  }

  let endSession: URL | null = null;
  if (typeof value.end_session_endpoint === "string") {
    endSession = normalizedOidcUrl(value.end_session_endpoint, httpsRequired);
    if (!endSession) throw new Error("OIDC provider metadata contains an invalid end-session endpoint.");
  }

  return {
    issuer,
    authorization_endpoint: authorization.toString(),
    token_endpoint: token.toString(),
    jwks_uri: jwks.toString(),
    ...(endSession ? { end_session_endpoint: endSession.toString() } : {})
  };
}

export function discoverOidc(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcMetadata> {
  const normalized = normalizedIssuer(issuer);
  if (!normalized) return Promise.reject(new Error("OIDC issuer must be a valid HTTP(S) URL without query or fragment."));

  const cached = metadataCache.get(normalized);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetchImpl(`${normalized}/.well-known/openid-configuration`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(OIDC_DISCOVERY_TIMEOUT_MS)
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      throw new Error(`OIDC discovery failed with HTTP ${response.status}.`);
    }
    return validatedOidcMetadata(normalized, await boundedJsonObject(response));
  })();

  metadataCache.set(normalized, promise);
  promise.catch(() => {
    if (metadataCache.get(normalized) === promise) metadataCache.delete(normalized);
  });
  return promise;
}

export async function exchangeAuthorizationCode({
  config,
  metadata,
  code,
  verifier,
  redirectUri
}: {
  config: OidcConfig;
  metadata: OidcMetadata;
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    cache: "no-store"
  });
  const value = await response.json() as { id_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !value.id_token) {
    throw new Error(value.error_description || value.error || `OIDC token exchange failed with HTTP ${response.status}.`);
  }
  return value;
}

export async function verifyIdToken({
  config,
  metadata,
  idToken,
  nonce
}: {
  config: OidcConfig;
  metadata: OidcMetadata;
  idToken: string;
  nonce: string;
}): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: metadata.issuer,
    audience: config.clientId
  });
  if (!payload.sub) throw new Error("OIDC identity token does not contain a subject claim.");
  if (payload.nonce !== nonce) throw new Error("OIDC nonce validation failed.");
  return payload;
}
