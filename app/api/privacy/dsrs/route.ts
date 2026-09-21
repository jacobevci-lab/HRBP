import { randomUUID } from "node:crypto";
import { DSRStatus, DSRType, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "privacy:read")) return forbidden();
  const data = await db.dataSubjectRequest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "privacy:write")) return forbidden();
  const body = await request.json() as { subjectPersonId?: string; type?: DSRType; channel?: string; dueAt?: string };
  if (!body.subjectPersonId || !body.type || !Object.values(DSRType).includes(body.type)) return Response.json({ error: "subjectPersonId and valid type are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const person = await tx.person.findFirst({ where: { id: body.subjectPersonId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!person) throw new Error("NOT_FOUND");
    const now = new Date();
    const dsr = await tx.dataSubjectRequest.create({ data: { tenantId: ctx.tenantId, requestNumber: `DSR-${now.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, subjectPersonId: person.id, type: body.type!, status: DSRStatus.RECEIVED, channel: body.channel, ownerId: ctx.actorId, dueAt: body.dueAt ? new Date(body.dueAt) : new Date(now.getTime() + 30 * 86_400_000) } });
    await appendAudit(tx, ctx, { action: "privacy.dsr-created", resourceType: "DataSubjectRequest", resourceId: dsr.id, classification: DataClassification.RESTRICTED });
    return dsr;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Data subject not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
