import { randomUUID } from "node:crypto";
import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { smtpConfigurationStatus } from "@/lib/notification-email-config";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { sendSmtpNotification } from "@/lib/smtp-notification-provider";

function maskedEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "configured-recipient";
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const smtp = smtpConfigurationStatus();
  if (!smtp.enabled || !smtp.configured) {
    return Response.json({
      error: "SMTP delivery is not ready.",
      missing: smtp.missing
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const user = await db.userAccount.findFirst({
    where: { id: ctx.actorId, tenantId: ctx.tenantId, active: true },
    select: { id: true, email: true }
  });
  if (!user?.email) {
    return Response.json({ error: "Your active account does not have an email address for the SMTP test." }, { status: 409 });
  }

  await db.$transaction(async (tx) => {
    await appendAudit(tx, ctx, {
      action: "settings.smtp-test-requested",
      resourceType: "Tenant",
      resourceId: ctx.tenantId,
      classification: DataClassification.RESTRICTED,
      purpose: "Tenant administrator requested an SMTP delivery verification to their own account"
    });
  });

  try {
    await sendSmtpNotification({
      outboxId: `smtp-test-${randomUUID()}`,
      tenantId: ctx.tenantId,
      eventType: "SMTP_CONFIGURATION_TEST",
      recipient: user.email,
      resourceType: "Settings",
      resourceId: ctx.tenantId,
      classification: DataClassification.INTERNAL,
      payload: null
    });

    await db.$transaction(async (tx) => {
      await appendAudit(tx, ctx, {
        action: "settings.smtp-test-succeeded",
        resourceType: "Tenant",
        resourceId: ctx.tenantId,
        classification: DataClassification.RESTRICTED,
        purpose: "SMTP delivery verification completed for the requesting administrator"
      });
    });

    return Response.json({
      data: { sent: true, recipient: maskedEmail(user.email) }
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    await db.$transaction(async (tx) => {
      await appendAudit(tx, ctx, {
        action: "settings.smtp-test-failed",
        resourceType: "Tenant",
        resourceId: ctx.tenantId,
        classification: DataClassification.RESTRICTED,
        purpose: "SMTP delivery verification failed; provider details were not persisted"
      });
    }).catch(() => undefined);

    return Response.json({ error: "SMTP test delivery failed. Review provider connectivity and configuration." }, {
      status: 502,
      headers: { "cache-control": "no-store" }
    });
  }
}
