import { getRecruitingLifecycleActionCenterData as getLifecycleActionCenterContinuityData } from "@/lib/recruiting-action-center-continuity";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const data = await getLifecycleActionCenterContinuityData(ctx);
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
