import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_VISIBLE_ACCOUNTS = 250;

type SessionAction = "revoke-account" | "revoke-tenant";

function actionValue(value: unknown): SessionAction | null {
  return value === "revoke-account" || value === "revoke-tenant" ? value : null;
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();

  const [tenant, accounts, totalAccounts] = await Promise.all([
    db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { id: true, sessionVersion: true, sessionsRevokedAt: true }
    }),
    db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: MAX_VISIBLE_ACCOUNTS,
      select: {
        id: true,
        subject: true,
        displayName: true,
        email: true,
        role: true,
        sessionVersion: true,
        sessionsRevokedAt: true
      }
    }),
    db.userAccount.count({ where: { tenantId: ctx.tenantId, active: true } })
  ]);

  if (!tenant) return Response.json({ error: "Tenant was not found." }, { status: 404 });

  return Response.json({
    data: {
      tenant,
      accounts,
      totalAccounts,
      truncated: totalAccounts > accounts.length,
      currentActorId: ctx.actorId
    },
    permissions: { write: can(ctx, "settings:write") }
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = actionValue(body.action);
  if (!action) return Response.json({ error: "action must be revoke-account or revoke-tenant." }, { status: 400 });

  const now = new Date();

  if (action === "revoke-account") {
    const accountId = asIdentifier(body.accountId);
    if (!accountId) return Response.json({ error: "A valid accountId is required." }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const changed = await tx.userAccount.updateMany({
        where: { id: accountId, tenantId: ctx.tenantId, active: true },
        data: { sessionVersion: { increment: 1 }, sessionsRevokedAt: now }
      });
      if (changed.count !== 1) return null;

      const account = await tx.userAccount.findFirst({
        where: { id: accountId, tenantId: ctx.tenantId },
        select: {
          id: true,
          displayName: true,
          subject: true,
          role: true,
          sessionVersion: true,
          sessionsRevokedAt: true
        }
      });
      if (!account) return null;

      await appendAudit(tx, ctx, {
        action: "settings.sessions-account-revoked",
        resourceType: "UserAccount",
        resourceId: account.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Tenant administrator revoked all active application sessions for one account"
      });
      return account;
    });

    if (!result) return Response.json({ error: "Active account was not found in this tenant." }, { status: 404 });
    return Response.json({ data: result, currentSessionRevoked: result.id === ctx.actorId });
  }

  if (body.confirmation !== ctx.tenantId) {
    return Response.json({ error: "Tenant-wide revocation requires exact tenant-id confirmation." }, { status: 409 });
  }

  const tenant = await db.$transaction(async (tx) => {
    const updated = await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: { sessionVersion: { increment: 1 }, sessionsRevokedAt: now },
      select: { id: true, sessionVersion: true, sessionsRevokedAt: true }
    });
    await appendAudit(tx, ctx, {
      action: "settings.sessions-tenant-revoked",
      resourceType: "Tenant",
      resourceId: updated.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Tenant administrator revoked all active application sessions in the tenant"
    });
    return updated;
  });

  return Response.json({ data: tenant, currentSessionRevoked: true });
}
