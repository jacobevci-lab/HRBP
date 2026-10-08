CREATE TABLE "ScimGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimGroupMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScimGroup_tenantId_externalId_key"
ON "ScimGroup"("tenantId", "externalId");

CREATE INDEX "ScimGroup_tenantId_displayName_idx"
ON "ScimGroup"("tenantId", "displayName");

CREATE INDEX "ScimGroup_tenantId_updatedAt_idx"
ON "ScimGroup"("tenantId", "updatedAt");

CREATE UNIQUE INDEX "ScimGroupMember_groupId_userId_key"
ON "ScimGroupMember"("groupId", "userId");

CREATE INDEX "ScimGroupMember_tenantId_userId_idx"
ON "ScimGroupMember"("tenantId", "userId");

CREATE INDEX "ScimGroupMember_tenantId_groupId_idx"
ON "ScimGroupMember"("tenantId", "groupId");

ALTER TABLE "ScimGroup"
ADD CONSTRAINT "ScimGroup_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScimGroupMember"
ADD CONSTRAINT "ScimGroupMember_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScimGroupMember"
ADD CONSTRAINT "ScimGroupMember_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScimGroupMember"
ADD CONSTRAINT "ScimGroupMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
