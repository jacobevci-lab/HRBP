import { ApplicationStage, DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canTransitionApplication, parseApplicationStage } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const next = parseApplicationStage(body.stage);
  if (!next) return Response.json({ error: "A valid application stage is required." }, { status: 400 });
  if (next === ApplicationStage.HIRED) return Response.json({ error: "Use the controlled Hire transition after an accepted offer." }, { status: 409 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, stage: true }
      });
      if (!current) throw new Error("APPLICATION_NOT_FOUND");
      if (!canTransitionApplication(current.stage, next)) throw new Error("INVALID_TRANSITION");

      const claimed = await tx.application.updateMany({
        where: { id: current.id, tenantId: ctx.tenantId, stage: current.stage },
        data: { stage: next }
      });
      if (claimed.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: `APPLICATION_STAGE_${current.stage}_TO_${next}`,
        resourceType: "Application",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Recruiting pipeline management"
      });

      return { id: current.id, stage: next };
    }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "APPLICATION_NOT_FOUND") return Response.json({ error: "Application was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested application-stage transition is not allowed." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The application changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Application stage transition failed", error);
    return Response.json({ error: "Application stage could not be changed." }, { status: 500 });
  }
}
