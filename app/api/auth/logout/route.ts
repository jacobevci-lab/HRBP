import { DataClassification } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { clearSessionCookie, sessionFromRequest } from "@/lib/auth-session";
import { mutationOriginAllowed } from "@/lib/request-context";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ error: "Use the sign-out button to end your session." },
    { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!request.headers.get("origin") || !mutationOriginAllowed(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-origin sign-out blocked." }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  const session = sessionFromRequest(request);
  if (session) {
    try {
      await recordAudit({
        ctx: {
          tenantId: session.tenantId,
          actorId: session.actorId,
          role: session.role,
          employmentId: session.employmentId,
          ipAddress: request.headers.get("cf-connecting-ip")?.trim() ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            undefined
        },
        action: "auth.session-logout",
        resourceType: "UserAccount",
        resourceId: session.actorId,
        classification: DataClassification.INTERNAL,
        purpose: "Explicit application sign-out"
      });
    } catch {
      // Logout must remain available even when audit persistence is temporarily unavailable.
      console.error("[HRBP] Session sign-out audit unavailable.");
    }
  }

  const headers = new Headers({ location: "/auth/sign-in?signedOut=1", "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie());
  return new Response(null, { status: 303, headers });
}
