import { DataClassification, EmploymentStatus, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const recipientStatuses: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const title = asText(body.title, 180);
  const description = asOptionalText(body.description, 2000);
  const recipientId = asIdentifier(body.recipientId);
  const dueAtInput = body.dueAt === undefined || body.dueAt === null || body.dueAt === "" ? undefined : asDate(body.dueAt);
  if (!title || !recipientId) return Response.json({ error: "title and recipientId are required." }, { status: 400 });
  if (description === null) return Response.json({ error: "description must be 2000 characters or fewer." }, { status: 400 });
  if (body.dueAt && !dueAtInput) return Response.json({ error: "dueAt must be a valid date." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: { id: true, status: true, employmentId: true, lastWorkingDate: true }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (recipientId === process.employmentId) throw new Error("SELF_RECIPIENT");
      if (!canActOnEmployment(scope, recipientId)) throw new Error("RECIPIENT_OUT_OF_SCOPE");

      const recipient = await tx.employment.findFirst({
        where: { id: recipientId, tenantId: ctx.tenantId, status: { in: recipientStatuses } },
        select: { id: true }
      });
      if (!recipient) throw new Error("RECIPIENT_NOT_FOUND");
      const dueAt = dueAtInput ?? process.lastWorkingDate;
      if (dueAt > process.lastWorkingDate) throw new Error("DUE_AFTER_EXIT");

      const transfer = await tx.knowledgeTransfer.create({
        data: { tenantId: ctx.tenantId, processId, title, description, recipientId: recipient.id, dueAt }
      });
      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: "offboarding.knowledge-transfer-created",
        resourceType: "KnowledgeTransfer",
        resourceId: transfer.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Human-owned knowledge transfer requirement added to exit readiness"
      });
      return { ...transfer, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot receive knowledge transfers." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "RECIPIENT_OUT_OF_SCOPE") return forbidden("Knowledge-transfer recipient is outside your authorized relationship scope.");
    if (code === "SELF_RECIPIENT") return Response.json({ error: "The departing employment cannot be its own knowledge-transfer recipient." }, { status: 400 });
    if (code === "RECIPIENT_NOT_FOUND") return Response.json({ error: "An active knowledge-transfer recipient was not found." }, { status: 404 });
    if (code === "DUE_AFTER_EXIT") return Response.json({ error: "Knowledge transfer must be due on or before the last working date." }, { status: 400 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent separation change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding knowledge transfer creation failed", error);
    return Response.json({ error: "Knowledge transfer could not be created." }, { status: 500 });
  }
}
