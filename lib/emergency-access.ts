import { EmergencyAccessStatus, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";

export type EmergencyAccessContext = {
  breakGlassActive: boolean;
  breakGlassGrantId?: string;
  breakGlassExpiresAt?: Date;
};

export async function resolveEmergencyAccess(input: {
  tenantId: string;
  actorId: string;
  role: PlatformRole;
  now?: Date;
}): Promise<EmergencyAccessContext> {
  if (input.role !== PlatformRole.TENANT_ADMIN) return { breakGlassActive: false };
  const now = input.now ?? new Date();

  try {
    const [policy, grant] = await Promise.all([
      db.tenantSecurityPolicy.findUnique({
        where: { tenantId: input.tenantId },
        select: { breakGlassEnabled: true }
      }),
      db.emergencyAccessGrant.findFirst({
        where: {
          tenantId: input.tenantId,
          requesterId: input.actorId,
          status: EmergencyAccessStatus.ACTIVE,
          validFrom: { lte: now },
          validTo: { gt: now }
        },
        orderBy: [{ validTo: "asc" }, { id: "asc" }],
        select: { id: true, validTo: true }
      })
    ]);

    if (policy?.breakGlassEnabled !== true || !grant?.validTo) return { breakGlassActive: false };
    return {
      breakGlassActive: true,
      breakGlassGrantId: grant.id,
      breakGlassExpiresAt: grant.validTo
    };
  } catch {
    console.error("[HRBP] Emergency access resolution unavailable.");
    return { breakGlassActive: false };
  }
}
