import { AccessRevocationStatus, DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<AccessRevocationStatus, AccessRevocationStatus[]> = {
  PENDING: [AccessRevocationStatus.SCHEDULED, AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION],
  SCHEDULED: [AccessRevocationStatus.REVOKED, AccessRevocationStatus.EXCEPTION],
  REVOKED: [],
  EXCEPTION: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string; accessId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const route = await params;
  const processId = asIdentifier(route.id);
  const accessId = asIdentifier(route.accessId);
  if (!processId || !accessId) return Response.json({ error: "Valid separation process and access-control ids are required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(AccessRevocationStatus));
  const exceptionReason = asOptionalText(body.exceptionReason, 1000);
  const scheduledAt = body.scheduledAt === undefined || body.scheduledAt === null || body.scheduledAt === "" ? undefined : asDate(body.scheduledAt);
  if (!next) return Response.json({ error: "A valid access revocation status is required." }, { status: 400 });
  if (exceptionReason === null) return Response.json({ error: "exceptionReason must be 1000 characters or fewer." }, { status: 400 });
  if (body.scheduledAt !== undefined && body.scheduledAt !== null && body.scheduledAt !== "" && !scheduledAt) return Response.json({ error: "scheduledAt must be a valid date/time." }, { status: 400 });
  if (next === AccessRevocationStatus.SCHEDULED && !scheduledAt) return Response.json({ error: "Scheduling access revocation requires scheduledAt." }, { status: 400 });
  if (next === AccessRevocationStatus.EXCEPTION && !exceptionReason) return Response.json({ error: "Access revocation exceptions require an explicit reason." }, { status: 400 });

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
      if (next === AccessRevocationStatus.SCHEDULED && scheduledAt && scheduledAt > new Date(process.lastWorkingDate.getTime() + 24 * 60 * 60 * 1000)) throw new Error("SCHEDULE_AFTER_EXIT");

      const access = await tx.accessRevocation.findFirst({
        where: { id: accessId, tenantId: ctx.tenantId, processId },
        select: { id: true, status: true, systemName: true }
      });
      if (!access) throw new Error("ACCESS_NOT_FOUND");
      if (!transitions[access.status].includes(next)) throw new Error("INVALID_TRANSITION");

      const now = new Date();
      const terminal = next === AccessRevocationStatus.REVOKED || next === AccessRevocationStatus.EXCEPTION;
      const updated = await tx.accessRevocation.updateMany({
        where: { id: access.id, tenantId: ctx.tenantId, processId, status: access.status },
        data: {
          status: next,
          scheduledAt: next === AccessRevocationStatus.SCHEDULED ? scheduledAt : undefined,
          revokedAt: next === AccessRevocationStatus.REVOKED ? now : null,
          verifiedById: terminal ? ctx.actorId : null,
          exceptionReason: next === AccessRevocationStatus.EXCEPTION ? exceptionReason : null
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: `offboarding.access-${access.status.toLowerCase()}-to-${next.toLowerCase()}`,
        resourceType: "AccessRevocation",
        resourceId: access.id,
        classification: DataClassification.RESTRICTED,
        purpose: exceptionReason ? `Exit access transition; ${exceptionReason}` : "Exit access transition"
      });
      return { id: access.id, status: next, processId, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot change access controls." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "ACCESS_NOT_FOUND") return Response.json({ error: "Access revocation record not found." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested access revocation transition is not allowed." }, { status: 409 });
    if (code === "SCHEDULE_AFTER_EXIT") return Response.json({ error: "Scheduled access revocation cannot be later than one day after the governed last working date." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Access or separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Access state changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding access transition failed", error);
    return Response.json({ error: "Access revocation status could not be changed." }, { status: 500 });
  }
}
