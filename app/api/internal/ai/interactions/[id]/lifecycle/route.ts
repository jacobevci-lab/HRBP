import { createHash } from "node:crypto";
import { AIInteractionStatus, DataClassification, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { internalBearerAuthorized } from "@/lib/internal-auth";

type ProcessorAction = "START" | "COMPLETE" | "BLOCK" | "FAIL";
const actions: ProcessorAction[] = ["START", "COMPLETE", "BLOCK", "FAIL"];
const terminalizable = new Set<AIInteractionStatus>([AIInteractionStatus.RECEIVED, AIInteractionStatus.PROCESSING]);

function boundedText(value: unknown, max: number) {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!internalBearerAuthorized(request, "HRBP_AI_PROCESSOR_TOKEN")) {
    return Response.json({ error: "Valid AI processor credentials are required." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() as ProcessorAction : undefined;
  if (!action || !actions.includes(action)) {
    return Response.json({ error: "action must be START, COMPLETE, BLOCK or FAIL." }, { status: 400 });
  }

  const modelProvider = boundedText(body.modelProvider, 120);
  const modelName = boundedText(body.modelName, 160);
  const blockedReason = boundedText(body.blockedReason, 1000);
  const failureReason = boundedText(body.failureReason, 1000);
  const response = boundedText(body.response, 32_000);

  if ([modelProvider, modelName, blockedReason, failureReason, response].some((value) => value === null)) {
    return Response.json({ error: "Processor metadata exceeds allowed bounds." }, { status: 400 });
  }
  if (action === "COMPLETE" && (!response || !modelProvider || !modelName)) {
    return Response.json({ error: "COMPLETE requires response, modelProvider and modelName." }, { status: 400 });
  }
  if (action === "BLOCK" && !blockedReason) {
    return Response.json({ error: "BLOCK requires blockedReason." }, { status: 400 });
  }
  if (action === "FAIL" && !failureReason) {
    return Response.json({ error: "FAIL requires failureReason." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const current = await tx.aIInteraction.findFirst({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        status: true,
        classification: true,
        actorId: true
      }
    });
    if (!current) throw new Error("NOT_FOUND");

    if (action === "START") {
      if (current.status !== AIInteractionStatus.RECEIVED) throw new Error("STATE");
      const updated = await tx.aIInteraction.update({
        where: { id: current.id },
        data: {
          status: AIInteractionStatus.PROCESSING,
          ...(modelProvider ? { modelProvider } : {}),
          ...(modelName ? { modelName } : {})
        }
      });
      await appendSystemAudit(tx, current.tenantId, "system:ai-processor", {
        action: "ai.interaction-processing",
        resourceType: "AIInteraction",
        resourceId: current.id,
        classification: current.classification,
        purpose: "AI processor accepted interaction"
      });
      return updated;
    }

    if (action === "COMPLETE") {
      if (current.status !== AIInteractionStatus.PROCESSING) throw new Error("STATE");
      const updated = await tx.aIInteraction.update({
        where: { id: current.id },
        data: {
          status: AIInteractionStatus.COMPLETED,
          modelProvider,
          modelName,
          responseHash: createHash("sha256").update(response!).digest("hex"),
          completedAt: new Date(),
          blockedReason: null
        }
      });
      await appendSystemAudit(tx, current.tenantId, "system:ai-processor", {
        action: "ai.interaction-completed",
        resourceType: "AIInteraction",
        resourceId: current.id,
        classification: current.classification,
        purpose: "Decision-support AI interaction completed"
      });
      return updated;
    }

    if (action === "BLOCK") {
      if (!terminalizable.has(current.status)) throw new Error("STATE");
      const updated = await tx.aIInteraction.update({
        where: { id: current.id },
        data: {
          status: AIInteractionStatus.BLOCKED,
          blockedReason: blockedReason!,
          ...(modelProvider ? { modelProvider } : {}),
          ...(modelName ? { modelName } : {}),
          completedAt: new Date()
        }
      });
      await appendSystemAudit(tx, current.tenantId, "system:ai-processor", {
        action: "ai.interaction-blocked",
        resourceType: "AIInteraction",
        resourceId: current.id,
        classification: current.classification,
        purpose: blockedReason!
      });
      return updated;
    }

    if (!terminalizable.has(current.status)) throw new Error("STATE");
    const updated = await tx.aIInteraction.update({
      where: { id: current.id },
      data: {
        status: AIInteractionStatus.FAILED,
        blockedReason: failureReason!,
        ...(modelProvider ? { modelProvider } : {}),
        ...(modelName ? { modelName } : {}),
        completedAt: new Date()
      }
    });
    await appendSystemAudit(tx, current.tenantId, "system:ai-processor", {
      action: "ai.interaction-failed",
      resourceType: "AIInteraction",
      resourceId: current.id,
      classification: DataClassification.INTERNAL,
      purpose: failureReason!
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && error.message === "NOT_FOUND") return "NOT_FOUND" as const;
    if (error instanceof Error && error.message === "STATE") return "STATE" as const;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "AI interaction not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested AI interaction transition is not allowed from the current state." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "AI interaction state changed concurrently. Refresh and retry." }, { status: 409 });

  return Response.json({
    data: {
      id: result.id,
      status: result.status,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      completedAt: result.completedAt,
      responseRecorded: Boolean(result.responseHash)
    },
    guardrails: {
      rawResponseRetained: false,
      decisionSupportOnly: result.decisionSupportOnly
    }
  });
}
