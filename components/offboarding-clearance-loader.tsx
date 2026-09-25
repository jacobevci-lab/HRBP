import { can } from "@/lib/authorization";
import { getOffboardingWorkspaceData } from "@/lib/offboarding-live-data";
import { getServerRequestContext } from "@/lib/server-session";
import { OffboardingClearanceConsole } from "@/components/offboarding-clearance-console";
import { OffboardingKnowledgeTransferConsole } from "@/components/offboarding-knowledge-transfer-console";

export async function OffboardingClearanceLoader() {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, "offboarding:write")) return null;
  try {
    const data = await getOffboardingWorkspaceData(ctx, true);
    return <><OffboardingClearanceConsole processes={data.processes}/><OffboardingKnowledgeTransferConsole processes={data.processes} employments={data.eligibleEmployments}/></>;
  } catch (error) {
    console.error("[HRBP] Offboarding custody/access/handover clearance data failed", error);
    return null;
  }
}
