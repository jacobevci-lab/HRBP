import { DataClassification, EmergencyAccessStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { authenticationAssuranceVersion } from "@/lib/auth-assurance";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asFiniteNumber, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function assuredTenantAdmin(ctx: Awaited<ReturnType<typeof getRequestContext>>) {
  return Boolean(
    ctx &&
    ctx.role === PlatformRole.TENANT_ADMIN &&
    ctx.mfaSatisfied === true &&
    ctx.assuranceVersion === authenticationAssuranceVersion()
  );
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read") || ctx.role !== PlatformRole.TENANT_ADMIN) return forbidden();

  const now = new Date();
  const [policy, rows] = await Promise.all([
    db.tenantSecurityPolicy.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { breakGlassEnabled: true }
    }),
    db.emergencyAccessGrant.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        requesterId: true,
        reason: true,
        requestedMinutes: true,
        status: true,
        requestedAt: true,
        decidedById: true,
        decidedAt: true,
        validFrom: true,
        validTo: true,
        revokedById: true,
        revokedAt: true,
        decisionNote: true
      }
    })
  ]);

  const actorIds = [...new Set(rows.flatMap((row) => [row.requesterId, row.decidedById, row.revokedById]).filter(Boolean))] as string[];
  const users = actorIds.length ? await db.userAccount.findMany({
    where: { tenantId: ctx.tenantId, id: { in: actorIds } },
    select: { id: true, displayName: true, email: true }
  }) : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  return Response.json({
    data: rows.map((row) => ({
      ...row,
      requester: userById.get(row.requesterId) ?? null,
      decidedBy: row.decidedById ? userById.get(row.decidedById) ?? null : null,
      revokedBy: row.revokedById ? userById.get(row.revokedById) ?? null : null,
      effectiveActive: row.status === EmergencyAccessStatus.ACTIVE &&
        Boolean(row.validFrom && row.validFrom <= now && row.validTo && row.validTo > now)
    })),
    policy: { enabled: policy?.breakGlassEnabled === true },
    permissions: {
      request: can(ctx, "settings:write") && assuredTenantAdmin(ctx),
      decide: can(ctx, "settings:write") && assuredTenantAdmin(ctx),
      revoke: can(ctx, "settings:write")
    },
    currentActorId: ctx.actorId
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write") || ctx.role !== PlatformRole.TENANT_ADMIN) return forbidden();
  if (!assuredTenantAdmin(ctx)) {
    return Response.json({
      error: "Emergency access requests require a current MFA-assured OIDC administrator session."
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const reason = asText(body.reason, 500);
  const requestedMinutes = asFiniteNumber(body.requestedMinutes);
  if (!reason || reason.length < 20) {
    return Response.json({ error: "Emergency access reason must contain at least 20 characters." }, { status: 400 });
  }
  if (requestedMinutes === null || !Number.isInteger(requestedMinutes) || requestedMinutes < 15 || requestedMinutes > 60) {
    return Response.json({ error: "requestedMinutes must be an integer between 15 and 60." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const policy = await tx.tenantSecurityPolicy.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { breakGlassEnabled: true }
    });
    if (policy?.breakGlassEnabled !== true) throw new Error("BREAK_GLASS_DISABLED");

    const existing = await tx.emergencyAccessGrant.findFirst({
      where: {
        tenantId: ctx.tenantId,
        requesterId: ctx.actorId,
        status: { in: [EmergencyAccessStatus.REQUESTED, EmergencyAccessStatus.ACTIVE] }
      },
      select: { id: true }
    });
    if (existing) throw new Error("OPEN_REQUEST_EXISTS");

    const grant = await tx.emergencyAccessGrant.create({
      data: {
        tenantId: ctx.tenantId,
        requesterId: ctx.actorId,
        reason,
        requestedMinutes,
        status: EmergencyAccessStatus.REQUESTED
      }
    });

    await appendAudit(tx, ctx, {
      action: "security.emergency-access-requested",
      resourceType: "EmergencyAccessGrant",
      resourceId: grant.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Time-bound read-only break-glass request for highly restricted data"
    });
    return grant;
  }).catch((error) => error instanceof Error &&
    ["BREAK_GLASS_DISABLED", "OPEN_REQUEST_EXISTS"].includes(error.message)
      ? error.message
      : Promise.reject(error));

  if (result === "BREAK_GLASS_DISABLED") {
    return Response.json({ error: "Tenant break-glass access is disabled." }, { status: 409 });
  }
  if (result === "OPEN_REQUEST_EXISTS") {
    return Response.json({ error: "An open emergency-access request or grant already exists for this administrator." }, { status: 409 });
  }
  return Response.json({ data: result }, { status: 201 });
}
