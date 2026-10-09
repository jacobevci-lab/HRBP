CREATE TYPE "ScimRoleMappingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

ALTER TABLE "UserAccount"
ADD COLUMN "roleManagedByScimGroup" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ScimGroupRoleMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "ScimRoleMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "disabledById" TEXT,
    "disabledAt" TIMESTAMP(3),
    "attestation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroupRoleMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScimGroupRoleMapping_groupId_key"
ON "ScimGroupRoleMapping"("groupId");

CREATE INDEX "ScimGroupRoleMapping_tenantId_status_role_idx"
ON "ScimGroupRoleMapping"("tenantId", "status", "role");

CREATE INDEX "ScimGroupRoleMapping_tenantId_updatedAt_idx"
ON "ScimGroupRoleMapping"("tenantId", "updatedAt");

ALTER TABLE "ScimGroupRoleMapping"
ADD CONSTRAINT "ScimGroupRoleMapping_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScimGroupRoleMapping"
ADD CONSTRAINT "ScimGroupRoleMapping_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
