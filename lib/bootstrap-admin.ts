import { DataClassification, PlatformRole, Prisma, type PrismaClient } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { lockIdentityProviderTenant } from "@/lib/identity-provider-lifecycle";

type BootstrapClient = PrismaClient;

export type BootstrapAdminInput = {
  tenantId: string;
  subject: string;
  email: string;
  displayName: string;
};

/**
 * Bootstrap administration is an installation-only escape hatch.
 *
 * It is allowed only before the tenant adopts governed OIDC and only while no
 * active tenant administrator exists. The tenant-scoped advisory lock makes
 * concurrent first-login attempts converge on at most one bootstrap admin.
 */
export async function provisionBootstrapAdmin(client: BootstrapClient, input: BootstrapAdminInput) {
  return client.$transaction(async (tx) => {
    await lockIdentityProviderTenant(tx, input.tenantId);

    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, identityGovernanceAdoptedAt: true }
    });
    if (!tenant) return { user: null, created: false, closed: true as const, reason: "TENANT_NOT_FOUND" as const };

    const existing = await tx.userAccount.findFirst({
      where: {
        tenantId: input.tenantId,
        OR: [
          { subject: input.subject },
          { email: { equals: input.email, mode: "insensitive" } }
        ]
      }
    });
    if (existing) return { user: existing, created: false, closed: false as const };

    if (tenant.identityGovernanceAdoptedAt) {
      return { user: null, created: false, closed: true as const, reason: "GOVERNANCE_ADOPTED" as const };
    }

    const activeAdminCount = await tx.userAccount.count({
      where: {
        tenantId: input.tenantId,
        active: true,
        role: PlatformRole.TENANT_ADMIN
      }
    });
    if (activeAdminCount > 0) {
      return { user: null, created: false, closed: true as const, reason: "ADMIN_EXISTS" as const };
    }

    const created = await tx.userAccount.create({
      data: {
        tenantId: input.tenantId,
        subject: input.subject,
        displayName: input.displayName,
        email: input.email,
        role: PlatformRole.TENANT_ADMIN,
        active: true
      }
    });

    await appendSystemAudit(tx, input.tenantId, "system:oidc-bootstrap", {
      action: "auth.bootstrap-admin-provisioned",
      resourceType: "UserAccount",
      resourceId: created.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Initial tenant administrator provisioned through one-time OIDC bootstrap"
    });

    return { user: created, created: true, closed: false as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
