import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { hashLocalPassword, validLocalPassword } from "@/lib/local-auth";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type LocalAccountAction = "enable" | "disable" | "unlock" | "reset-password";

function actionValue(value: unknown): LocalAccountAction | null {
  return value === "enable" || value === "disable" || value === "unlock" || value === "reset-password"
    ? value
    : null;
}

const projection = {
  id: true,
  subject: true,
  displayName: true,
  email: true,
  role: true,
  active: true,
  localAuthEnabled: true,
  localPasswordUpdatedAt: true,
  localFailedAttempts: true,
  localLockedUntil: true,
  lastLocalLoginAt: true
} as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid local account id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = actionValue(body.action);
  if (!action) return Response.json({ error: "action must be enable, disable, unlock or reset-password." }, { status: 400 });

  const current = await db.userAccount.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, subject: true, localAuthEnabled: true, localPasswordHash: true }
  });
  if (!current) return Response.json({ error: "Local account was not found in this tenant." }, { status: 404 });

  if (action === "disable" && current.id === ctx.actorId) {
    return forbidden("You cannot disable local sign-in for the account backing your current session.");
  }

  if (action === "reset-password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (!validLocalPassword(password)) {
      return Response.json({ error: "Local password must be 12-256 characters." }, { status: 400 });
    }
    const data = await db.$transaction(async (tx) => {
      const updated = await tx.userAccount.update({
        where: { id },
        data: {
          localPasswordHash: hashLocalPassword(password),
          localPasswordUpdatedAt: new Date(),
          localAuthEnabled: true,
          localFailedAttempts: 0,
          localLockedUntil: null
        },
        select: projection
      });
      await appendAudit(tx, ctx, {
        action: "settings.local-account-password-reset",
        resourceType: "UserAccount",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Tenant administrator reset a local application password"
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (action === "unlock") {
    const data = await db.$transaction(async (tx) => {
      const updated = await tx.userAccount.update({
        where: { id },
        data: { localFailedAttempts: 0, localLockedUntil: null },
        select: projection
      });
      await appendAudit(tx, ctx, {
        action: "settings.local-account-unlocked",
        resourceType: "UserAccount",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Tenant administrator cleared local authentication lockout"
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (action === "enable" && !current.localPasswordHash) {
    return Response.json({ error: "Set a local password before enabling local sign-in." }, { status: 409 });
  }

  const enabled = action === "enable";
  const data = await db.$transaction(async (tx) => {
    const updated = await tx.userAccount.update({
      where: { id },
      data: {
        localAuthEnabled: enabled,
        localFailedAttempts: 0,
        localLockedUntil: null
      },
      select: projection
    });
    await appendAudit(tx, ctx, {
      action: enabled ? "settings.local-account-enabled" : "settings.local-account-disabled",
      resourceType: "UserAccount",
      resourceId: id,
      classification: DataClassification.RESTRICTED,
      purpose: enabled ? "Tenant administrator enabled local application sign-in" : "Tenant administrator disabled local application sign-in"
    });
    return updated;
  });

  return Response.json({ data });
}
