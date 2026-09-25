import { AssetReturnStatus, DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<AssetReturnStatus, AssetReturnStatus[]> = {
  PENDING: [AssetReturnStatus.RETURNED, AssetReturnStatus.DAMAGED, AssetReturnStatus.LOST, AssetReturnStatus.WRITTEN_OFF],
  DAMAGED: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF],
  LOST: [AssetReturnStatus.RETURNED, AssetReturnStatus.WRITTEN_OFF],
  RETURNED: [],
  WRITTEN_OFF: []
};

function requiresReason(status: AssetReturnStatus) {
  return status === AssetReturnStatus.DAMAGED || status === AssetReturnStatus.LOST || status === AssetReturnStatus.WRITTEN_OFF;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const route = await params;
  const processId = asIdentifier(route.id);
  const assetId = asIdentifier(route.assetId);
  if (!processId || !assetId) return Response.json({ error: "Valid separation process and asset ids are required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(AssetReturnStatus));
  const conditionNote = asOptionalText(body.conditionNote, 500);
  if (!next) return Response.json({ error: "A valid asset return status is required." }, { status: 400 });
  if (conditionNote === null) return Response.json({ error: "conditionNote must be 500 characters or fewer." }, { status: 400 });
  if (requiresReason(next) && !conditionNote) return Response.json({ error: "Damaged, lost or written-off assets require a condition reason." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: { id: true, status: true, employmentId: true }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const asset = await tx.assetReturn.findFirst({
        where: { id: assetId, tenantId: ctx.tenantId, processId },
        select: { id: true, status: true, assetTag: true, assetType: true }
      });
      if (!asset) throw new Error("ASSET_NOT_FOUND");
      if (!transitions[asset.status].includes(next)) throw new Error("INVALID_TRANSITION");
      const terminal = next === AssetReturnStatus.RETURNED || next === AssetReturnStatus.WRITTEN_OFF;
      const now = new Date();
      const updated = await tx.assetReturn.updateMany({
        where: { id: asset.id, tenantId: ctx.tenantId, processId, status: asset.status },
        data: {
          status: next,
          conditionNote,
          returnedAt: terminal ? now : null,
          verifiedById: terminal ? ctx.actorId : null
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: `offboarding.asset-${asset.status.toLowerCase()}-to-${next.toLowerCase()}`,
        resourceType: "AssetReturn",
        resourceId: asset.id,
        classification: DataClassification.RESTRICTED,
        purpose: conditionNote ? `Exit asset custody transition; ${conditionNote}` : "Exit asset custody transition"
      });
      return { id: asset.id, status: next, processId, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot change assets." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "ASSET_NOT_FOUND") return Response.json({ error: "Asset return record not found." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested asset return transition is not allowed." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Asset or separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Asset state changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding asset transition failed", error);
    return Response.json({ error: "Asset return status could not be changed." }, { status: 500 });
  }
}
