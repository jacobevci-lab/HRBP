import { DataClassification, PlatformRole, VaultScanStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import type { RequestContext } from "@/lib/request-context";

const finalScanStatuses = [VaultScanStatus.CLEAN, VaultScanStatus.QUARANTINED, VaultScanStatus.FAILED] as const;

function scannerContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:document-scanner",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Malware scanning callback"
  };
}

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_DOCUMENT_SCAN_TOKEN")) {
    return Response.json({ error: "Valid document scanner credentials are required." }, { status: 401 });
  }
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const versionId = asIdentifier(body.versionId);
  const status = asEnumValue(body.status, finalScanStatuses);
  const engine = asText(body.engine, 100);
  const reference = asOptionalText(body.reference, 200);
  const message = asOptionalText(body.message, 500);
  if (!versionId || !status || !engine || reference === null || message === null) {
    return Response.json({ error: "versionId, status CLEAN|QUARANTINED|FAILED and engine are required; reference/message must be plain text when supplied." }, { status: 400 });
  }

  const data = await db.$transaction(async (tx) => {
    const current = await tx.documentVersion.findUnique({ where: { id: versionId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!current.uploadedAt) throw new Error("NOT_UPLOADED");
    const now = new Date();
    const updated = await tx.documentVersion.update({
      where: { id: current.id },
      data: {
        scanStatus: status,
        scanCompletedAt: now,
        scanEngine: engine,
        scanReference: reference || null,
        scanMessage: message || null
      }
    });
    await appendAudit(tx, scannerContext(current.tenantId), {
      action: `document.scan-${status.toLowerCase()}`,
      resourceType: "DocumentVersion",
      resourceId: current.id,
      classification: current.classification ?? DataClassification.RESTRICTED,
      purpose: `${engine}${reference ? ` · ${reference}` : ""}${message ? ` · ${message}` : ""}`
    });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "NOT_UPLOADED"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Document version not found." }, { status: 404 });
  if (data === "NOT_UPLOADED") return Response.json({ error: "Document object must be uploaded before scan completion can be recorded." }, { status: 409 });
  return Response.json({ data });
}
