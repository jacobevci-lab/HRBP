import { readJsonObject } from "@/lib/input-validation";
import { createHash } from "node:crypto";
import { AIInteractionStatus, DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit, appendSystemAudit } from "@/lib/audit";
import { dispatchAIInteraction } from "@/lib/ai-processor-dispatch";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_PROMPT_LENGTH = 12_000;
const MAX_SOURCE_REFS = 25;

function boundedText(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

function normalizeSourceRefs(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SOURCE_REFS) return null;
  const refs = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (refs.length !== value.length || refs.some((item) => item.length > 500)) return null;
  return [...new Set(refs)];
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "ai:use")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const prompt = boundedText(body.prompt, MAX_PROMPT_LENGTH, true);
  const moduleName = boundedText(body.module, 80, true);
  const purpose = boundedText(body.purpose, 240, true) ?? boundedText(ctx.purpose, 240, true);
  const sourceRefs = normalizeSourceRefs(body.sourceRefs);
  const classificationValue = typeof body.classification === "string" ? body.classification : undefined;
  const classification = classificationValue && Object.values(DataClassification).includes(classificationValue as DataClassification)
    ? classificationValue as DataClassification
    : DataClassification.INTERNAL;

  if (!prompt || !moduleName || !purpose || sourceRefs === null) {
    return Response.json({ error: "Valid prompt, module, purpose and bounded sourceRefs are required." }, { status: 400 });
  }
  if (classification === DataClassification.HIGHLY_RESTRICTED) {
    return forbidden("Highly restricted employee relations data is excluded from the general AI assistant.");
  }

  const data = await db.$transaction(async (tx) => {
    const interaction = await tx.aIInteraction.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        purpose,
        module: moduleName,
        status: AIInteractionStatus.RECEIVED,
        promptHash: createHash("sha256").update(prompt).digest("hex"),
        sourceRefs: sourceRefs as Prisma.InputJsonValue | undefined,
        classification,
        restrictedDataAccess: Boolean(body.restrictedDataAccess),
        decisionSupportOnly: true
      }
    });
    await appendAudit(tx, ctx, {
      action: "ai.interaction-received",
      resourceType: "AIInteraction",
      resourceId: interaction.id,
      classification,
      purpose
    });
    return interaction;
  });

  const dispatch = await dispatchAIInteraction({
    interactionId: data.id,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    prompt,
    module: moduleName,
    purpose,
    classification,
    restrictedDataAccess: Boolean(body.restrictedDataAccess),
    sourceRefs
  });

  if (!dispatch.dispatched) {
    const failed = await db.$transaction(async (tx) => {
      const updated = await tx.aIInteraction.update({
        where: { id: data.id },
        data: {
          status: AIInteractionStatus.FAILED,
          blockedReason: dispatch.reason,
          completedAt: new Date()
        }
      });
      await appendSystemAudit(tx, ctx.tenantId, "system:ai-dispatch", {
        action: "ai.interaction-dispatch-failed",
        resourceType: "AIInteraction",
        resourceId: data.id,
        classification,
        purpose: dispatch.reason
      });
      return updated;
    });

    return Response.json({
      error: "AI processor dispatch failed.",
      data: { id: failed.id, status: failed.status },
      retryable: ["PROCESSOR_TIMEOUT", "PROCESSOR_UNAVAILABLE"].includes(dispatch.reason)
    }, { status: 503 });
  }

  if (dispatch.mode === "sync") {
    const completed = await db.$transaction(async (tx) => {
      const updated = await tx.aIInteraction.update({
        where: { id: data.id },
        data: {
          status: AIInteractionStatus.COMPLETED,
          modelProvider: dispatch.completed.modelProvider,
          modelName: dispatch.completed.modelName,
          responseHash: createHash("sha256").update(dispatch.completed.response).digest("hex"),
          completedAt: new Date()
        }
      });
      await appendSystemAudit(tx, ctx.tenantId, "system:ai-processor", {
        action: "ai.interaction-completed",
        resourceType: "AIInteraction",
        resourceId: data.id,
        classification,
        purpose: "Synchronous decision-support AI completion"
      });
      return updated;
    });

    return Response.json({
      data: {
        id: completed.id,
        status: completed.status,
        response: dispatch.completed.response,
        modelProvider: completed.modelProvider,
        modelName: completed.modelName
      },
      dispatch: { accepted: true, mode: "sync" },
      guardrails: {
        autonomousEmploymentDecision: false,
        rawPromptRetained: false,
        rawResponseRetained: false,
        highlyRestrictedAllowed: false
      }
    });
  }

  return Response.json({
    data,
    dispatch: { accepted: true, mode: "async" },
    guardrails: {
      autonomousEmploymentDecision: false,
      rawPromptRetained: false,
      rawResponseRetained: false,
      highlyRestrictedAllowed: false
    }
  }, { status: 202 });
}
