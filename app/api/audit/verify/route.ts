import { can, forbidden } from "@/lib/authorization";
import { computeAuditHash } from "@/lib/audit";
import { withDb } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
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

    const events = await db.auditEvent.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true, tenantId: true, actorId: true, action: true, resourceType: true, resourceId: true,
        purpose: true, classification: true, ipAddress: true, occurredAt: true, hash: true, previousHash: true
      }
    });

    if (!events.length) return Response.json({ status: "ok", verified: 0, total: 0, root: null, tail: null });

    const roots = events.filter((event) => !event.previousHash);
    if (roots.length !== 1) return Response.json({ status: "invalid", verified: 0, total, error: `Expected one ledger root, found ${roots.length}.` }, { status: 409 });

    const childByPrevious = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!event.previousHash) continue;
      if (childByPrevious.has(event.previousHash)) {
        return Response.json({ status: "invalid", verified: 0, total, error: "Ledger contains a forked previousHash reference." }, { status: 409 });
      }
      childByPrevious.set(event.previousHash, event);
    }

    const visited = new Set<string>();
    let current: (typeof events)[number] | undefined = roots[0];
    let tail = roots[0].hash;

    while (current) {
      if (visited.has(current.id)) return Response.json({ status: "invalid", verified: visited.size, total, error: "Ledger cycle detected." }, { status: 409 });
      visited.add(current.id);
      const expected = computeAuditHash({
        tenantId: current.tenantId,
        actorId: current.actorId,
        action: current.action,
        resourceType: current.resourceType,
        resourceId: current.resourceId,
        purpose: current.purpose,
        classification: current.classification,
        ipAddress: current.ipAddress,
        occurredAt: current.occurredAt
      }, current.previousHash);
      if (expected !== current.hash) {
        return Response.json({ status: "invalid", verified: visited.size - 1, total, eventId: current.id, error: "Audit event hash mismatch." }, { status: 409 });
      }
      tail = current.hash;
      current = childByPrevious.get(current.hash);
    }

    if (visited.size !== events.length) {
      return Response.json({ status: "invalid", verified: visited.size, total, error: "One or more audit events are disconnected from the hash chain." }, { status: 409 });
    }

    return Response.json({ status: "ok", verified: visited.size, total, root: roots[0].hash, tail });
  });
}
