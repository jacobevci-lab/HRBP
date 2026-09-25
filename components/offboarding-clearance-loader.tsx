import { can } from "@/lib/authorization";
import { getOffboardingExitDecisionData } from "@/lib/offboarding-exit-decision-data";
import { getOffboardingWorkspaceData } from "@/lib/offboarding-live-data";
import { getServerRequestContext } from "@/lib/server-session";
import { OffboardingClearanceConsole } from "@/components/offboarding-clearance-console";
import { OffboardingExitDecisionConsole } from "@/components/offboarding-exit-decision-console";
import { OffboardingKnowledgeTransferConsole } from "@/components/offboarding-knowledge-transfer-console";

export async function OffboardingClearanceLoader() {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, "offboarding:write")) return null;
  try {
    const [data, decisions] = await Promise.all([getOffboardingWorkspaceData(ctx, true), getOffboardingExitDecisionData(ctx)]);
    return <><OffboardingClearanceConsole processes={data.processes}/><OffboardingKnowledgeTransferConsole processes={data.processes} employments={data.eligibleEmployments}/><OffboardingExitDecisionConsole rows={decisions}/></>;
  } catch (error) {
    console.error("[HRBP] Offboarding custody/access/handover/decision data failed", error);
    return null;
  }
}
