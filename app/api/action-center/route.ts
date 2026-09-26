import { getLifecycleActionCenterData } from "@/lib/lifecycle-action-center";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const data = await getLifecycleActionCenterData(ctx);
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
