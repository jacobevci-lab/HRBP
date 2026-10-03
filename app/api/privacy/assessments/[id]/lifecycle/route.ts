import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type AssessmentAction = "START" | "WAIT" | "COMPLETE" | "REOPEN";
const actions: AssessmentAction[] = ["START", "WAIT", "COMPLETE", "REOPEN"];
const terminalStatuses = new Set(["COMPLETED", "CLOSED"]);

function boundedText(value: unknown, max: number) {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (items.length !== value.length || items.some((item) => item.length > maxLength)) return null;
  return [...new Set(items)];
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const { id } = await params;
  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() as AssessmentAction : undefined;
  if (!action || !actions.includes(action)) {
    return Response.json({ error: "action must be START, WAIT, COMPLETE or REOPEN." }, { status: 400 });
  }

  const summary = boundedText(body.summary, 2000);
  const mitigations = stringList(body.mitigations, 30, 500);
  if (summary === null || mitigations === null) {
    return Response.json({ error: "Assessment findings exceed allowed bounds." }, { status: 400 });
  }
  if (action === "COMPLETE" && !summary) {
    return Response.json({ error: "COMPLETE requires a findings summary." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const current = await tx.privacyRiskAssessment.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, ownerId: true, riskLevel: true, requiresDpia: true }
    });
    if (!current) throw new Error("NOT_FOUND");
    if (current.ownerId !== ctx.actorId) throw new Error("OWNER");

    if (action === "START") {
      if (terminalStatuses.has(current.status.toUpperCase())) throw new Error("STATE");
      const updated = await tx.privacyRiskAssessment.update({
        where: { id: current.id, status: current.status },
        data: { status: "IN_PROGRESS", completedAt: null }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-assessment.started",
        resourceType: "PrivacyRiskAssessment",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Privacy assurance assessment started"
      });
      return updated;
    }

    if (action === "WAIT") {
      if (terminalStatuses.has(current.status.toUpperCase())) throw new Error("STATE");
      const updated = await tx.privacyRiskAssessment.update({
        where: { id: current.id, status: current.status },
        data: { status: "WAITING" }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-assessment.waiting",
        resourceType: "PrivacyRiskAssessment",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Privacy assurance assessment waiting on dependency"
      });
      return updated;
    }

    if (action === "COMPLETE") {
      if (terminalStatuses.has(current.status.toUpperCase())) throw new Error("STATE");
      const updated = await tx.privacyRiskAssessment.update({
        where: { id: current.id, status: current.status },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          findings: {
            summary,
            mitigations: mitigations ?? []
          } as Prisma.InputJsonValue
        }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-assessment.completed",
        resourceType: "PrivacyRiskAssessment",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: current.requiresDpia ? "DPIA completed" : "Privacy risk assessment completed"
      });
      return updated;
    }

    if (!terminalStatuses.has(current.status.toUpperCase())) throw new Error("STATE");
    const updated = await tx.privacyRiskAssessment.update({
      where: { id: current.id, status: current.status },
      data: { status: "IN_PROGRESS", completedAt: null }
    });
    await appendAudit(tx, ctx, {
      action: "privacy-assessment.reopened",
      resourceType: "PrivacyRiskAssessment",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Privacy assurance assessment reopened"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && error.message === "NOT_FOUND") return "NOT_FOUND" as const;
    if (error instanceof Error && error.message === "OWNER") return "OWNER" as const;
    if (error instanceof Error && error.message === "STATE") return "STATE" as const;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Privacy assessment not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the assessment owner may change its lifecycle.");
  if (result === "STATE") return Response.json({ error: "The requested assessment transition is not allowed from the current state." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Assessment state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
