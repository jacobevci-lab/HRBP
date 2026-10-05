import { readJsonObject } from "@/lib/input-validation";
import { parseLeaveType } from "@/lib/leave-input";
import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:read")) return forbidden();
  const data = await db.leaveType.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "leave:configure")) return forbidden();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const parsed = parseLeaveType(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const leaveType = await tx.leaveType.create({
        data: {
          tenantId: ctx.tenantId,
          ...parsed.value
        }
      });
      await appendAudit(tx, ctx, { action: "leave-type.created", resourceType: "LeaveType", resourceId: leaveType.id, classification: DataClassification.INTERNAL });
      return leaveType;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "A leave type with this code already exists." }, { status: 409 });
    throw error;
  }
}
