import { PlatformRole } from "@prisma/client";
import { can } from "@/lib/authorization";
import type { RequestContext } from "@/lib/request-context";

const workforceMasterDataWriterRoles = new Set<PlatformRole>([
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

export function canCreateEmployeeMasterRecord(ctx: RequestContext) {
  return can(ctx, "people:write") && workforceMasterDataWriterRoles.has(ctx.role);
}
