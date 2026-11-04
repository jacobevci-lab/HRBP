export const WORKFORCE_MASTER_DATA_WRITER_ROLES = ["HR_OPERATIONS", "TENANT_ADMIN"] as const;

export function roleCanCreateEmployeeMasterRecord(role: string | null | undefined) {
  return WORKFORCE_MASTER_DATA_WRITER_ROLES.includes(role as (typeof WORKFORCE_MASTER_DATA_WRITER_ROLES)[number]);
}
