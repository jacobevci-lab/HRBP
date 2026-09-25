import { DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const assetTag = asText(body.assetTag, 100);
  const assetType = asText(body.assetType, 120);
  const serialNumber = asOptionalText(body.serialNumber, 160);
  const conditionNote = asOptionalText(body.conditionNote, 500);
  if (!assetTag || !assetType) return Response.json({ error: "assetTag and assetType are required and must be within allowed lengths." }, { status: 400 });
  if (serialNumber === null || conditionNote === null) return Response.json({ error: "Asset metadata exceeds the allowed length." }, { status: 400 });

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

      const asset = await tx.assetReturn.create({
        data: { tenantId: ctx.tenantId, processId, assetTag, assetType, serialNumber, conditionNote }
      });
      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: "offboarding.asset-registered",
        resourceType: "AssetReturn",
        resourceId: asset.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Exit asset custody registered: ${assetType}`
      });
      return { ...asset, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot receive assets." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "This asset tag is already registered in the separation process." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent separation change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding asset registration failed", error);
    return Response.json({ error: "Asset could not be registered for return." }, { status: 500 });
  }
}
