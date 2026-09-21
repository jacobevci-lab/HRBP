import { authConfigurationStatus } from "@/lib/auth-config";
import { sessionFromRequest } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  const configuration = authConfigurationStatus();

  if (!session) {
    return Response.json({ authenticated: false, oidcConfigured: configuration.configured }, { headers: { "cache-control": "no-store" } });
  }

  return Response.json({
    authenticated: true,
    oidcConfigured: configuration.configured,
    user: {
      id: session.actorId,
      displayName: session.displayName,
      email: session.email ?? null,
      role: session.role,
      tenantId: session.tenantId,
      employmentId: session.employmentId ?? null,
      expiresAt: new Date(session.exp * 1000).toISOString()
    }
  }, { headers: { "cache-control": "no-store" } });
}
