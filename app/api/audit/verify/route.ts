import { can, forbidden } from "@/lib/authorization";
import { computeAuditHash } from "@/lib/audit";
import { withDb } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "audit:read")) return forbidden();

  return withDb(async (db) => {
    const total = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
    if (total > 10000) {
      return Response.json({
        status: "checkpoint-required",
        total,
        error: "Online verification is capped at 10,000 events. Use checkpoint/offline verification for larger ledgers."
      }, { status: 413 });
    }

    const [state, events] = await Promise.all([
      db.auditLedgerState.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { tailHash: true, eventCount: true }
      }),
      db.auditEvent.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ ledgerSequence: "asc" }],
        select: {
          id: true,
          tenantId: true,
          ledgerSequence: true,
          actorId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          purpose: true,
          classification: true,
          ipAddress: true,
          occurredAt: true,
          hash: true,
          previousHash: true
        }
      })
    ]);

    if (!events.length) {
      if (state && (state.eventCount !== BigInt(0) || state.tailHash !== null)) {
        return Response.json({
          status: "invalid",
          verified: 0,
          total: 0,
          error: "Ledger state is non-empty while no audit events exist."
        }, { status: 409 });
      }
      return Response.json({ status: "ok", verified: 0, total: 0, root: null, tail: null });
    }

    if (!state) {
      return Response.json({
        status: "invalid",
        verified: 0,
        total,
        error: "Ledger state is missing for a non-empty audit ledger."
      }, { status: 409 });
    }

    if (state.eventCount !== BigInt(total)) {
      return Response.json({
        status: "invalid",
        verified: 0,
        total,
        error: "Ledger state event count does not match persisted audit events."
      }, { status: 409 });
    }

    let previousHash: string | null = null;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const expectedSequence = BigInt(index + 1);

      if (event.ledgerSequence !== expectedSequence) {
        return Response.json({
          status: "invalid",
          verified: index,
          total,
          eventId: event.id,
          error: "Ledger sequence is not contiguous."
        }, { status: 409 });
      }
      if (event.previousHash !== previousHash) {
        return Response.json({
          status: "invalid",
          verified: index,
          total,
          eventId: event.id,
          error: "Stored previousHash does not match the preceding audit event hash."
        }, { status: 409 });
      }

      const expected = computeAuditHash({
        tenantId: event.tenantId,
        actorId: event.actorId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        purpose: event.purpose,
        classification: event.classification,
        ipAddress: event.ipAddress,
        occurredAt: event.occurredAt
      }, event.previousHash);

      if (expected !== event.hash) {
        return Response.json({
          status: "invalid",
          verified: index,
          total,
          eventId: event.id,
          error: "Audit event hash mismatch."
        }, { status: 409 });
      }
      previousHash = event.hash;
    }

    const root = events[0].hash;
    const tail = events.at(-1)?.hash ?? null;
    if (tail !== state.tailHash) {
      return Response.json({
        status: "invalid",
        verified: events.length,
        total,
        error: "Ledger state tail does not match the verified audit chain."
      }, { status: 409 });
    }

    return Response.json({ status: "ok", verified: events.length, total, root, tail });
  });
}
