import { DataClassification, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
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
  const systemName = asText(body.systemName, 160);
  const accountId = asOptionalText(body.accountId, 240);
  if (!systemName) return Response.json({ error: "systemName is required and must be 160 characters or fewer." }, { status: 400 });
  if (accountId === null) return Response.json({ error: "accountId must be 240 characters or fewer." }, { status: 400 });

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

      const existing = await tx.accessRevocation.findFirst({
        where: { tenantId: ctx.tenantId, processId, systemName, accountId: accountId ?? null },
        select: { id: true }
      });
      if (existing) throw new Error("EXISTS");

      const access = await tx.accessRevocation.create({
        data: { tenantId: ctx.tenantId, processId, systemName, accountId }
      });
      const readiness = await recalculateSeparationReadiness(tx, ctx, processId);
      await appendAudit(tx, ctx, {
        action: "offboarding.access-registered",
        resourceType: "AccessRevocation",
        resourceId: access.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Exit access control registered: ${systemName}`
      });
      return { ...access, processStatus: readiness.processStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PROCESS_NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "PROCESS_CLOSED") return Response.json({ error: "Closed or cancelled separation processes cannot receive access controls." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "EXISTS") return Response.json({ error: "This system/account access control is already registered in the separation process." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Separation state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return Response.json({ error: "A concurrent or duplicate access-control change was detected. Refresh and try again." }, { status: 409 });
    console.error("Offboarding access registration failed", error);
    return Response.json({ error: "Access revocation control could not be registered." }, { status: 500 });
  }
}
