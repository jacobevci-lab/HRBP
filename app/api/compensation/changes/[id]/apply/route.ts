import { Prisma } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { applyApprovedCompensationChange } from "@/lib/compensation-application";
import { withDb } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "compensation:apply")) return forbidden("Applying compensation changes requires compensation:apply.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid compensation change id is required." }, { status: 400 });

  try {
    const data = await withDb((client) => client.$transaction(
      (tx) => applyApprovedCompensationChange(tx, ctx, id),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    ));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "CHANGE_NOT_FOUND") return Response.json({ error: "Compensation change not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Compensation change is outside your authorized relationship scope.");
    if (code === "FOUR_EYES_REQUIRED") return forbidden("Four-eyes control: the requester cannot apply their own compensation change.");
    if (code === "INVALID_STATE") return Response.json({ error: "Only an approved compensation change can be applied." }, { status: 409 });
    if (code === "EFFECTIVE_DATE_CONFLICT") return Response.json({ error: "A compensation history record already exists for this effective date." }, { status: 409 });
    if (code === "BASELINE_CHANGED") return Response.json({ error: "The governed salary baseline changed after this proposal was created. Create a new proposal from the current salary state." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The compensation change was modified concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Compensation state changed concurrently. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
