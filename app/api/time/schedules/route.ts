import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { asDate, asFiniteNumber, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

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
  if (!can(ctx, "time:configure")) return forbidden("Work schedule configuration requires time:configure.");

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const code = asText(body.code, 40);
  const name = asText(body.name, 160);
  const timezone = asText(body.timezone, 100);
  const weeklyMinutes = asFiniteNumber(body.weeklyMinutes);
  const effectiveFrom = asDate(body.effectiveFrom);

  if (!code || !name || !timezone || weeklyMinutes === null || !effectiveFrom) {
    return Response.json({ error: "code, name, timezone, weeklyMinutes and effectiveFrom must be valid scalar values." }, { status: 400 });
  }
  if (!Number.isInteger(weeklyMinutes) || weeklyMinutes <= 0 || weeklyMinutes > 10080) {
    return Response.json({ error: "weeklyMinutes must be a positive integer no greater than 10080." }, { status: 400 });
  }
  if (!validTimeZone(timezone)) return Response.json({ error: "timezone must be a valid IANA time zone." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const schedule = await tx.workSchedule.create({
        data: {
          tenantId: ctx.tenantId,
          code: code.toUpperCase(),
          name,
          timezone,
          weeklyMinutes,
          effectiveFrom
        }
      });
      await appendAudit(tx, ctx, {
        action: "work-schedule.created",
        resourceType: "WorkSchedule",
        resourceId: schedule.id,
        classification: DataClassification.INTERNAL
      });
      return schedule;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A schedule with the same code and effective date already exists." }, { status: 409 });
    }
    throw error;
  }
}
