import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const scheduleManagers = new Set<PlatformRole>([
  PlatformRole.TIME_ADMIN,
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:read")) return forbidden();
  const data = await db.workSchedule.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "time:write") || !scheduleManagers.has(ctx.role)) return forbidden("Work schedule configuration requires a time-administration role.");

  const body = await request.json() as { code?: string; name?: string; timezone?: string; weeklyMinutes?: number; effectiveFrom?: string };
  if (!body.code || !body.name || !body.timezone || !body.effectiveFrom || !Number.isInteger(body.weeklyMinutes) || (body.weeklyMinutes ?? 0) <= 0) {
    return Response.json({ error: "code, name, timezone, effectiveFrom and positive integer weeklyMinutes are required." }, { status: 400 });
  }

  const data = await db.$transaction(async (tx) => {
    const schedule = await tx.workSchedule.create({
      data: {
        tenantId: ctx.tenantId,
        code: body.code!.trim().toUpperCase(),
        name: body.name!.trim(),
        timezone: body.timezone!.trim(),
        weeklyMinutes: body.weeklyMinutes!,
        effectiveFrom: new Date(body.effectiveFrom!)
      }
    });
    await appendAudit(tx, ctx, { action: "work-schedule.created", resourceType: "WorkSchedule", resourceId: schedule.id, classification: DataClassification.INTERNAL });
    return schedule;
  });
  return Response.json({ data }, { status: 201 });
}
