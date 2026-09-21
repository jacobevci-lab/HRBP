import { getOidcConfig } from "@/lib/auth-config";
import { createOidcTransactionCookie, pkceChallenge, randomToken, sanitizeReturnTo } from "@/lib/auth-session";
import { discoverOidc } from "@/lib/oidc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getOidcConfig();
  const origin = new URL(request.url).origin;
  if (!config) return Response.redirect(`${origin}/auth/sign-in?error=configuration`, 302);

  try {
    const metadata = await discoverOidc(config.issuer);
    const requestUrl = new URL(request.url);
    const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    const redirectUri = config.redirectUri || `${origin}/api/auth/callback`;

    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", config.scopes);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    const headers = new Headers({
      location: authorizationUrl.toString(),
      "cache-control": "no-store"
    });
    headers.append("set-cookie", createOidcTransactionCookie({ state, nonce, verifier, returnTo }));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("OIDC login initialization failed", error);
    return Response.redirect(`${origin}/auth/sign-in?error=provider`, 302);
  }
}
