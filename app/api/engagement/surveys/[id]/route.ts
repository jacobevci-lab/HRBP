import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function bounded(value: unknown, max: number) {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : text ? null : undefined;
}

async function loadOwnedSurvey(tx: Prisma.TransactionClient, ctx: NonNullable<ReturnType<typeof getRequestContext>>, id: string) {
  const survey = await tx.engagementSurvey.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: {
      id: true, createdById: true,
      campaigns: { where: { status: { not: "DRAFT" } }, select: { id: true }, take: 1 },
      _count: { select: { campaigns: true } }
    }
  });
  if (!survey) throw new Error("NOT_FOUND");
  if (survey.createdById !== ctx.actorId) throw new Error("OWNER");
  return survey;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const code = bounded(body.code, 40);
  const name = bounded(body.name, 160);
  const description = bounded(body.description, 2000);
  if (code === null || name === null || description === null) return Response.json({ error: "Invalid survey values." }, { status: 400 });
  if (code && !/^[A-Z0-9_-]+$/i.test(code)) return Response.json({ error: "code may contain letters, numbers, underscore and dash only." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const survey = await loadOwnedSurvey(tx, ctx, id);
    if (survey.campaigns.length) throw new Error("LOCKED");

    const data: Prisma.EngagementSurveyUncheckedUpdateInput = {};
    if (code !== undefined) data.code = code.toUpperCase();
    if (name !== undefined) data.name = name;
    if (body.description !== undefined) data.description = description ?? null;

    const updated = await tx.engagementSurvey.update({ where: { id: survey.id }, data });
    await appendAudit(tx, ctx, {
      action: "engagement-survey.updated",
      resourceType: "EngagementSurvey",
      resourceId: survey.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Governed engagement survey authoring"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "DUPLICATE" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "LOCKED"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Survey not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may edit it.");
  if (result === "LOCKED") return Response.json({ error: "Survey metadata is locked after a campaign leaves DRAFT." }, { status: 409 });
  if (result === "DUPLICATE") return Response.json({ error: "A survey with this code already exists." }, { status: 409 });
  return Response.json({ data: result });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id } = await params;
  const result = await db.$transaction(async (tx) => {
    const survey = await loadOwnedSurvey(tx, ctx, id);
    if (survey._count.campaigns) throw new Error("USED");
    await tx.engagementSurvey.delete({ where: { id: survey.id } });
    await appendAudit(tx, ctx, {
      action: "engagement-survey.deleted",
      resourceType: "EngagementSurvey",
      resourceId: survey.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Governed engagement survey authoring"
    });
    return { id: survey.id };
  }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "USED"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Survey not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the survey creator may delete it.");
  if (result === "USED") return Response.json({ error: "Surveys referenced by campaigns cannot be deleted." }, { status: 409 });
  return Response.json({ data: result });
}
