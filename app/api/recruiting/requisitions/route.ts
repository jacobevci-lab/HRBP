import { DataClassification, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { recruitingRequisitionReadFilter } from "@/lib/recruiting-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:read")) return forbidden();

  const data = await withDb((db) => db.requisition.findMany({
    where: recruitingRequisitionReadFilter(ctx),
    orderBy: { createdAt: "desc" },
    include: {
      position: { select: { id: true, positionCode: true, title: true, location: true, orgUnit: { select: { id: true, name: true } } } },
      _count: { select: { applications: true } }
    }
  }));
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  const positionId = String(body.positionId ?? "").trim() || null;
  const hiringManagerId = String(body.hiringManagerId ?? "").trim() || null;
  const recruiterId = String(body.recruiterId ?? "").trim() || null;
  const openings = Number(body.openings ?? 1);
  const targetHireDate = body.targetHireDate ? new Date(String(body.targetHireDate)) : null;

  if (!title || !Number.isInteger(openings) || openings < 1) return Response.json({ error: "title and a positive integer openings value are required." }, { status: 400 });
  if (targetHireDate && Number.isNaN(targetHireDate.getTime())) return Response.json({ error: "targetHireDate must be a valid date." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      if (positionId) {
        const position = await tx.position.findFirst({ where: { id: positionId, tenantId: ctx.tenantId }, select: { id: true } });
        if (!position) throw new Error("POSITION_NOT_FOUND");
      }

      const userIds = [...new Set([hiringManagerId, recruiterId].filter((value): value is string => Boolean(value)))];
      if (userIds.length) {
        const validUsers = await tx.userAccount.count({ where: { tenantId: ctx.tenantId, id: { in: userIds }, active: true } });
        if (validUsers !== userIds.length) throw new Error("USER_NOT_FOUND");
      }

      const requisition = await tx.requisition.create({ data: {
        tenantId: ctx.tenantId,
        positionId,
        title,
        openings,
        hiringManagerId,
        recruiterId,
        status: RequisitionStatus.DRAFT,
        targetHireDate
      }});

      await appendAudit(tx, ctx, {
        action: "REQUISITION_CREATED",
        resourceType: "Requisition",
        resourceId: requisition.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Hiring requisition creation"
      });
      return requisition;
    }));
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "POSITION_NOT_FOUND") return Response.json({ error: "Position was not found in this tenant." }, { status: 404 });
    if (code === "USER_NOT_FOUND") return Response.json({ error: "Hiring manager or recruiter is not an active user in this tenant." }, { status: 400 });
    console.error("Requisition creation failed", error);
    return Response.json({ error: "Requisition could not be created." }, { status: 500 });
  }
}
