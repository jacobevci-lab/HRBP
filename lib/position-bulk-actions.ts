import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export const MAX_POSITION_BULK_SELECTION = 100;

export function normalizePositionBulkIds(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_POSITION_BULK_SELECTION) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") return null;
    const id = value.trim();
    if (!id || id.length > 191 || /[\u0000-\u001f\u007f]/.test(id)) return null;
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized.length ? normalized : null;
}

export async function bulkSetPositionCriticality(ctx: RequestContext, rawIds: unknown, critical: boolean) {
  if (!can(ctx, "positions:write")) throw new Error("POSITION_BULK_FORBIDDEN");
  const ids = normalizePositionBulkIds(rawIds);
  if (!ids) throw new Error("POSITION_BULK_INVALID");

  return withDb((client) => client.$transaction(async (tx) => {
    const positions = await tx.position.findMany({
      where: {
        tenantId: ctx.tenantId,
        validTo: null,
        id: { in: ids }
      },
      select: { id: true, critical: true }
    });

    // Bulk mutations are all-or-nothing. Never silently skip a stale, closed,
    // cross-tenant or otherwise invisible position identifier.
    if (positions.length !== ids.length) throw new Error("POSITION_BULK_SCOPE_MISMATCH");

    const changed = positions.filter((position) => position.critical !== critical);
    if (!changed.length) return { selected: ids.length, changed: 0, critical };

    const changedIds = changed.map((position) => position.id);
    const update = await tx.position.updateMany({
      where: {
        tenantId: ctx.tenantId,
        validTo: null,
        id: { in: changedIds }
      },
      data: { critical }
    });
    if (update.count !== changedIds.length) throw new Error("POSITION_BULK_CONFLICT");

    for (const position of changed) {
      await appendAudit(tx, ctx, {
        action: critical ? "POSITION_MARKED_CRITICAL" : "POSITION_CRITICALITY_CLEARED",
        resourceType: "Position",
        resourceId: position.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Workforce position criticality administration"
      });
    }

    return { selected: ids.length, changed: changed.length, critical };
  }));
}
