import { DataClassification, EmergencyAccessStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { authenticationAssuranceVersion } from "@/lib/auth-assurance";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const decisions = ["APPROVE", "REJECT"] as const;

function assuredTenantAdmin(ctx: Awaited<ReturnType<typeof getRequestContext>>) {
  return Boolean(
    ctx &&
    ctx.role === PlatformRole.TENANT_ADMIN &&
    ctx.mfaSatisfied === true &&
    ctx.assuranceVersion === authenticationAssuranceVersion()
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write") || ctx.role !== PlatformRole.TENANT_ADMIN) return forbidden();
  if (!assuredTenantAdmin(ctx)) {
    return Response.json({
      error: "Emergency access decisions require a current MFA-assured OIDC administrator session."
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid emergency access id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const decision = asEnumValue(body.decision, decisions);
  const noteValue = asOptionalText(body.note, 500);
  if (!decision) return Response.json({ error: "decision must be APPROVE or REJECT." }, { status: 400 });
  if (noteValue === null) return Response.json({ error: "note must be a string up to 500 characters." }, { status: 400 });
  const note = noteValue ?? null;

  const result = await db.$transaction(async (tx) => {
    const policy = await tx.tenantSecurityPolicy.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { breakGlassEnabled: true }
    });
    if (policy?.breakGlassEnabled !== true) throw new Error("BREAK_GLASS_DISABLED");

    const grant = await tx.emergencyAccessGrant.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: {
        id: true,
        requesterId: true,
        requestedMinutes: true,
        status: true
      }
    });
    if (!grant) throw new Error("NOT_FOUND");
    if (grant.status !== EmergencyAccessStatus.REQUESTED) throw new Error("INVALID_STATE");
    if (grant.requesterId === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");

    const now = new Date();
    const approved = decision === "APPROVE";
    const validTo = approved ? new Date(now.getTime() + grant.requestedMinutes * 60_000) : null;
    const changed = await tx.emergencyAccessGrant.updateMany({
      where: {
        id: grant.id,
        tenantId: ctx.tenantId,
        status: EmergencyAccessStatus.REQUESTED
      },
      data: {
        status: approved ? EmergencyAccessStatus.ACTIVE : EmergencyAccessStatus.REJECTED,
        decidedById: ctx.actorId,
        decidedAt: now,
        decisionNote: note,
        validFrom: approved ? now : null,
        validTo
      }
    });
    if (changed.count !== 1) throw new Error("STATE_CONFLICT");

    await appendAudit(tx, ctx, {
      action: approved
        ? "security.emergency-access-approved"
        : "security.emergency-access-rejected",
      resourceType: "EmergencyAccessGrant",
      resourceId: grant.id,
      classification: DataClassification.RESTRICTED,
      purpose: approved
        ? `Four-eyes approval for ${grant.requestedMinutes}-minute read-only break-glass access`
        : "Emergency access request rejected"
    });

    return {
      id: grant.id,
      status: approved ? EmergencyAccessStatus.ACTIVE : EmergencyAccessStatus.REJECTED,
      validFrom: approved ? now : null,
      validTo
    };
  }).catch((error) => error instanceof Error &&
    ["BREAK_GLASS_DISABLED", "NOT_FOUND", "INVALID_STATE", "FOUR_EYES_REQUIRED", "STATE_CONFLICT"].includes(error.message)
      ? error.message
      : Promise.reject(error));

  if (result === "BREAK_GLASS_DISABLED") return Response.json({ error: "Tenant break-glass access is disabled." }, { status: 409 });
  if (result === "NOT_FOUND") return Response.json({ error: "Emergency access request was not found." }, { status: 404 });
  if (result === "INVALID_STATE" || result === "STATE_CONFLICT") {
    return Response.json({ error: "Only an unchanged pending emergency access request can be decided." }, { status: 409 });
  }
  if (result === "FOUR_EYES_REQUIRED") {
    return forbidden("Four-eyes control: the requester cannot approve or reject their own emergency access request.");
  }

  return Response.json({ data: result });
}
