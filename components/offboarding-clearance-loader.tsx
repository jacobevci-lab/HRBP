import { can } from "@/lib/authorization";
import { getOffboardingWorkspaceData } from "@/lib/offboarding-live-data";
import { getServerRequestContext } from "@/lib/server-session";
import { OffboardingClearanceConsole } from "@/components/offboarding-clearance-console";

export async function OffboardingClearanceLoader() {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, "offboarding:write")) return null;
  try {
    const data = await getOffboardingWorkspaceData(ctx, false);
    return <OffboardingClearanceConsole processes={data.processes}/>;
  } catch (error) {
    console.error("[HRBP] Offboarding custody/access clearance data failed", error);
    return null;
  }
}
