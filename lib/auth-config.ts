import { runtimeBoolean, runtimeString } from "@/lib/runtime-env";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  tenantId: string;
  bootstrapAdminEmail?: string;
  allowedEmailDomains: string[];
  jitProvisioning: boolean;
  redirectUri?: string;
};

export function getOidcConfig(): OidcConfig | null {
  const issuer = runtimeString("HRBP_OIDC_ISSUER")?.replace(/\/$/, "");
  const clientId = runtimeString("HRBP_OIDC_CLIENT_ID");
  const tenantId = runtimeString("HRBP_AUTH_TENANT_ID");
  const sessionSecret = runtimeString("HRBP_SESSION_SECRET");

  if (!issuer || !clientId || !tenantId || !sessionSecret || sessionSecret.length < 32) return null;

  return {
    issuer,
    clientId,
    clientSecret: runtimeString("HRBP_OIDC_CLIENT_SECRET"),
    scopes: runtimeString("HRBP_OIDC_SCOPES") || "openid profile email",
    tenantId,
    bootstrapAdminEmail: runtimeString("HRBP_BOOTSTRAP_ADMIN_EMAIL")?.toLowerCase(),
    allowedEmailDomains: (runtimeString("HRBP_ALLOWED_EMAIL_DOMAINS") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    jitProvisioning: runtimeBoolean("HRBP_OIDC_JIT_PROVISIONING", false),
    redirectUri: runtimeString("HRBP_OIDC_REDIRECT_URI")
  };
}

export function authConfigurationStatus() {
  const missing: string[] = [];
  if (!runtimeString("HRBP_OIDC_ISSUER")) missing.push("HRBP_OIDC_ISSUER");
  if (!runtimeString("HRBP_OIDC_CLIENT_ID")) missing.push("HRBP_OIDC_CLIENT_ID");
  if (!runtimeString("HRBP_AUTH_TENANT_ID")) missing.push("HRBP_AUTH_TENANT_ID");
  const secret = runtimeString("HRBP_SESSION_SECRET");
  if (!secret || secret.length < 32) missing.push("HRBP_SESSION_SECRET (32+ chars)");
  return { configured: missing.length === 0, missing };
}
