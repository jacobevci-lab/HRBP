import { DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const eligible = typeof body.eligible === "boolean" ? body.eligible : null;
  if (eligible === null) return Response.json({ error: "eligible must be an explicit boolean human decision." }, { status: 400 });
  const reason = asText(body.reason, 2000);
  if (!reason || reason.length < 10) return Response.json({ error: "A decision reason of at least 10 and at most 2000 characters is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, status: true, updatedAt: true, rehireEligible: true }
      });
      if (!process) throw new Error("PROCESS_NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED) throw new Error("PROCESS_CLOSED");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const now = new Date();
      const updated = await tx.separationProcess.updateMany({
        where: { id: process.id, tenantId: ctx.tenantId, status: process.status, updatedAt: process.updatedAt },
        data: {
          rehireEligible: eligible,
          rehireDecisionReason: reason,
          rehireDecisionById: ctx.actorId,
          rehireDecisionAt: now
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");
      await appendAudit(tx, ctx, {
        action: process.rehireEligible === null ? "offboarding.rehire-decision-set" : "offboarding.rehire-decision-revised",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Explicit human rehire eligibility decision: ${eligible ? "eligible" : "not eligible"}; previous=${process.rehireEligible === null ? "unset" : process.rehireEligible ? "eligible" : "not eligible"}`
      });
      return { id: process.id, rehireEligible: eligible, rehireDecisionReason: reason, rehireDecisionById: ctx.actorId, rehireDecisionAt: now };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot change rehire eligibility from this workflow." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation changed concurrently. Refresh and review the latest human decision before retrying." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "A concurrent separation change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding rehire decision failed", error);
    return Response.json({ error: "Rehire eligibility decision could not be saved." }, { status: 500 });
  }
}
