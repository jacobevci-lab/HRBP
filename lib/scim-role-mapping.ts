import {
  PlatformRole,
  ScimRoleMappingStatus,
  type Prisma,
  type PrismaClient
} from "@prisma/client";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

export const scimDirectoryAssignableRoles = [
  PlatformRole.EMPLOYEE,
  PlatformRole.MANAGER,
  PlatformRole.HRBP,
  PlatformRole.RECRUITER
] as const;

export type ScimDirectoryAssignableRole = typeof scimDirectoryAssignableRoles[number];

export const SCIM_ROLE_MAPPING_AMBIGUOUS = "SCIM_ROLE_MAPPING_AMBIGUOUS";
export const SCIM_ROLE_MAPPING_MANUAL_CONFLICT = "SCIM_ROLE_MAPPING_MANUAL_CONFLICT";

export function isScimDirectoryAssignableRole(value: unknown): value is ScimDirectoryAssignableRole {
  return typeof value === "string" &&
    (scimDirectoryAssignableRoles as readonly string[]).includes(value);
}

type UserRoleState = {
  id: string;
  displayName: string;
  role: PlatformRole;
  roleManagedByScimGroup: boolean;
};

type Proposal = {
  groupId: string;
  role: ScimDirectoryAssignableRole;
};

async function resolvedRoleState(
  client: ScopeClient,
  tenantId: string,
  userIds: string[],
  proposal?: Proposal
) {
  const uniqueUserIds = [...new Set(userIds)];
  if (!uniqueUserIds.length) return {
    users: [] as UserRoleState[],
    rolesByUser: new Map<string, Set<PlatformRole>>()
  };

  const [users, memberships] = await Promise.all([
    client.userAccount.findMany({
      where: {
        tenantId,
        provisioningSource: "SCIM",
        id: { in: uniqueUserIds }
      },
      select: {
        id: true,
        displayName: true,
        role: true,
        roleManagedByScimGroup: true
      }
    }),
    client.scimGroupMember.findMany({
      where: { tenantId, userId: { in: uniqueUserIds } },
      select: { userId: true, groupId: true }
    })
  ]);

  const groupIds = [...new Set(memberships.map((row) => row.groupId))];
  const activeMappings = groupIds.length
    ? await client.scimGroupRoleMapping.findMany({
      where: {
        tenantId,
        status: ScimRoleMappingStatus.ACTIVE,
        groupId: { in: groupIds },
        ...(proposal ? { groupId: { in: groupIds.filter((id) => id !== proposal.groupId) } } : {})
      },
      select: { groupId: true, role: true }
    })
    : [];

  const roleByGroup = new Map(activeMappings.map((mapping) => [mapping.groupId, mapping.role]));
  if (proposal) roleByGroup.set(proposal.groupId, proposal.role);

  const rolesByUser = new Map<string, Set<PlatformRole>>();
  for (const user of users) rolesByUser.set(user.id, new Set<PlatformRole>());
  for (const membership of memberships) {
    const role = roleByGroup.get(membership.groupId);
    if (role) rolesByUser.get(membership.userId)?.add(role);
  }

  return { users, rolesByUser };
}

export async function previewScimRoleMapping(
  client: ScopeClient,
  tenantId: string,
  groupId: string,
  role: ScimDirectoryAssignableRole
) {
  const group = await client.scimGroup.findFirst({
    where: { id: groupId, tenantId },
    select: {
      id: true,
      displayName: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { userId: true }
      }
    }
  });
  if (!group) return null;

  const userIds = group.members.map((member) => member.userId);
  const { users, rolesByUser } = await resolvedRoleState(client, tenantId, userIds, { groupId, role });

  let wouldChange = 0;
  let ambiguous = 0;
  let manualConflicts = 0;
  const samples: Array<{
    id: string;
    displayName: string;
    currentRole: PlatformRole;
    projectedRole: PlatformRole | null;
    conflict: "AMBIGUOUS" | "MANUAL" | null;
  }> = [];

  for (const user of users) {
    const roles = [...(rolesByUser.get(user.id) ?? new Set<PlatformRole>())];
    const projectedRole = roles.length === 1 ? roles[0] : roles.length === 0 ? PlatformRole.EMPLOYEE : null;
    let conflict: "AMBIGUOUS" | "MANUAL" | null = null;

    if (roles.length > 1) {
      ambiguous += 1;
      conflict = "AMBIGUOUS";
    } else if (roles.length === 1 && !user.roleManagedByScimGroup && user.role !== PlatformRole.EMPLOYEE) {
      manualConflicts += 1;
      conflict = "MANUAL";
    } else if (projectedRole && (projectedRole !== user.role || user.roleManagedByScimGroup !== (roles.length === 1))) {
      wouldChange += 1;
    }

    if (samples.length < 12) {
      samples.push({
        id: user.id,
        displayName: user.displayName,
        currentRole: user.role,
        projectedRole,
        conflict
      });
    }
  }

  return {
    group: { id: group.id, displayName: group.displayName },
    role,
    memberCount: users.length,
    wouldChange,
    ambiguous,
    manualConflicts,
    samples
  };
}

export async function reconcileScimManagedRoles(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userIds: string[]
) {
  const uniqueUserIds = [...new Set(userIds)];
  if (!uniqueUserIds.length) return { changed: 0, managed: 0, released: 0 };

  const { users, rolesByUser } = await resolvedRoleState(tx, tenantId, uniqueUserIds);
  const now = new Date();
  let changed = 0;
  let managed = 0;
  let released = 0;

  for (const user of users) {
    const roles = [...(rolesByUser.get(user.id) ?? new Set<PlatformRole>())];
    if (roles.length > 1) throw new Error(SCIM_ROLE_MAPPING_AMBIGUOUS);

    if (roles.length === 1 && !user.roleManagedByScimGroup && user.role !== PlatformRole.EMPLOYEE) {
      throw new Error(SCIM_ROLE_MAPPING_MANUAL_CONFLICT);
    }

    const targetRole = roles[0] ?? PlatformRole.EMPLOYEE;
    const targetManaged = roles.length === 1;

    if (targetRole === user.role && targetManaged === user.roleManagedByScimGroup) continue;

    await tx.userAccount.update({
      where: { id: user.id },
      data: {
        role: targetRole,
        roleManagedByScimGroup: targetManaged,
        sessionVersion: { increment: 1 },
        sessionsRevokedAt: now
      }
    });
    changed += 1;
    if (targetManaged) managed += 1;
    else released += 1;
  }

  return { changed, managed, released };
}
