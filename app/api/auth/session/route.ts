import { authConfigurationStatus } from "@/lib/auth-config";
import { sessionFromRequest } from "@/lib/auth-session";
import { can, type Capability } from "@/lib/authorization";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const uiCapabilityCandidates: Capability[] = [
  "people:read",
  "people:write",
  "organization:read",
  "positions:read",
  "documents:read",
  "recruiting:read",
  "onboarding:read",
  "offboarding:read",
  "time:read",
  "leave:read",
  "compensation:read",
  "payroll:read",
  "benefits:read",
  "performance:read",
  "talent:read",
  "succession:read",
  "learning:read",
  "cases:read",
  "hr-service:read",
  "policies:read",
  "engagement:read",
  "workforce-plan:read",
  "analytics:read",
  "ai:use",
  "privacy:read",
  "workflows:read",
  "settings:read",
  "audit:read"
];

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  const configuration = authConfigurationStatus();

  if (!session) {
    return Response.json({ authenticated: false, oidcConfigured: configuration.configured }, { headers: { "cache-control": "no-store" } });
  }

  const authorizationContext = {
    tenantId: session.tenantId,
    actorId: session.actorId,
    role: session.role,
    employmentId: session.employmentId
  };
  const uiCapabilities = uiCapabilityCandidates.filter((capability) => can(authorizationContext, capability));

  let tenantName: string | null = null;
  try {
    tenantName = (await db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } }))?.name ?? null;
  } catch {
    tenantName = null;
  }

  return Response.json({
    authenticated: true,
    oidcConfigured: configuration.configured,
    navigationCapabilities: uiCapabilities,
    user: {
      id: session.actorId,
      displayName: session.displayName,
      email: session.email ?? null,
      role: session.role,
      tenantId: session.tenantId,
      tenantName,
      employmentId: session.employmentId ?? null,
      expiresAt: new Date(session.exp * 1000).toISOString()
    }
  }, { headers: { "cache-control": "no-store" } });
}
