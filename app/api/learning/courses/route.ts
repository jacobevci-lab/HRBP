import { asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseValidity(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !/^\d{1,3}$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) return undefined;
  return parsed;
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "learning:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.learningCourse.findMany({
    where: { tenantId: ctx.tenantId, active: true },
    orderBy: [{ mandatory: "desc" }, { title: "asc" }],
    take: 300,
    include: { _count: { select: { assignments: { where: { ...employmentIdFilter(scope) } } } } }
  });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "learning:write")) return forbidden();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });

  const code = asText(body.code, 64)?.toUpperCase() ?? null;
  const title = asText(body.title, 250);
  const provider = asOptionalText(body.provider, 250);
  const mandatory = body.mandatory === undefined ? false : body.mandatory;
  const validityMonths = parseValidity(body.validityMonths);
  if (!code || !/^[A-Z0-9._-]{1,64}$/.test(code) || !title) {
    return Response.json({ error: "code must be 1–64 letters, numbers, dots, underscores or hyphens, and title must be 1–250 characters." }, { status: 400 });
  }
  if (provider === null) return Response.json({ error: "provider must not exceed 250 characters." }, { status: 400 });
  if (typeof mandatory !== "boolean") return Response.json({ error: "mandatory must be a boolean." }, { status: 400 });
  if (validityMonths === undefined) return Response.json({ error: "validityMonths must be between 1 and 120 or blank." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const course = await tx.learningCourse.create({
        data: {
          tenantId: ctx.tenantId,
          code,
          title,
          provider: provider ?? null,
          mandatory,
          validityMonths
        }
      });
      await appendAudit(tx, ctx, {
        action: "learning-course.created",
        resourceType: "LearningCourse",
        resourceId: course.id,
        classification: DataClassification.INTERNAL
      });
      return course;
    });
    return Response.json({ data }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const prismaCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (prismaCode === "P2002") {
      return Response.json({ error: "A course with this code already exists in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
