import { randomUUID } from "node:crypto";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { smtpConfigurationStatus } from "@/lib/notification-email-config";
import { getRequestContext, mutationOriginAllowed } from "@/lib/request-context";
import { sendSmtpNotification, validEmailAddress } from "@/lib/smtp-notification-provider";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const fail = (code: string, status: number) => json({ code, error: "SMTP verification could not be completed." }, status);

function maskedEmail(value: string) {
  const [local, domain] = value.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return fail("SMTP_TEST_AUTH_REQUIRED", 401);
  if (!mutationOriginAllowed(request)) return fail("SMTP_TEST_ACCESS_DENIED", 403);
  if (!can(ctx, "settings:write")) return fail("SMTP_TEST_ACCESS_DENIED", 403);
  const suppliedId = request.headers.get("x-hrbp-test-id");
  if (suppliedId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(suppliedId)) {
    return fail("SMTP_TEST_ID_INVALID", 400);
  }
  // This ID correlates UI replies; it is not a durable idempotency key.
  const testId = suppliedId ?? randomUUID();
  const smtp = smtpConfigurationStatus();
  if (!smtp.enabled || !smtp.configured) return fail("SMTP_TEST_NOT_CONFIGURED", 409);

  let recipient: string;
  try {
    recipient = await db.$transaction(async (tx) => {
      // Serialize only this principal's reservation. SMTP network I/O must NOT
      // hold this database lock. Re-read eligibility and cooldown after waiting.
      await tx.$queryRaw`SELECT "id" FROM "UserAccount" WHERE "id" = ${ctx.actorId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
      const user = await tx.userAccount.findFirst({
        where: { id: ctx.actorId, tenantId: ctx.tenantId, active: true },
        select: { id: true, email: true, role: true }
      });
      if (!user || user.role !== ctx.role || !can({ ...ctx, role: user.role }, "settings:write")) throw new Error("SMTP_TEST_ACCESS_DENIED");
      const address = user.email ? validEmailAddress(user.email) : null;
      if (!address) throw new Error("SMTP_TEST_RECIPIENT_UNAVAILABLE");
      const recent = await tx.auditEvent.findFirst({
        where: { tenantId: ctx.tenantId, actorId: ctx.actorId, action: "settings.smtp-test-requested",
          occurredAt: { gte: new Date(Date.now() - 60_000) } },
        orderBy: { occurredAt: "desc" }, select: { id: true }
      });
      if (recent) throw new Error("SMTP_TEST_RATE_LIMITED");
      await appendAudit(tx, ctx, {
        action: "settings.smtp-test-requested", resourceType: "Tenant", resourceId: ctx.tenantId,
        classification: DataClassification.RESTRICTED,
        purpose: `Administrator reserved own-account SMTP verification ${testId}`
      });
      return address;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SMTP_TEST_RATE_LIMITED") return Response.json({ code, error: "Wait before requesting another SMTP test." }, { status: 429, headers: { ...headers, "retry-after": "60" } });
    if (code === "SMTP_TEST_ACCESS_DENIED") return fail(code, 403);
    if (code === "SMTP_TEST_RECIPIENT_UNAVAILABLE") return fail(code, 409);
    // No provider call can happen if the requested audit/reservation failed.
    return fail("SMTP_TEST_RESERVATION_FAILED", 503);
  }

  const recordAcceptance = () => db.$transaction(tx => appendAudit(tx, ctx, {
      action: "settings.smtp-test-succeeded", resourceType: "Tenant", resourceId: ctx.tenantId,
      classification: DataClassification.RESTRICTED,
      purpose: `SMTP server accepted verification ${testId}; recipient mailbox delivery is not verified`
    }));

  try {
    await sendSmtpNotification({ outboxId: `smtp-test-${testId}`, tenantId: ctx.tenantId,
      eventType: "SMTP_CONFIGURATION_TEST", recipient, resourceType: "Settings", resourceId: ctx.tenantId,
      classification: DataClassification.INTERNAL, payload: null });
  } catch {
    await db.$transaction(tx => appendAudit(tx, ctx, {
      action: "settings.smtp-test-failed", resourceType: "Tenant", resourceId: ctx.tenantId,
      classification: DataClassification.RESTRICTED,
      purpose: `SMTP acceptance could not be confirmed for verification ${testId}; provider details omitted`
    })).catch(() => undefined);
    // The server may have accepted DATA before a connection failure. Do not
    // assert that nothing was sent or automatically issue a duplicate.
    return fail("SMTP_TEST_RESULT_UNKNOWN", 502);
  }

  let auditRecorded = true;
  try {
    await recordAcceptance();
  } catch {
    auditRecorded = false;
    console.error("[HRBP] SMTP test was accepted but its outcome audit could not be recorded.");
  }
  // SMTP acceptance is an irreversible external side effect. An audit failure
  // must not turn it into a failed send or create a false failure event.
  return json({ data: { sent: true, deliveryStatus: "SMTP_ACCEPTED", mailboxDeliveryConfirmed: false,
    auditRecorded, testId, actorId: ctx.actorId, tenantId: ctx.tenantId, recipient: maskedEmail(recipient) } }, auditRecorded ? 200 : 202);
}
