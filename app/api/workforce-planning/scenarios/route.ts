import { DataClassification, WorkforceScenarioStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getWorkforcePlanningLiveData } from "@/lib/governance-planning-live-data";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
  const body = await request.json() as { code?: string; name?: string; description?: string; baseDate?: string; horizonMonths?: number; currency?: string; assumptions?: unknown };
  const code = body.code?.trim().toUpperCase();
  const name = body.name?.trim();
  if (!code || !name || !body.baseDate || !body.currency?.trim()) return Response.json({ error: "code, name, baseDate and currency are required." }, { status: 400 });
  const horizonMonths = Math.min(120, Math.max(1, body.horizonMonths ?? 12));
  const data = await db.$transaction(async (tx) => {
    const scenario = await tx.workforceScenario.create({ data: { tenantId: ctx.tenantId, code, name, description: body.description, status: WorkforceScenarioStatus.DRAFT, baseDate: new Date(body.baseDate!), horizonMonths, currency: body.currency!.trim().toUpperCase(), assumptions: body.assumptions as never, ownerId: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "workforce-scenario.created", resourceType: "WorkforceScenario", resourceId: scenario.id, classification: DataClassification.CONFIDENTIAL });
    return scenario;
  });
  return Response.json({ data }, { status: 201 });
}
