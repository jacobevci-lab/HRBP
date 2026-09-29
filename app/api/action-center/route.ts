import { getLifecycleActionCenterFullContinuityData } from "@/lib/joiner-leaver-action-center-continuity";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const data = await getLifecycleActionCenterFullContinuityData(ctx);
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
