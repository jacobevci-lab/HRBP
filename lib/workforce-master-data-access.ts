import { can } from "@/lib/authorization";
import type { RequestContext } from "@/lib/request-context";
import { roleCanCreateEmployeeMasterRecord } from "@/lib/workforce-master-data-policy";

export function canCreateEmployeeMasterRecord(ctx: RequestContext) {
  return can(ctx, "people:write") && roleCanCreateEmployeeMasterRecord(ctx.role);
}
