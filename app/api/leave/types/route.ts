import { DataClassification, LeaveUnit } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:read")) return forbidden();
  const data = await db.leaveType.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:write")) return forbidden();
  const body = await request.json() as { code?: string; name?: string; unit?: LeaveUnit; paid?: boolean; requiresApproval?: boolean; annualAllowance?: string | number };
  if (!body.code || !body.name) return Response.json({ error: "code and name are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const leaveType = await tx.leaveType.create({ data: { tenantId: ctx.tenantId, code: body.code!.trim().toUpperCase(), name: body.name!.trim(), unit: body.unit ?? LeaveUnit.DAYS, paid: body.paid ?? true, requiresApproval: body.requiresApproval ?? true, annualAllowance: body.annualAllowance } });
    await appendAudit(tx, ctx, { action: "leave-type.created", resourceType: "LeaveType", resourceId: leaveType.id, classification: DataClassification.INTERNAL });
    return leaveType;
  });
  return Response.json({ data }, { status: 201 });
}
