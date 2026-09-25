import { DataClassification, EmploymentStatus, ExitTaskStatus, Prisma, SeparationStatus, SeparationType } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "offboarding:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.separationProcess.findMany({
    where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
    orderBy: [{ lastWorkingDate: "asc" }, { createdAt: "desc" }],
    include: {
      tasks: true,
      assets: true,
      accessRevocations: true,
      exitInterview: true,
      _count: { select: { knowledgeTransfers: true } }
    },
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const employmentId = asIdentifier(body.employmentId);
  const type = asEnumValue(body.type, Object.values(SeparationType));
  const managerEmploymentId = body.managerEmploymentId === undefined || body.managerEmploymentId === null || body.managerEmploymentId === ""
    ? undefined
    : asIdentifier(body.managerEmploymentId);
  const reasonCode = asOptionalText(body.reasonCode, 120);
  const employeeReason = asOptionalText(body.employeeReason, 2000);
  if (!employmentId || !type || typeof body.lastWorkingDate !== "string" || !body.lastWorkingDate.trim()) {
    return Response.json({ error: "employmentId, valid type and lastWorkingDate are required." }, { status: 400 });
  }
  if (body.managerEmploymentId && !managerEmploymentId) return Response.json({ error: "managerEmploymentId is invalid." }, { status: 400 });
  if (reasonCode === null) return Response.json({ error: "reasonCode must be 120 characters or fewer." }, { status: 400 });
  if (employeeReason === null) return Response.json({ error: "employeeReason must be 2000 characters or fewer." }, { status: 400 });

  const lastWorkingDate = new Date(body.lastWorkingDate);
  const noticeDate = typeof body.noticeDate === "string" && body.noticeDate.trim() ? new Date(body.noticeDate) : new Date();
  if (Number.isNaN(lastWorkingDate.getTime()) || Number.isNaN(noticeDate.getTime())) {
    return Response.json({ error: "noticeDate and lastWorkingDate must be valid date values." }, { status: 400 });
  }
  if (lastWorkingDate < noticeDate) {
    return Response.json({ error: "lastWorkingDate cannot be before noticeDate." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);
  if (!canActOnEmployment(scope, employmentId)) return forbidden("Employment is outside your authorized relationship scope.");

  try {
    const data = await db.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: {
          id: employmentId,
          tenantId: ctx.tenantId,
          status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED] }
        },
        select: { id: true, managerEmploymentId: true }
      });
      if (!employment) throw new Error("NOT_FOUND");

      if (managerEmploymentId) {
        if (managerEmploymentId === employment.id) throw new Error("INVALID_MANAGER");
        const manager = await tx.employment.findFirst({
          where: { id: managerEmploymentId, tenantId: ctx.tenantId, status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] } },
          select: { id: true }
        });
        if (!manager) throw new Error("MANAGER_NOT_FOUND");
      }

      const existing = await tx.separationProcess.findFirst({
        where: { tenantId: ctx.tenantId, employmentId: employment.id, status: { notIn: [SeparationStatus.CLOSED, SeparationStatus.CANCELLED] } },
        select: { id: true }
      });
      if (existing) throw new Error("EXISTS");

      const record = await tx.separationProcess.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId: employment.id,
          type,
          status: SeparationStatus.NOTICE_PERIOD,
          noticeDate,
          lastWorkingDate,
          reasonCode,
          employeeReason,
          initiatedById: ctx.actorId,
          managerEmploymentId: managerEmploymentId ?? employment.managerEmploymentId,
          tasks: {
            create: [
              { tenantId: ctx.tenantId, domain: "HR", title: "Confirm separation documentation", status: ExitTaskStatus.NOT_STARTED, blocking: true, dueAt: lastWorkingDate },
              { tenantId: ctx.tenantId, domain: "MANAGER", title: "Complete knowledge transfer", status: ExitTaskStatus.NOT_STARTED, blocking: true, dueAt: lastWorkingDate },
              { tenantId: ctx.tenantId, domain: "IT", title: "Revoke logical access", status: ExitTaskStatus.NOT_STARTED, blocking: true, dueAt: lastWorkingDate },
              { tenantId: ctx.tenantId, domain: "FACILITIES", title: "Collect company assets", status: ExitTaskStatus.NOT_STARTED, blocking: true, dueAt: lastWorkingDate },
              { tenantId: ctx.tenantId, domain: "PAYROLL", title: "Validate final settlement", status: ExitTaskStatus.NOT_STARTED, blocking: true, dueAt: lastWorkingDate }
            ]
          }
        },
        include: { tasks: true }
      });
      await appendAudit(tx, ctx, {
        action: "offboarding.process-created",
        resourceType: "SeparationProcess",
        resourceId: record.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Governed separation initiation with cross-functional clearance controls"
      });
      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Active employment not found in tenant." }, { status: 404 });
    if (code === "MANAGER_NOT_FOUND") return Response.json({ error: "Active manager employment not found in tenant." }, { status: 404 });
    if (code === "INVALID_MANAGER") return Response.json({ error: "An employment cannot be its own separation manager." }, { status: 400 });
    if (code === "EXISTS") return Response.json({ error: "An open separation process already exists for this employment." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json({ error: "A concurrent separation change was detected. Refresh and try again." }, { status: 409 });
    }
    console.error("Offboarding process creation failed", error);
    return Response.json({ error: "Separation process could not be created." }, { status: 500 });
  }
}
