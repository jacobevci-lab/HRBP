import { can, forbidden } from "@/lib/authorization";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "audit:read")) return forbidden();

  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 1500);
  const limit = Number.isFinite(requested) ? Math.min(5000, Math.max(10, Math.floor(requested))) : 1500;
  const data = await verifyAuditIntegrity(ctx.tenantId, limit);
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
