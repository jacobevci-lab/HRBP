import { DataClassification, NotificationOutboxStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/input-validation";
import { parseRetryCommand, sameSnapshots } from "@/lib/notification-retry-contract";
import { getRequestContext, mutationOriginAllowed } from "@/lib/request-context";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext(request);
    if (!ctx) return json({ error: "Authentication required." }, 401);
    if (!can(ctx, "settings:write") || !mutationOriginAllowed(request)) return json({ error: "Access denied." }, 403);
    // No empty/malformed id or legacy implicit batch fallback. Every row is
    // explicitly reviewed, bounded and tied to its displayed version.
    const command = parseRetryCommand(await readJsonObject(request));
    if (!command) return json({ error: "An explicit mode, UUID and 1–100 valid reviewed records are required." }, 400);
    const requestedId = command.mode === "SINGLE" ? command.items[0].id : null;
    const retryableStatuses = [NotificationOutboxStatus.FAILED, NotificationOutboxStatus.DEAD_LETTER];
    const requeued = await db.$transaction(async tx => {
      const rows = await tx.notificationOutbox.findMany({
        where: { tenantId: ctx.tenantId, id: { in: command.items.map(i => i.id) } },
        orderBy: { id: "asc" }, take: 100,
        select: { id: true, status: true, attempts: true, updatedAt: true }
      });
      if (rows.length !== command.items.length) throw new Error("NOT_FOUND");
      if (rows.some(r => !retryableStatuses.includes(r.status as typeof retryableStatuses[number])) ||
          !sameSnapshots(command.items, rows.map(r => ({ ...r, status: r.status as "FAILED" | "DEAD_LETTER", updatedAt: r.updatedAt.toISOString() })))) throw new Error("CONFLICT");
      // Match EACH original status/attempt/version, including batch members.
      // A partial claim is rolled back, never reported as a successful retry.
      const result = await tx.notificationOutbox.updateMany({
        where: { tenantId: ctx.tenantId, OR: command.items.map(i => ({ ...i, updatedAt: new Date(i.updatedAt) })) },
        data: { status: NotificationOutboxStatus.PENDING, attempts: 0, nextAttemptAt: new Date(),
          lockedAt: null, deliveredAt: null, lastError: null,
          updatedAt: new Date(Math.max(Date.now(), ...rows.map(r => r.updatedAt.getTime() + 1))) }
      });
      if (result.count !== command.items.length) throw new Error("CONFLICT");
      await appendAudit(tx, ctx, {
        action: requestedId ? "settings.notification-requeued" : "settings.notifications-dead-letter-requeued",
        resourceType: "NotificationOutbox", resourceId: requestedId ?? "dead-letter-batch",
        classification: DataClassification.INTERNAL,
        purpose: `Explicitly requeued ${result.count} reviewed notification(s); correlation ${command.commandId}. Delivery is not confirmed.`
      });
      return result.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return json({ data: { command, actorId: ctx.actorId, tenantId: ctx.tenantId, requeued, result: "PENDING" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return json({ error: "One or more notifications are unavailable." }, 404);
    if (error instanceof Error && error.message === "CONFLICT" || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
      return json({ error: "The reviewed notification state changed. Nothing was requeued by this request." }, 409);
    console.error("[HRBP] Notification retry could not be completed.");
    return json({ error: "Notification retry could not be confirmed. Review current state before another request." }, 503);
  }
}
