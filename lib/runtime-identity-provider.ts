import { ConnectionStatus, IdentityProviderType, type Prisma, type PrismaClient } from "@prisma/client";
import { authenticationAssuranceConfiguration } from "@/lib/auth-assurance";
import { getOidcConfig, localAuthConfigurationStatus, type OidcConfig } from "@/lib/auth-config";
import { scimRuntimeConfig } from "@/lib/scim";

export const oidcRuntimeProviderTypes = [
  IdentityProviderType.ENTRA_ID,
  IdentityProviderType.OKTA,
  IdentityProviderType.OIDC
] as const;

type OidcRuntimeProviderType = typeof oidcRuntimeProviderTypes[number];
type ScopeClient = PrismaClient | Prisma.TransactionClient;

type IdentityRuntimeShape = {
  type: IdentityProviderType;
  issuer: string | null;
  clientId: string | null;
  jitEnabled: boolean;
  mfaRequired: boolean;
  scimEnabled: boolean;
};

function normalizedIssuer(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isOidcRuntimeProvider(type: IdentityProviderType): type is OidcRuntimeProviderType {
  return (oidcRuntimeProviderTypes as readonly IdentityProviderType[]).includes(type);
}

export function identityRuntimeActivationIssues(connection: IdentityRuntimeShape) {
  const issues: string[] = [];

  if (isOidcRuntimeProvider(connection.type)) {
    const runtime = getOidcConfig();
    if (!runtime) {
      issues.push("runtime OIDC configuration");
      return issues;
    }
    if (normalizedIssuer(connection.issuer) !== normalizedIssuer(runtime.issuer)) {
      issues.push("runtime issuer match");
    }
    if (!connection.clientId || connection.clientId !== runtime.clientId) {
      issues.push("runtime clientId match");
    }
    if (connection.jitEnabled && runtime.allowedEmailDomains.length === 0) {
      issues.push("JIT allowed email domains");
    }
    if (connection.mfaRequired && !authenticationAssuranceConfiguration().mfaConfigured) {
      issues.push("OIDC MFA claim/value mapping");
    }
    if (connection.scimEnabled && !scimRuntimeConfig().configured) {
      issues.push("SCIM runtime configuration");
    }
    return issues;
  }

  if (connection.type === IdentityProviderType.LOCAL) {
    if (connection.scimEnabled) issues.push("SCIM requires federated identity provider");
    if (!localAuthConfigurationStatus().configured) issues.push("local authentication runtime");
    return issues;
  }

  if (connection.type === IdentityProviderType.SAML) {
    issues.push("SAML login runtime adapter");
    return issues;
  }

  if (connection.type === IdentityProviderType.LDAP) {
    issues.push("LDAP login runtime adapter");
  }

  return issues;
}

/**
 * Database identity-provider records are governance state. Once an OIDC-family
 * provider is ACTIVE, the runtime login path is bound to exactly that provider.
 *
 * Managed provider flags become authentication policy: JIT is taken from the
 * ACTIVE provider record and provider-level MFA requires signed token assurance.
 * Legacy deployments keep environment-driven JIT behavior only until the
 * tenant explicitly adopts a governed OIDC runtime. After adoption, removing
 * the last ACTIVE provider fails closed instead of silently restoring legacy
 * environment authentication.
 */
export async function enforceOidcRuntimeBinding(client: ScopeClient, config: OidcConfig) {
  const active = await client.identityProviderConnection.findMany({
    where: {
      tenantId: config.tenantId,
      status: ConnectionStatus.ACTIVE,
      type: { in: [...oidcRuntimeProviderTypes] }
    },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: {
      id: true,
      type: true,
      issuer: true,
      clientId: true,
      jitEnabled: true,
      mfaRequired: true,
      scimEnabled: true,
      updatedAt: true
    }
  });

  if (active.length === 0) {
    const tenant = await client.tenant.findUnique({
      where: { id: config.tenantId },
      select: { identityGovernanceAdoptedAt: true }
    });
    if (tenant?.identityGovernanceAdoptedAt) throw new Error("IDENTITY_PROVIDER_INACTIVE");
    return { managed: false as const };
  }
  if (active.length !== 1) throw new Error("IDENTITY_PROVIDER_AMBIGUOUS");

  const connection = active[0];
  if (
    normalizedIssuer(connection.issuer) !== normalizedIssuer(config.issuer) ||
    !connection.clientId ||
    connection.clientId !== config.clientId
  ) {
    throw new Error("IDENTITY_PROVIDER_DRIFT");
  }

  return {
    managed: true as const,
    connectionId: connection.id,
    type: connection.type,
    jitEnabled: connection.jitEnabled,
    mfaRequired: connection.mfaRequired,
    scimEnabled: connection.scimEnabled,
    bindingVersion: connection.updatedAt.getTime()
  };
}
