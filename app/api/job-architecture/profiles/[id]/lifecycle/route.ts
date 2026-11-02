import { DataClassification, JobProfileStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { normalizeJobProfileLifecycleAction } from "@/lib/job-architecture-input.mjs";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "job-architecture:write")) return forbidden();

  const { id: rawId } = await params;
  const id = asIdentifier(rawId);
  const body = await readJsonObject(request);
  const action = body ? normalizeJobProfileLifecycleAction(body.action) : null;
  if (!id || !action) {
    return Response.json({ error: "A valid profile id and explicit ACTIVATE or RETIRE action are required." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const profile = await tx.jobProfile.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          family: { select: { active: true } },
          level: { select: { active: true } },
          skillRequirements: { select: { skill: { select: { active: true } } } }
        }
      });
      if (!profile) throw new Error("NOT_FOUND");

      const now = new Date();
      if (action === "ACTIVATE") {
        if (profile.status !== JobProfileStatus.DRAFT) throw new Error("INVALID_TRANSITION");
        if (profile.effectiveFrom > now || (profile.effectiveTo && profile.effectiveTo < now)) {
          throw new Error("NOT_CURRENTLY_EFFECTIVE");
        }
        if (!profile.family.active || !profile.level.active || profile.skillRequirements.some((item) => !item.skill.active)) {
          throw new Error("INACTIVE_DEPENDENCY");
        }
      } else {
        if (profile.status !== JobProfileStatus.ACTIVE) throw new Error("INVALID_TRANSITION");
        if (profile.effectiveFrom > now) throw new Error("NOT_CURRENTLY_EFFECTIVE");
      }

      const next = action === "ACTIVATE" ? JobProfileStatus.ACTIVE : JobProfileStatus.RETIRED;
      const update = await tx.jobProfile.updateMany({
        where: { id, tenantId: ctx.tenantId, status: profile.status },
        data: {
          status: next,
          effectiveTo: action === "RETIRE"
            ? (profile.effectiveTo && profile.effectiveTo < now ? profile.effectiveTo : now)
            : profile.effectiveTo
        }
      });
      if (update.count !== 1) throw new Error("STALE_STATE");

      const updated = await tx.jobProfile.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true, code: true, title: true, status: true, effectiveFrom: true, effectiveTo: true,
          family: { select: { id: true, code: true, name: true } },
          level: { select: { id: true, code: true, name: true, rank: true } },
          _count: { select: { positions: true } }
        }
      });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: `job-profile.lifecycle.${profile.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "JobProfile",
        resourceId: id,
        classification: DataClassification.INTERNAL,
        purpose: action === "ACTIVATE"
          ? "Activate governed job profile for current workforce use"
          : "Retire governed job profile; existing position references remain historical"
      });
      return updated;
    });

    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Job profile not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") {
      return Response.json({ error: "Job profile lifecycle action is not allowed from the current state." }, { status: 409 });
    }
    if (code === "NOT_CURRENTLY_EFFECTIVE") {
      return Response.json({ error: "Job profile must be inside its effective date window for this lifecycle action." }, { status: 409 });
    }
    if (code === "INACTIVE_DEPENDENCY") {
      return Response.json({ error: "Inactive family, level or skill dependencies must be resolved before activation." }, { status: 409 });
    }
    throw error;
  }
}
