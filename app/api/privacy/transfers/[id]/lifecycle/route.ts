import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type TransferAction = "SCHEDULE_REVIEW" | "COMPLETE_REVIEW" | "DEACTIVATE" | "REACTIVATE";
const actions: TransferAction[] = ["SCHEDULE_REVIEW", "COMPLETE_REVIEW", "DEACTIVATE", "REACTIVATE"];

function parsedDate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const { id } = await params;
  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() as TransferAction : undefined;
  if (!action || !actions.includes(action)) {
    return Response.json({ error: "action must be SCHEDULE_REVIEW, COMPLETE_REVIEW, DEACTIVATE or REACTIVATE." }, { status: 400 });
  }

  const nextDueAt = parsedDate(body.nextDueAt);
  if (nextDueAt === null) return Response.json({ error: "nextDueAt must be a valid date." }, { status: 400 });
  if ((action === "SCHEDULE_REVIEW" || action === "REACTIVATE") && (!nextDueAt || nextDueAt <= new Date())) {
    return Response.json({ error: "A future nextDueAt is required for this action." }, { status: 400 });
  }
  if (action === "COMPLETE_REVIEW" && nextDueAt && nextDueAt <= new Date()) {
    return Response.json({ error: "nextDueAt must be in the future when supplied." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const current = await tx.dataTransferRegister.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, active: true, transferImpactDueAt: true }
    });
    if (!current) throw new Error("NOT_FOUND");

    if (action === "SCHEDULE_REVIEW") {
      if (!current.active) throw new Error("STATE");
      const updated = await tx.dataTransferRegister.update({
        where: { id: current.id, active: current.active },
        data: { transferImpactDueAt: nextDueAt }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-transfer.review-scheduled",
        resourceType: "DataTransferRegister",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Transfer impact review scheduled"
      });
      return updated;
    }

    if (action === "COMPLETE_REVIEW") {
      if (!current.active || !current.transferImpactDueAt) throw new Error("STATE");
      const updated = await tx.dataTransferRegister.update({
        where: { id: current.id, active: current.active },
        data: { transferImpactDueAt: nextDueAt ?? null }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-transfer.review-completed",
        resourceType: "DataTransferRegister",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: nextDueAt ? "Transfer impact review completed and rescheduled" : "Transfer impact review completed"
      });
      return updated;
    }

    if (action === "DEACTIVATE") {
      if (!current.active) throw new Error("STATE");
      const updated = await tx.dataTransferRegister.update({
        where: { id: current.id, active: current.active },
        data: { active: false }
      });
      await appendAudit(tx, ctx, {
        action: "privacy-transfer.deactivated",
        resourceType: "DataTransferRegister",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Cross-border transfer deactivated"
      });
      return updated;
    }

    if (current.active) throw new Error("STATE");
    const updated = await tx.dataTransferRegister.update({
      where: { id: current.id, active: current.active },
      data: { active: true, transferImpactDueAt: nextDueAt }
    });
    await appendAudit(tx, ctx, {
      action: "privacy-transfer.reactivated",
      resourceType: "DataTransferRegister",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Cross-border transfer reactivated with review due date"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && error.message === "NOT_FOUND") return "NOT_FOUND" as const;
    if (error instanceof Error && error.message === "STATE") return "STATE" as const;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Transfer record not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "The requested transfer transition is not allowed from the current state." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Transfer state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
