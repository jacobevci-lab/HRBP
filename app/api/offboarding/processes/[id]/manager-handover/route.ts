import { DataClassification, EmploymentStatus, LifecycleEventType, Prisma, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { recalculateSeparationReadiness } from "@/lib/offboarding-readiness";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const REPORT_STATUSES: EmploymentStatus[] = [EmploymentStatus.PREBOARDING, EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED];
const MANAGER_STATUSES: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const newManagerEmploymentId = asIdentifier(body.newManagerEmploymentId);
  const reason = asText(body.reason, 2000);
  if (!newManagerEmploymentId) return Response.json({ error: "A valid new manager employment id is required." }, { status: 400 });
  if (!reason || reason.length < 10) return Response.json({ error: "Manager handover reason must be between 10 and 2000 characters." }, { status: 400 });

  const scope = await resolveEmploymentScope(db, ctx);

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, status: true, completedAt: true, updatedAt: true }
      });
      if (!process) throw new Error("NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED || process.completedAt) throw new Error("TERMINAL");
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (newManagerEmploymentId === process.employmentId) throw new Error("SELF_MANAGER");

      const [departing, newManager, directReports] = await Promise.all([
        tx.employment.findFirst({
          where: { id: process.employmentId, tenantId: ctx.tenantId },
          select: { id: true, person: { select: { givenName: true, familyName: true } } }
        }),
        tx.employment.findFirst({
          where: { id: newManagerEmploymentId, tenantId: ctx.tenantId, status: { in: MANAGER_STATUSES } },
          select: { id: true, personId: true, managerEmploymentId: true, person: { select: { givenName: true, familyName: true } } }
        }),
        tx.employment.findMany({
          where: { tenantId: ctx.tenantId, managerEmploymentId: process.employmentId, status: { in: REPORT_STATUSES } },
          orderBy: { id: "asc" },
          select: { id: true, personId: true, status: true }
        })
      ]);
      if (!departing) throw new Error("EMPLOYMENT_NOT_FOUND");
      if (!newManager) throw new Error("MANAGER_NOT_FOUND");
      if (!canActOnEmployment(scope, newManager.id)) throw new Error("TARGET_OUT_OF_SCOPE");
      if (!directReports.length) throw new Error("NO_REPORTS");
      if (directReports.some((report) => !canActOnEmployment(scope, report.id))) throw new Error("REPORT_OUT_OF_SCOPE");
      if (directReports.some((report) => report.id === newManager.id)) throw new Error("DESCENDANT_MANAGER");

      const seen = new Set<string>();
      let cursor: { id: string; managerEmploymentId: string | null } | null = { id: newManager.id, managerEmploymentId: newManager.managerEmploymentId };
      for (let depth = 0; cursor && depth < 100; depth += 1) {
        if (seen.has(cursor.id)) throw new Error("EXISTING_MANAGER_CYCLE");
        seen.add(cursor.id);
        if (cursor.id === process.employmentId || cursor.managerEmploymentId === process.employmentId) throw new Error("DESCENDANT_MANAGER");
        if (!cursor.managerEmploymentId) break;
        cursor = await tx.employment.findFirst({
          where: { id: cursor.managerEmploymentId, tenantId: ctx.tenantId },
          select: { id: true, managerEmploymentId: true }
        });
      }
      if (cursor?.managerEmploymentId && seen.size >= 100) throw new Error("MANAGER_DEPTH");

      const reportIds = directReports.map((report) => report.id);
      const changedAt = new Date();
      const updated = await tx.employment.updateMany({
        where: { tenantId: ctx.tenantId, id: { in: reportIds }, managerEmploymentId: process.employmentId, status: { in: REPORT_STATUSES } },
        data: { managerEmploymentId: newManager.id }
      });
      if (updated.count !== reportIds.length) throw new Error("STATE_CONFLICT");

      await tx.separationManagerReassignment.createMany({
        data: directReports.map((report) => ({
          tenantId: ctx.tenantId,
          processId: process.id,
          reportEmploymentId: report.id,
          previousManagerEmploymentId: process.employmentId,
          newManagerEmploymentId: newManager.id,
          reason,
          changedById: ctx.actorId,
          changedAt,
          classification: DataClassification.RESTRICTED
        }))
      });

      await tx.employeeLifecycleEvent.createMany({
        data: directReports.map((report) => ({
          tenantId: ctx.tenantId,
          personId: report.personId,
          employmentId: report.id,
          type: LifecycleEventType.MANAGER_CHANGED,
          effectiveAt: changedAt,
          summary: `Manager reassigned during governed offboarding from ${departing.person.givenName} ${departing.person.familyName} to ${newManager.person.givenName} ${newManager.person.familyName}`,
          actorId: ctx.actorId
        }))
      });

      await appendAudit(tx, ctx, {
        action: "offboarding.manager-handover-completed",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Human-approved manager handover for ${directReports.length} direct report(s) before separation closure. Reason: ${reason}`
      });

      const readiness = await recalculateSeparationReadiness(tx, ctx, process.id);
      return {
        processId: process.id,
        previousManagerEmploymentId: process.employmentId,
        newManagerEmploymentId: newManager.id,
        newManager: `${newManager.person.givenName} ${newManager.person.familyName}`,
        reassignedReports: directReports.length,
        changedAt,
        reason,
        readiness
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Departing employment record not found." }, { status: 409 });
    if (code === "MANAGER_NOT_FOUND") return Response.json({ error: "The selected manager must have an active or leave employment in this tenant." }, { status: 409 });
    if (code === "OUT_OF_SCOPE" || code === "TARGET_OUT_OF_SCOPE" || code === "REPORT_OUT_OF_SCOPE") return forbidden("Manager handover is outside your authorized employment relationship scope.");
    if (code === "TERMINAL") return Response.json({ error: "Closed or cancelled separations cannot change manager reporting lines." }, { status: 409 });
    if (code === "NO_REPORTS") return Response.json({ error: "This departing employment no longer has active direct reports to reassign." }, { status: 409 });
    if (code === "SELF_MANAGER") return Response.json({ error: "The departing employee cannot be selected as the new manager." }, { status: 409 });
    if (code === "DESCENDANT_MANAGER") return Response.json({ error: "The selected manager is inside the departing manager's reporting subtree and would create a reporting cycle." }, { status: 409 });
    if (code === "EXISTING_MANAGER_CYCLE" || code === "MANAGER_DEPTH") return Response.json({ error: "The existing reporting hierarchy is cyclic or exceeds the supported depth. Resolve the hierarchy before handover." }, { status: 409 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return Response.json({ error: "Reporting lines changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding manager handover failed", error);
    return Response.json({ error: "Manager handover could not be completed." }, { status: 500 });
  }
}
