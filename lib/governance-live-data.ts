import { DataClassification, DocumentStatus, Prisma } from "@prisma/client";
import { withDb } from "@/lib/db";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(date);
}

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export type LiveDocumentRow = {
  id: string;
  fileName: string;
  owner: string;
  purpose: string;
  classification: string;
  status: string;
  legalHold: boolean;
  retention: string;
  expires: string;
  created: string;
};

export async function getDocumentWorkspaceData(tenantId: string, includeHighlyRestricted: boolean, query = "") {
  return withDb(async (db) => {
    const now = new Date();
    const next30 = new Date(now);
    next30.setUTCDate(next30.getUTCDate() + 30);
    const baseWhere: Prisma.DocumentRecordWhereInput = {
      tenantId,
      status: { not: DocumentStatus.DELETED },
      ...(includeHighlyRestricted ? {} : { classification: { not: DataClassification.HIGHLY_RESTRICTED } })
    };
    const normalized = query.trim();
    const rowWhere: Prisma.DocumentRecordWhereInput = normalized
      ? { ...baseWhere, OR: [{ fileName: { contains: normalized, mode: "insensitive" } }, { purpose: { contains: normalized, mode: "insensitive" } }, { person: { is: { OR: [{ givenName: { contains: normalized, mode: "insensitive" } }, { familyName: { contains: normalized, mode: "insensitive" } }] } } }] }
      : baseWhere;

    const [total, restricted, expiring, legalHold, rows] = await Promise.all([
      db.documentRecord.count({ where: baseWhere }),
      db.documentRecord.count({ where: { ...baseWhere, classification: { in: includeHighlyRestricted ? [DataClassification.RESTRICTED, DataClassification.HIGHLY_RESTRICTED] : [DataClassification.RESTRICTED] } } }),
      db.documentRecord.count({ where: { ...baseWhere, expiresAt: { gte: now, lte: next30 } } }),
      db.documentRecord.count({ where: { ...baseWhere, legalHold: true } }),
      db.documentRecord.findMany({
        where: rowWhere,
        orderBy: { createdAt: "desc" },
        take: 150,
        select: {
          id: true, fileName: true, purpose: true, classification: true, status: true, legalHold: true,
          retentionUntil: true, expiresAt: true, createdAt: true,
          person: { select: { givenName: true, familyName: true } }
        }
      })
    ]);

    return {
      total,
      restricted,
      expiring,
      legalHold,
      rows: rows.map<LiveDocumentRow>((row) => ({
        id: row.id,
        fileName: row.fileName,
        owner: row.person ? `${row.person.givenName} ${row.person.familyName}` : "Shared / case scoped",
        purpose: row.purpose,
        classification: enumLabel(row.classification),
        status: enumLabel(row.status),
        legalHold: row.legalHold,
        retention: row.retentionUntil ? formatDate(row.retentionUntil) : "Policy managed",
        expires: row.expiresAt ? formatDate(row.expiresAt) : "—",
        created: formatDate(row.createdAt)
      }))
    };
  });
}

export type LiveAuditRow = {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  purpose: string;
  classification: string;
  ipAddress: string;
  occurredAt: string;
  chained: boolean;
};

export async function getAuditWorkspaceData(tenantId: string, query = "") {
  return withDb(async (db) => {
    const normalized = query.trim();
    const where: Prisma.AuditEventWhereInput = {
      tenantId,
      ...(normalized ? {
        OR: [
          { actorId: { contains: normalized, mode: "insensitive" } },
          { action: { contains: normalized, mode: "insensitive" } },
          { resourceType: { contains: normalized, mode: "insensitive" } },
          { resourceId: { contains: normalized, mode: "insensitive" } },
          { purpose: { contains: normalized, mode: "insensitive" } }
        ]
      } : {})
    };
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [today, privilegedReads, rows, total] = await Promise.all([
      db.auditEvent.count({ where: { tenantId, occurredAt: { gte: startOfDay } } }),
      db.auditEvent.count({ where: { tenantId, occurredAt: { gte: startOfDay }, action: { contains: "VIEW", mode: "insensitive" }, classification: { in: [DataClassification.RESTRICTED, DataClassification.HIGHLY_RESTRICTED] } } }),
      db.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 250 }),
      db.auditEvent.count({ where: { tenantId } })
    ]);

    return {
      today,
      privilegedReads,
      total,
      rows: rows.map<LiveAuditRow>((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        purpose: row.purpose ?? "Not declared",
        classification: enumLabel(row.classification),
        ipAddress: row.ipAddress ?? "—",
        occurredAt: formatDateTime(row.occurredAt),
        chained: Boolean(row.hash)
      }))
    };
  });
}
