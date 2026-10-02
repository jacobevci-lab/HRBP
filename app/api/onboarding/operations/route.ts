import { can } from "@/lib/authorization";
import { getOnboardingOperationsPage } from "@/lib/onboarding-operations-data";
import { parseOnboardingOperationsQuery } from "@/lib/onboarding-operations-query.mjs";
import { getRequestContext } from "@/lib/request-context";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return json({ error: "Authentication required." }, 401);
  if (!can(ctx, "onboarding:read") || !can(ctx, "onboarding:write")) return json({ error: "Onboarding operations access required." }, 403);
  const search = new URL(request.url).searchParams;
  try { parseOnboardingOperationsQuery(search); }
  catch { return json({ error: "Invalid onboarding page or focus selection." }, 400); }
  try {
    const data = await getOnboardingOperationsPage(ctx, search);
    if (!data.page.resolved) return json({ error: "The requested record is not available in your active onboarding scope." }, 404);
    return json({ data });
  } catch {
    // Never log/echo selectors, SQL, credentials or employee data. Do not broaden the lookup.
    console.error("[HRBP] Scoped onboarding page unavailable.");
    return json({ error: "Onboarding records are temporarily unavailable. Refresh to try again." }, 503);
  }
}
