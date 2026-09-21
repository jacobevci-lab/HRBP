import { runtimeString } from "@/lib/runtime-env";

export const DEFAULT_STAGING_TENANT_ID = "tenant-acme-global";

export function workspaceTenantId() {
  return runtimeString("HRBP_AUTH_TENANT_ID") || DEFAULT_STAGING_TENANT_ID;
}
