import { DataClassification, DocumentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getCaseWallCase } from "@/lib/case-wall";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:read")) return forbidden();
  const { id } = await params;
  if (!await getCaseWallCase(ctx, id)) return forbidden("Case wall denies access to this matter.");
  const data = await db.caseInterview.findMany({ where: { tenantId: ctx.tenantId, caseId: id }, orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }] });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { participantId?: string; scheduledAt?: string; summary?: string; transcriptDocumentId?: string };
  if (!body.scheduledAt && !body.summary?.trim()) return Response.json({ error: "scheduledAt or summary is required." }, { status: 400 });
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return Response.json({ error: "scheduledAt must be a valid date value." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const caseRecord = await getCaseWallCase(ctx, id, tx);
    if (!caseRecord) throw new Error("CASE_WALL");
    if (body.participantId) {
      const participant = await tx.caseParticipant.findFirst({ where: { id: body.participantId, tenantId: ctx.tenantId, caseId: id }, select: { id: true } });
      if (!participant) throw new Error("PARTICIPANT");
    }
    if (body.transcriptDocumentId) {
      const allowedSource = caseRecord.subjectPersonId
        ? [{ caseId: id }, { caseId: null, personId: caseRecord.subjectPersonId }]
        : [{ caseId: id }];
      const document = await tx.documentRecord.findFirst({
        where: {
          id: body.transcriptDocumentId,
          tenantId: ctx.tenantId,
          status: { not: DocumentStatus.DELETED },
          classification: { in: [DataClassification.RESTRICTED, DataClassification.HIGHLY_RESTRICTED] },
          OR: allowedSource
        },
        select: { id: true }
      });
      if (!document) throw new Error("DOCUMENT");
    }
    const record = await tx.caseInterview.create({
      data: {
        tenantId: ctx.tenantId,
        caseId: id,
        participantId: body.participantId,
        interviewerId: ctx.actorId,
        scheduledAt,
        completedAt: body.summary?.trim() ? new Date() : undefined,
        summary: body.summary?.trim(),
        transcriptDocumentId: body.transcriptDocumentId
      }
    });
    await appendAudit(tx, ctx, { action: "employee-case.interview-recorded", resourceType: "CaseInterview", resourceId: record.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return record;
  }).catch((error) => error instanceof Error && ["CASE_WALL", "PARTICIPANT", "DOCUMENT"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "CASE_WALL") return forbidden("Case wall denies access to this matter.");
  if (data === "PARTICIPANT") return Response.json({ error: "participantId must belong to this case and tenant." }, { status: 400 });
  if (data === "DOCUMENT") return Response.json({ error: "Transcript document must be restricted evidence for this case or its subject." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
