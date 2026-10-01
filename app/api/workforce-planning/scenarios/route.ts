import { DataClassification, Prisma, WorkforceScenarioStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getWorkforcePlanningLiveData } from "@/lib/governance-planning-live-data";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function boundedText(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "workforce-plan:read")) return forbidden();
  const live = await getWorkforcePlanningLiveData(ctx);
  return Response.json({
    data: live.rows,
    summary: {
      activeEmployments: live.activeEmployments,
      scenarioCount: live.scenarioCount,
      approvedScenarios: live.approvedScenarios,
      relationshipScoped: live.relationshipScoped
    }
  });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "workforce-plan:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const codeValue = boundedText(body.code, 40, true);
  const name = boundedText(body.name, 160, true);
  const description = boundedText(body.description, 2_000);
  const currencyValue = boundedText(body.currency, 3, true);
  const baseDate = typeof body.baseDate === "string" ? new Date(body.baseDate) : null;
  const horizonMonths = typeof body.horizonMonths === "number" ? body.horizonMonths : Number(body.horizonMonths ?? 12);

  if (!codeValue || !name || !currencyValue || description === null || !baseDate || Number.isNaN(baseDate.getTime())) {
    return Response.json({ error: "Valid code, name, baseDate and currency are required." }, { status: 400 });
  }
  if (!/^[A-Z0-9_-]+$/i.test(codeValue)) return Response.json({ error: "code may contain letters, numbers, underscore and dash only." }, { status: 400 });
  if (!/^[A-Z]{3}$/i.test(currencyValue)) return Response.json({ error: "currency must be a 3-letter ISO-style code." }, { status: 400 });
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 120) {
    return Response.json({ error: "horizonMonths must be an integer between 1 and 120." }, { status: 400 });
  }

  const code = codeValue.toUpperCase();
  const currency = currencyValue.toUpperCase();

  try {
    const data = await db.$transaction(async (tx) => {
      const scenario = await tx.workforceScenario.create({
        data: {
          tenantId: ctx.tenantId,
          code,
          name,
          description,
          status: WorkforceScenarioStatus.DRAFT,
          baseDate,
          horizonMonths,
          currency,
          assumptions: body.assumptions as Prisma.InputJsonValue | undefined,
          ownerId: ctx.actorId
        }
      });
      await appendAudit(tx, ctx, {
        action: "workforce-scenario.created",
        resourceType: "WorkforceScenario",
        resourceId: scenario.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Draft workforce scenario planning"
      });
      return scenario;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A workforce scenario with this code already exists." }, { status: 409 });
    }
    console.error("Workforce scenario creation failed", error);
    return Response.json({ error: "Workforce scenario could not be created." }, { status: 500 });
  }
}
