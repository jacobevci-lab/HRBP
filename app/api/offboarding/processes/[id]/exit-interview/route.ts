import { DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseReasons(value: unknown) {
  if (value === undefined || value === null) return [] as string[];
  if (!Array.isArray(value) || value.length > 10) return null;
  const reasons: string[] = [];
  for (const item of value) {
    const reason = asText(item, 120);
    if (!reason) return null;
    reasons.push(reason);
  }
  return reasons;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const reasons = parseReasons(body.reasons);
  const comments = asOptionalText(body.comments, 4000);
  const conductedAt = body.conductedAt ? asDate(body.conductedAt) : new Date();
  const wouldRecommend = body.wouldRecommend === undefined || body.wouldRecommend === null ? undefined : typeof body.wouldRecommend === "boolean" ? body.wouldRecommend : null;
  if (!reasons) return Response.json({ error: "reasons must contain at most 10 non-empty entries of 120 characters or fewer." }, { status: 400 });
  if (comments === null) return Response.json({ error: "comments must be 4000 characters or fewer." }, { status: 400 });
  if (!conductedAt) return Response.json({ error: "conductedAt must be a valid date." }, { status: 400 });
  if (wouldRecommend === null) return Response.json({ error: "wouldRecommend must be a boolean when supplied." }, { status: 400 });
  if (!reasons.length && !comments) return Response.json({ error: "At least one interview reason or a comment is required." }, { status: 400 });
  if (conductedAt.getTime() > Date.now() + 5 * 60 * 1000) return Response.json({ error: "Exit interview cannot be recorded in the future." }, { status: 400 });

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
      const existing = await tx.exitInterview.findUnique({ where: { processId }, select: { id: true } });
      if (existing) throw new Error("INTERVIEW_EXISTS");

      const interview = await tx.exitInterview.create({
        data: {
          tenantId: ctx.tenantId,
          processId,
          interviewerId: ctx.actorId,
          conductedAt,
          reasons,
          comments,
          wouldRecommend,
          classification: DataClassification.CONFIDENTIAL
        }
      });
      await appendAudit(tx, ctx, {
        action: "offboarding.exit-interview-recorded",
        resourceType: "ExitInterview",
        resourceId: interview.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Human-recorded exit interview; feedback remains separate from rehire eligibility decision"
      });
      return interview;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot receive an exit interview." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "INTERVIEW_EXISTS") return Response.json({ error: "An exit interview is already recorded for this separation." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "An exit interview is already recorded for this separation." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent separation change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding exit interview creation failed", error);
    return Response.json({ error: "Exit interview could not be recorded." }, { status: 500 });
  }
}
