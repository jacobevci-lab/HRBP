import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function boundedText(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const name = boundedText(body.name, 180, true);
  const riskLevel = boundedText(body.riskLevel, 40, true);
  const processingActivityId = boundedText(body.processingActivityId, 128);
  const dueAt = typeof body.dueAt === "string" && body.dueAt.trim() ? new Date(body.dueAt) : undefined;

  if (!name || !riskLevel || processingActivityId === null) {
    return Response.json({ error: "Valid name and riskLevel are required." }, { status: 400 });
  }
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return Response.json({ error: "dueAt must be a valid date." }, { status: 400 });
  }

  const data = await db.$transaction(async (tx) => {
    if (processingActivityId) {
      const activity = await tx.processingActivity.findFirst({
        where: { id: processingActivityId, tenantId: ctx.tenantId, active: true },
        select: { id: true }
      });
      if (!activity) throw new Error("ACTIVITY");
    }

    const assessment = await tx.privacyRiskAssessment.create({
      data: {
        tenantId: ctx.tenantId,
        processingActivityId,
        name,
        riskLevel: riskLevel.toUpperCase(),
        requiresDpia: body.requiresDpia === true,
        status: "OPEN",
        ownerId: ctx.actorId,
        dueAt
      }
    });

    await appendAudit(tx, ctx, {
      action: "privacy-assessment.created",
      resourceType: "PrivacyRiskAssessment",
      resourceId: assessment.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Privacy assurance assessment"
    });

    return assessment;
  }).catch((error) => error instanceof Error && error.message === "ACTIVITY" ? "ACTIVITY" as const : Promise.reject(error));

  if (data === "ACTIVITY") return Response.json({ error: "Processing activity not found in this tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
