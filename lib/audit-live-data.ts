import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyAuditIntegrity } from "@/lib/audit-integrity";

export type AuditFilter = {
  query?: string;
  actorId?: string;
  resourceType?: string;
  classification?: DataClassification;
  days?: number;
};

export async function getAuditLiveData(tenantId: string, filter: AuditFilter = {}) {
  const now = new Date();
  const days = Math.min(365, Math.max(1, Math.floor(filter.days ?? 30)));
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const query = filter.query?.trim().slice(0, 100) ?? "";
  const where: Prisma.AuditEventWhereInput = {
    tenantId,
    occurredAt: { gte: since },
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
    ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
    ...(filter.classification ? { classification: filter.classification } : {}),
    ...(query ? {
      OR: [
        { action: { contains: query, mode: "insensitive" } },
        { resourceType: { contains: query, mode: "insensitive" } },
        { resourceId: { contains: query, mode: "insensitive" } },
        { purpose: { contains: query, mode: "insensitive" } },
        { actorId: { contains: query, mode: "insensitive" } }
      ]
    } : {})
  };

  const [rows, total, last24h, classifications, resources, actors, integrity] = await Promise.all([
    db.auditEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 250,
      select: {
        id: true, actorId: true, action: true, resourceType: true, resourceId: true,
        purpose: true, classification: true, ipAddress: true, occurredAt: true,
        hash: true, previousHash: true
      }
    }),
    db.auditEvent.count({ where }),
    db.auditEvent.count({ where: { tenantId, occurredAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    db.auditEvent.groupBy({ by: ["classification"], where: { tenantId, occurredAt: { gte: since } }, _count: { _all: true } }),
    db.auditEvent.groupBy({ by: ["resourceType"], where: { tenantId, occurredAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { resourceType: "desc" } }, take: 20 }),
    db.auditEvent.groupBy({ by: ["actorId"], where: { tenantId, occurredAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { actorId: "desc" } }, take: 50 }),
    verifyAuditIntegrity(tenantId, 1500)
  ]);

  const actorIds = Array.from(new Set([...rows.map((row) => row.actorId), ...actors.map((row) => row.actorId)])).filter((id) => !id.startsWith("system:"));
  const users = actorIds.length ? await db.userAccount.findMany({
    where: { tenantId, id: { in: actorIds } },
    select: { id: true, displayName: true, email: true, role: true }
  }) : [];
  const userMap = new Map(users.map((user) => [user.id, user]));

  return {
    generatedAt: now.toISOString(),
    rangeDays: days,
    total,
    last24h,
    integrity,
    classificationCounts: Object.fromEntries(classifications.map((row) => [row.classification, row._count._all])) as Record<DataClassification, number>,
    resourceOptions: resources.map((row) => ({ value: row.resourceType, count: row._count._all })),
    actorOptions: actors.map((row) => ({
      value: row.actorId,
      label: userMap.get(row.actorId)?.displayName ?? row.actorId,
      role: userMap.get(row.actorId)?.role ?? null,
      count: row._count._all
    })),
    rows: rows.map((row) => ({
      ...row,
      actorName: userMap.get(row.actorId)?.displayName ?? row.actorId,
      actorRole: userMap.get(row.actorId)?.role ?? null
    }))
  };
}
