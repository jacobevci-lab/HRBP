import { RequisitionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:read")) return forbidden();

  const data = await db.requisition.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      position: { select: { id: true, positionCode: true, title: true, location: true, orgUnit: { select: { id: true, name: true } } } },
      _count: { select: { applications: true } }
    }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const positionId = String(body.positionId ?? "").trim() || null;
  const openings = Number(body.openings ?? 1);
  if (!title || !Number.isInteger(openings) || openings < 1) return Response.json({ error: "title and a positive integer openings value are required." }, { status: 400 });

  const data = await db.requisition.create({ data: {
    tenantId: ctx.tenantId,
    positionId,
    title,
    openings,
    hiringManagerId: String(body.hiringManagerId ?? "").trim() || null,
    recruiterId: String(body.recruiterId ?? "").trim() || null,
    status: RequisitionStatus.DRAFT,
    targetHireDate: body.targetHireDate ? new Date(String(body.targetHireDate)) : null
  }});
  await recordAudit({ ctx, action: "REQUISITION_CREATED", resourceType: "Requisition", resourceId: data.id });
  return Response.json({ data }, { status: 201 });
}
