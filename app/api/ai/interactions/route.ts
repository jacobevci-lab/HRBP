import { createHash } from "node:crypto";
import { AIInteractionStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "ai:use")) return forbidden();
  const body = await request.json() as { prompt?: string; module?: string; purpose?: string; classification?: DataClassification; restrictedDataAccess?: boolean; sourceRefs?: unknown };
  const prompt = body.prompt?.trim();
  const moduleName = body.module?.trim();
  const purpose = body.purpose?.trim() || ctx.purpose;
  if (!prompt || !moduleName || !purpose) return Response.json({ error: "prompt, module and purpose are required." }, { status: 400 });
  const classification = body.classification && Object.values(DataClassification).includes(body.classification) ? body.classification : DataClassification.INTERNAL;
  if (classification === DataClassification.HIGHLY_RESTRICTED) return forbidden("Highly restricted employee relations data is excluded from the general AI assistant.");
  const data = await db.$transaction(async (tx) => {
    const interaction = await tx.aIInteraction.create({ data: { tenantId: ctx.tenantId, actorId: ctx.actorId, purpose, module: moduleName, status: AIInteractionStatus.RECEIVED, promptHash: createHash("sha256").update(prompt).digest("hex"), sourceRefs: body.sourceRefs as never, classification, restrictedDataAccess: Boolean(body.restrictedDataAccess), decisionSupportOnly: true } });
    await appendAudit(tx, ctx, { action: "ai.interaction-received", resourceType: "AIInteraction", resourceId: interaction.id, classification });
    return interaction;
  });
  return Response.json({ data, guardrails: { autonomousEmploymentDecision: false, rawPromptRetained: false } }, { status: 202 });
}
