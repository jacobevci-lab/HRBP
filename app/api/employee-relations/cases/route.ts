import { randomUUID } from "node:crypto";
import { CaseParticipantRole, CaseStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { listCaseWallCases } from "@/lib/case-wall";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:read")) return forbidden();
  const data = await listCaseWallCases(ctx);
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "cases:write")) return forbidden();
  const body = await request.json() as { caseType?: string; title?: string; subjectPersonId?: string; reporterPersonId?: string };
  const caseType = body.caseType?.trim();
  const title = body.title?.trim();
  if (!caseType || !title) return Response.json({ error: "caseType and title are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    if (body.subjectPersonId) {
      const subject = await tx.person.findFirst({ where: { id: body.subjectPersonId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!subject) throw new Error("SUBJECT_NOT_FOUND");
    }
    const record = await tx.employeeCase.create({
      data: {
        tenantId: ctx.tenantId,
        subjectPersonId: body.subjectPersonId,
        caseNumber: `ER-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        caseType,
        title,
        status: CaseStatus.OPEN,
        classification: DataClassification.HIGHLY_RESTRICTED,
        ownerUserId: ctx.actorId
      }
    });
    if (body.subjectPersonId) await tx.caseParticipant.create({ data: { tenantId: ctx.tenantId, caseId: record.id, personId: body.subjectPersonId, role: CaseParticipantRole.SUBJECT, addedById: ctx.actorId } });
    if (body.reporterPersonId) await tx.caseParticipant.create({ data: { tenantId: ctx.tenantId, caseId: record.id, personId: body.reporterPersonId, role: CaseParticipantRole.REPORTER, addedById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "employee-case.created", resourceType: "EmployeeCase", resourceId: record.id, classification: DataClassification.HIGHLY_RESTRICTED });
    return record;
  }).catch((error) => error instanceof Error && error.message === "SUBJECT_NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Subject person not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
