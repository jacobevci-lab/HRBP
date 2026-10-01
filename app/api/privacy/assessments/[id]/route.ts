import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const terminalStatuses = new Set(["COMPLETED", "CLOSED"]);

function boundedText(value: unknown, max: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function parsedDate(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return Number.NaN;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NaN : date;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const name = boundedText(body.name, 180);
  const riskLevel = boundedText(body.riskLevel, 40);
  const processingActivityId = boundedText(body.processingActivityId, 128);
  const dueAt = parsedDate(body.dueAt);

  if (name === null || riskLevel === null || Number.isNaN(dueAt)) {
    return Response.json({ error: "Invalid privacy assessment values." }, { status: 400 });
  }
  if (body.processingActivityId !== undefined && body.processingActivityId !== null && !processingActivityId) {
    return Response.json({ error: "processingActivityId is invalid." }, { status: 400 });
  }
  if (body.requiresDpia !== undefined && typeof body.requiresDpia !== "boolean") {
    return Response.json({ error: "requiresDpia must be boolean." }, { status: 400 });
  }

  const hasChange = body.name !== undefined
    || body.riskLevel !== undefined
    || body.processingActivityId !== undefined
    || body.dueAt !== undefined
    || body.requiresDpia !== undefined;
  if (!hasChange) return Response.json({ error: "At least one editable field is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.privacyRiskAssessment.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, ownerId: true, status: true }
    });
    if (!current) throw new Error("NOT_FOUND");
    if (current.ownerId !== ctx.actorId) throw new Error("OWNER");
    if (terminalStatuses.has(current.status.toUpperCase())) throw new Error("STATE");

    if (processingActivityId) {
      const activity = await tx.processingActivity.findFirst({
        where: { id: processingActivityId, tenantId: ctx.tenantId, active: true },
        select: { id: true }
      });
      if (!activity) throw new Error("ACTIVITY");
    }

    const data: Prisma.PrivacyRiskAssessmentUncheckedUpdateInput = {};
    if (name !== undefined) data.name = name!;
    if (riskLevel !== undefined) data.riskLevel = riskLevel!.toUpperCase();
    if (body.requiresDpia !== undefined) data.requiresDpia = body.requiresDpia as boolean;
    if (body.processingActivityId !== undefined) data.processingActivityId = processingActivityId ?? null;
    if (body.dueAt !== undefined) data.dueAt = dueAt instanceof Date ? dueAt : null;

    const updated = await tx.privacyRiskAssessment.update({
      where: { id: current.id, status: current.status },
      data
    });
    await appendAudit(tx, ctx, {
      action: "privacy-assessment.updated",
      resourceType: "PrivacyRiskAssessment",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Privacy assurance assessment metadata updated"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE", "ACTIVITY"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Privacy assessment not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the assessment owner may edit it.");
  if (result === "STATE") return Response.json({ error: "Completed or closed assessments must be reopened before editing." }, { status: 409 });
  if (result === "ACTIVITY") return Response.json({ error: "Processing activity not found in this tenant." }, { status: 404 });
  if (result === "CONFLICT") return Response.json({ error: "Assessment state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
