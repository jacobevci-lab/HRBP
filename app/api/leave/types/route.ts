import { DataClassification, LeaveUnit } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "leave:configure")) return forbidden();
  const body = await request.json() as { code?: string; name?: string; unit?: LeaveUnit; paid?: boolean; requiresApproval?: boolean; annualAllowance?: string | number };
  if (!body.code?.trim() || !body.name?.trim()) return Response.json({ error: "code and name are required." }, { status: 400 });
  const allowance = body.annualAllowance === undefined ? undefined : Number(body.annualAllowance);
  if (allowance !== undefined && (!Number.isFinite(allowance) || allowance < 0 || allowance > 3660)) return Response.json({ error: "annualAllowance must be between 0 and 3660." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const leaveType = await tx.leaveType.create({
        data: {
          tenantId: ctx.tenantId,
          code: body.code!.trim().toUpperCase().slice(0, 40),
          name: body.name!.trim().slice(0, 160),
          unit: body.unit ?? LeaveUnit.DAYS,
          paid: body.paid ?? true,
          requiresApproval: body.requiresApproval ?? true,
          annualAllowance: allowance
        }
      });
      await appendAudit(tx, ctx, { action: "leave-type.created", resourceType: "LeaveType", resourceId: leaveType.id, classification: DataClassification.INTERNAL });
      return leaveType;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return Response.json({ error: "A leave type with this code already exists." }, { status: 409 });
    throw error;
  }
}
