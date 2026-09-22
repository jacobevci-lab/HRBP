import { DataClassification, EmploymentStatus, ExitTaskStatus, SeparationStatus, SeparationType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
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

  const body = await request.json() as {
    employmentId?: string;
    type?: SeparationType;
    noticeDate?: string;
    lastWorkingDate?: string;
    reasonCode?: string;
    employeeReason?: string;
    managerEmploymentId?: string;
  };
  if (!body.employmentId || !body.type || !Object.values(SeparationType).includes(body.type) || !body.lastWorkingDate) {
    return Response.json({ error: "employmentId, valid type and lastWorkingDate are required." }, { status: 400 });
  }

  const lastWorkingDate = new Date(body.lastWorkingDate);
  const noticeDate = body.noticeDate ? new Date(body.noticeDate) : new Date();
  if (Number.isNaN(lastWorkingDate.getTime()) || Number.isNaN(noticeDate.getTime())) {
    return Response.json({ error: "noticeDate and lastWorkingDate must be valid date values." }, { status: 400 });
  }
  if (lastWorkingDate < noticeDate) {
    return Response.json({ error: "lastWorkingDate cannot be before noticeDate." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);
  if (!canActOnEmployment(scope, body.employmentId)) return forbidden("Employment is outside your authorized relationship scope.");

  const data = await db.$transaction(async (tx) => {
    const employment = await tx.employment.findFirst({
      where: {
        id: body.employmentId,
        tenantId: ctx.tenantId,
        status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE, EmploymentStatus.SUSPENDED] }
      },
      select: { id: true, managerEmploymentId: true }
    });
    if (!employment) throw new Error("NOT_FOUND");

    if (body.managerEmploymentId) {
      const manager = await tx.employment.findFirst({ where: { id: body.managerEmploymentId, tenantId: ctx.tenantId }, select: { id: true } });
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
        type: body.type!,
        status: SeparationStatus.NOTICE_PERIOD,
        noticeDate,
        lastWorkingDate,
        reasonCode: body.reasonCode,
        employeeReason: body.employeeReason,
        initiatedById: ctx.actorId,
        managerEmploymentId: body.managerEmploymentId ?? employment.managerEmploymentId,
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
      classification: DataClassification.RESTRICTED
    });
    return record;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "MANAGER_NOT_FOUND", "EXISTS"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Active employment not found in tenant." }, { status: 404 });
  if (data === "MANAGER_NOT_FOUND") return Response.json({ error: "Manager employment not found in tenant." }, { status: 404 });
  if (data === "EXISTS") return Response.json({ error: "An open separation process already exists for this employment." }, { status: 409 });
  return Response.json({ data }, { status: 201 });
}
