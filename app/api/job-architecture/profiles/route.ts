import { DataClassification, JobProfileStatus, Prisma, SkillProficiency } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import {
  normalizeArchitectureCode,
  normalizeJobProfileCreateStatus,
  normalizeSkillRequirements
} from "@/lib/job-architecture-input.mjs";
import { asDate, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function optionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return asDate(value);
}

function prismaCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "job-architecture:read")) return forbidden();

  const data = await db.jobProfile.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ status: "asc" }, { title: "asc" }, { effectiveFrom: "desc" }],
    select: {
      id: true, code: true, title: true, description: true, status: true,
      effectiveFrom: true, effectiveTo: true, createdAt: true, updatedAt: true,
      family: { select: { id: true, code: true, name: true, active: true } },
      level: { select: { id: true, code: true, name: true, rank: true, active: true } },
      skillRequirements: {
        orderBy: [{ required: "desc" }, { skill: { name: "asc" } }],
        select: {
          id: true, required: true, targetProficiency: true,
          skill: { select: { id: true, code: true, name: true, category: true, active: true } }
        }
      },
      _count: { select: { positions: true } }
    }
  });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "job-architecture:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const code = normalizeArchitectureCode(body.code);
  const title = asText(body.title, 180);
  const familyId = asIdentifier(body.familyId);
  const levelId = asIdentifier(body.levelId);
  const description = asOptionalText(body.description, 4000);
  const status = normalizeJobProfileCreateStatus(body.status);
  const effectiveFrom = asDate(body.effectiveFrom);
  const effectiveTo = optionalDate(body.effectiveTo);
  const skillRequirements = normalizeSkillRequirements(body.skillRequirements);

  if (!code || !title || !familyId || !levelId || !status || !effectiveFrom) {
    return Response.json({
      error: "code, title, familyId, levelId, valid status and effectiveFrom are required."
    }, { status: 400 });
  }
  if (description === null) return Response.json({ error: "description must not exceed 4000 characters." }, { status: 400 });
  if (body.effectiveTo !== undefined && body.effectiveTo !== null && body.effectiveTo !== "" && !effectiveTo) {
    return Response.json({ error: "effectiveTo must be a valid date or blank." }, { status: 400 });
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    return Response.json({ error: "effectiveTo cannot be earlier than effectiveFrom." }, { status: 400 });
  }
  const now = new Date();
  if (status === "ACTIVE" && (effectiveFrom > now || (effectiveTo && effectiveTo < now))) {
    return Response.json({ error: "ACTIVE profiles must be inside their effective date window. Create future profiles as DRAFT and activate them when effective." }, { status: 400 });
  }
  if (skillRequirements === null) {
    return Response.json({ error: "skillRequirements must be a bounded unique list of valid skill requirements." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const [family, level] = await Promise.all([
        tx.jobFamily.findFirst({
          where: { id: familyId, tenantId: ctx.tenantId, active: true },
          select: { id: true }
        }),
        tx.jobLevel.findFirst({
          where: { id: levelId, tenantId: ctx.tenantId, active: true },
          select: { id: true }
        })
      ]);
      if (!family || !level) throw new Error("ARCHITECTURE_PARENT_NOT_FOUND");

      const overlapWhere: Prisma.JobProfileWhereInput = {
        tenantId: ctx.tenantId,
        code,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }]
      };
      if (effectiveTo) overlapWhere.effectiveFrom = { lte: effectiveTo };
      const overlap = await tx.jobProfile.findFirst({ where: overlapWhere, select: { id: true } });
      if (overlap) throw new Error("PROFILE_EFFECTIVE_OVERLAP");

      if (skillRequirements.length) {
        const skillIds = skillRequirements.map((item) => item.skillId);
        const skills = await tx.skill.findMany({
          where: { tenantId: ctx.tenantId, active: true, id: { in: skillIds } },
          select: { id: true }
        });
        if (skills.length !== skillIds.length) throw new Error("SKILL_NOT_FOUND");
      }

      const profile = await tx.jobProfile.create({
        data: {
          tenantId: ctx.tenantId,
          code,
          title,
          familyId,
          levelId,
          description: description ?? null,
          status: status as JobProfileStatus,
          effectiveFrom,
          effectiveTo,
          skillRequirements: skillRequirements.length ? {
            create: skillRequirements.map((item) => ({
              tenantId: ctx.tenantId,
              skillId: item.skillId,
              targetProficiency: item.targetProficiency as SkillProficiency,
              required: item.required
            }))
          } : undefined
        },
        include: {
          family: { select: { id: true, code: true, name: true } },
          level: { select: { id: true, code: true, name: true, rank: true } },
          skillRequirements: {
            include: { skill: { select: { id: true, code: true, name: true } } }
          }
        }
      });

      await appendAudit(tx, ctx, {
        action: "job-profile.created",
        resourceType: "JobProfile",
        resourceId: profile.id,
        classification: DataClassification.INTERNAL,
        purpose: `Governed job architecture; status=${status}; skillRequirements=${skillRequirements.length}`
      });
      return profile;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ARCHITECTURE_PARENT_NOT_FOUND") {
      return Response.json({ error: "Active job family or job level not found in tenant." }, { status: 404 });
    }
    if (code === "SKILL_NOT_FOUND") {
      return Response.json({ error: "One or more active skills were not found in tenant." }, { status: 404 });
    }
    if (code === "PROFILE_EFFECTIVE_OVERLAP" || prismaCode(error) === "P2002") {
      return Response.json({ error: "This job-profile code overlaps an existing effective-dated profile." }, { status: 409 });
    }
    throw error;
  }
}
