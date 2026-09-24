import { IdentityProviderType } from "@prisma/client";
import { asOptionalText } from "@/lib/input-validation";

export function optionalEndpoint(value: unknown, protocols: string[], maxLength = 1024): string | null | undefined {
  const parsed = asOptionalText(value, maxLength);
  if (parsed === undefined || parsed === null) return parsed;
  try {
    const url = new URL(parsed);
    return protocols.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function identityIssuer(value: unknown, type: IdentityProviderType) {
  return type === IdentityProviderType.LDAP
    ? optionalEndpoint(value, ["ldap:", "ldaps:"])
    : optionalEndpoint(value, ["https:", "http:"]);
}

export function identityMetadataUrl(value: unknown) {
  return optionalEndpoint(value, ["https:", "http:"]);
}

type IdentityActivationShape = {
  type: IdentityProviderType;
  issuer: string | null;
  clientId: string | null;
  metadataUrl: string | null;
  directoryTenantId: string | null;
  secretRef: string | null;
};

export function identityActivationIssues(connection: IdentityActivationShape) {
  const issues: string[] = [];
  switch (connection.type) {
    case IdentityProviderType.ENTRA_ID:
      if (!connection.issuer) issues.push("issuer");
      if (!connection.clientId) issues.push("clientId");
      if (!connection.directoryTenantId) issues.push("directoryTenantId");
      if (!connection.secretRef) issues.push("secretRef");
      break;
    case IdentityProviderType.OKTA:
    case IdentityProviderType.OIDC:
      if (!connection.issuer) issues.push("issuer");
      if (!connection.clientId) issues.push("clientId");
      if (!connection.secretRef) issues.push("secretRef");
      break;
    case IdentityProviderType.SAML:
      if (!connection.metadataUrl) issues.push("metadataUrl");
      break;
    case IdentityProviderType.LDAP:
      if (!connection.issuer) issues.push("ldapEndpoint");
      if (!connection.secretRef) issues.push("secretRef");
      break;
    case IdentityProviderType.LOCAL:
      break;
  }
  return issues;
}

type IntegrationActivationShape = {
  baseUrl: string | null;
  authType: string;
  secretRef: string | null;
};

export function integrationActivationIssues(connection: IntegrationActivationShape) {
  const issues: string[] = [];
  if (!connection.baseUrl) issues.push("baseUrl");
  const authType = connection.authType.trim().toUpperCase();
  if (!authType) issues.push("authType");
  if (!["NONE", "ANONYMOUS", "NO_AUTH"].includes(authType) && !connection.secretRef) issues.push("secretRef");
  return issues;
}
