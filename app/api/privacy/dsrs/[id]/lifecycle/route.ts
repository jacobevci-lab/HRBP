import { DataClassification, DSRStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type DSRAction = "BEGIN_VERIFICATION" | "VERIFY" | "WAIT" | "RESUME" | "COMPLETE" | "REJECT" | "CANCEL";
const actions: DSRAction[] = ["BEGIN_VERIFICATION", "VERIFY", "WAIT", "RESUME", "COMPLETE", "REJECT", "CANCEL"];

function nextStatus(current: DSRStatus, action: DSRAction) {
  if (action === "BEGIN_VERIFICATION" && current === DSRStatus.RECEIVED) return DSRStatus.IDENTITY_VERIFICATION;
  if (action === "VERIFY" && current === DSRStatus.IDENTITY_VERIFICATION) return DSRStatus.IN_PROGRESS;
  if (action === "WAIT" && current === DSRStatus.IN_PROGRESS) return DSRStatus.WAITING;
  if (action === "RESUME" && current === DSRStatus.WAITING) return DSRStatus.IN_PROGRESS;
  if (action === "COMPLETE" && (current === DSRStatus.IN_PROGRESS || current === DSRStatus.WAITING)) return DSRStatus.COMPLETED;
  if (action === "REJECT" && ![DSRStatus.COMPLETED, DSRStatus.REJECTED, DSRStatus.CANCELLED].includes(current)) return DSRStatus.REJECTED;
  if (action === "CANCEL" && ![DSRStatus.COMPLETED, DSRStatus.REJECTED, DSRStatus.CANCELLED].includes(current)) return DSRStatus.CANCELLED;
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid DSR id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const action = asEnumValue(body.action, actions);
  if (!action) return Response.json({ error: "A valid DSR lifecycle action is required." }, { status: 400 });
  const rejectionReason = action === "REJECT" ? asText(body.reason, 2000) : undefined;
  if (action === "REJECT" && !rejectionReason) return Response.json({ error: "reason is required when rejecting a DSR." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.dataSubjectRequest.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, ownerId: true, verifiedAt: true }
    });
    if (!current) throw new Error("NOT_FOUND");
    if (!current.ownerId || current.ownerId !== ctx.actorId) throw new Error("OWNER");
    const status = nextStatus(current.status, action);
    if (!status) throw new Error("STATE");
    const now = new Date();

    const updated = await tx.dataSubjectRequest.update({
      where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
      data: {
        status,
        verifiedAt: action === "VERIFY" ? now : current.verifiedAt,
        completedAt: action === "COMPLETE" ? now : null,
        rejectionReason: action === "REJECT" ? rejectionReason : null
      }
    });

    await appendAudit(tx, ctx, {
      action: `privacy.dsr-${action.toLowerCase()}`,
      resourceType: "DataSubjectRequest",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Owner-bound DSR lifecycle transition"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "DSR not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the assigned DSR owner may perform lifecycle transitions.");
  if (result === "STATE") return Response.json({ error: "The requested DSR transition is not allowed from the current state." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "DSR state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
