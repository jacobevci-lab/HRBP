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

export function discoverOidc(issuer: string): Promise<OidcMetadata> {
  const cached = metadataCache.get(issuer);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, {
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}.`);
    const metadata = await response.json() as Partial<OidcMetadata>;
    if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
      throw new Error("OIDC provider metadata is incomplete.");
    }
    return metadata as OidcMetadata;
  })();

  metadataCache.set(issuer, promise);
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
