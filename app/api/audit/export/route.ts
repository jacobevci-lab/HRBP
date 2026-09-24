import { DataClassification, Prisma } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

function safeCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function classification(value: string | null): DataClassification | undefined {
  return value && Object.values(DataClassification).includes(value as DataClassification) ? value as DataClassification : undefined;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "audit:read")) return forbidden();

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const actorId = (url.searchParams.get("actor") ?? "").trim().slice(0, 191);
  const resourceType = (url.searchParams.get("resource") ?? "").trim().slice(0, 120);
  const classFilter = classification(url.searchParams.get("classification"));
  const requestedDays = Number(url.searchParams.get("days") ?? 30);
  const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(1, Math.floor(requestedDays))) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where: Prisma.AuditEventWhereInput = {
    tenantId: ctx.tenantId,
    occurredAt: { gte: since },
    ...(actorId ? { actorId } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(classFilter ? { classification: classFilter } : {}),
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

  const rows = await db.auditEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 5000,
    select: {
      id: true, actorId: true, action: true, resourceType: true, resourceId: true,
      purpose: true, classification: true, ipAddress: true, occurredAt: true,
      hash: true, previousHash: true
    }
  });

  const header = ["id", "occurredAt", "actorId", "action", "resourceType", "resourceId", "classification", "ipAddress", "purpose", "hash", "previousHash"];
  const lines = [header.map(safeCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.id,
      row.occurredAt.toISOString(),
      row.actorId,
      row.action,
      row.resourceType,
      row.resourceId,
      row.classification,
      row.ipAddress,
      row.purpose,
      row.hash,
      row.previousHash
    ].map(safeCell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hrbp-audit-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
