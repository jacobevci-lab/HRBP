import { internalBearerAuthorized } from "@/lib/internal-auth";
import { advanceAuditHistoryVerification } from "@/lib/audit-history-monitoring";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function diagnostic(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "AUDIT_HISTORY_FAILED";
}

export async function GET(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return json({ error: "Valid internal maintenance credentials are required." }, 401);
  }
  return json({ data: {
    scanVersion: 1,
    scheduleVersion: 1,
    mode: "BOUNDED_RESUMABLE_FULL_HISTORY",
    cadence: "SEPARATE_FROM_FAST_AUDIT_INTEGRITY"
  } });
}

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return json({ error: "Valid internal maintenance credentials are required." }, 401);
  }
  try {
    return json({ data: await advanceAuditHistoryVerification() });
  } catch (error) {
    const code = diagnostic(error);
    console.error("[HRBP] Audit full-history invocation failed.", { code });
    return json({
      error: "Audit full-history verification did not complete safely.",
      code
    }, code === "AUDIT_SCHEDULE_BUSY" ? 409 : 500);
  }
}
