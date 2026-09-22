import { DataClassification, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { canTransitionRequisition, parseRequisitionStatus } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid requisition id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseRequisitionStatus(body.status);
  if (!next) return Response.json({ error: "A valid requisition status is required." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.requisition.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, positionId: true, openings: true, openedAt: true }
      });
      if (!current) throw new Error("REQUISITION_NOT_FOUND");
      if (!canTransitionRequisition(current.status, next)) throw new Error("INVALID_TRANSITION");
      if (next === RequisitionStatus.OPEN && !current.positionId) throw new Error("POSITION_REQUIRED");

      try {
        await tx.requisition.update({
          where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
          data: {
            status: next,
            openedAt: next === RequisitionStatus.OPEN && !current.openedAt ? new Date() : current.openedAt
          }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      await appendAudit(tx, ctx, {
        action: `REQUISITION_STATUS_${current.status}_TO_${next}`,
        resourceType: "Requisition",
        resourceId: current.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Hiring requisition lifecycle"
      });

      return { id: current.id, status: next };
    }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "REQUISITION_NOT_FOUND") return Response.json({ error: "Requisition was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested requisition-status transition is not allowed." }, { status: 409 });
    if (code === "POSITION_REQUIRED") return Response.json({ error: "A requisition must be linked to a position before it can be opened." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The requisition changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Requisition status transition failed", error);
    return Response.json({ error: "Requisition status could not be changed." }, { status: 500 });
  }
}
