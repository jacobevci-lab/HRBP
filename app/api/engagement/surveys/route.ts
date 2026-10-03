import { readJsonObject } from "@/lib/input-validation";
import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function bounded(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:read")) return forbidden();

  const data = await db.engagementSurvey.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true, code: true, name: true, description: true, createdById: true, createdAt: true, updatedAt: true,
      questions: { orderBy: { orderIndex: "asc" }, select: { id: true, questionKey: true, prompt: true, type: true, required: true, orderIndex: true, options: true, dimension: true } },
      _count: { select: { campaigns: true } }
    }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const body = await readJsonObject(request) as Record<string, unknown>;
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const codeValue = bounded(body.code, 40, true);
  const name = bounded(body.name, 160, true);
  const description = bounded(body.description, 2000);

  if (!codeValue || !name || description === null) return Response.json({ error: "Valid code and name are required." }, { status: 400 });
  if (!/^[A-Z0-9_-]+$/i.test(codeValue)) return Response.json({ error: "code may contain letters, numbers, underscore and dash only." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const survey = await tx.engagementSurvey.create({
        data: {
          tenantId: ctx.tenantId,
          code: codeValue.toUpperCase(),
          name,
          description,
          createdById: ctx.actorId
        }
      });
      await appendAudit(tx, ctx, {
        action: "engagement-survey.created",
        resourceType: "EngagementSurvey",
        resourceId: survey.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Governed engagement survey authoring"
      });
      return survey;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A survey with this code already exists." }, { status: 409 });
    }
    console.error("Engagement survey creation failed", error);
    return Response.json({ error: "Engagement survey could not be created." }, { status: 500 });
  }
}
