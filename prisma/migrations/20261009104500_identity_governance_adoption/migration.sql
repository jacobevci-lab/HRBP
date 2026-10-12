ALTER TABLE "Tenant"
ADD COLUMN "identityGovernanceAdoptedAt" TIMESTAMP(3);

-- Existing tenants that already activated a governed OIDC-family provider must
-- not regain legacy environment fallback merely because this marker was added
-- in a later release. Backfill from current ACTIVE state or immutable audit
-- evidence of a prior governed activation.
UPDATE "Tenant" AS tenant
SET "identityGovernanceAdoptedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "IdentityProviderConnection" AS provider
  WHERE provider."tenantId" = tenant."id"
    AND provider."type"::text IN ('ENTRA_ID', 'OKTA', 'OIDC')
    AND (
      provider."status"::text = 'ACTIVE'
      OR EXISTS (
        SELECT 1
        FROM "AuditEvent" AS audit
        WHERE audit."tenantId" = tenant."id"
          AND audit."resourceType" = 'IdentityProviderConnection'
          AND audit."resourceId" = provider."id"
          AND audit."action" = 'settings.identity-provider-activated'
      )
    )
);
