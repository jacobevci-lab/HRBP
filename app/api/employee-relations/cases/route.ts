import { randomUUID } from "node:crypto";
import { CaseParticipantRole, CaseStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { listCaseWallCases } from "@/lib/case-wall";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

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
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "cases:write")) return forbidden();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const caseType = asText(body.caseType, 80);
  const title = asText(body.title, 200);
  const subjectPersonId = body.subjectPersonId === undefined || body.subjectPersonId === null || body.subjectPersonId === "" ? null : asIdentifier(body.subjectPersonId);
  const reporterPersonId = body.reporterPersonId === undefined || body.reporterPersonId === null || body.reporterPersonId === "" ? null : asIdentifier(body.reporterPersonId);
  if (!caseType || !title) return Response.json({ error: "caseType (1–80) and title (1–200) are required." }, { status: 400 });
  if (body.subjectPersonId && !subjectPersonId) return Response.json({ error: "subjectPersonId must be a valid identifier." }, { status: 400 });
  if (body.reporterPersonId && !reporterPersonId) return Response.json({ error: "reporterPersonId must be a valid identifier." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const personIds = [...new Set([subjectPersonId, reporterPersonId].filter((value): value is string => Boolean(value)))];
    if (personIds.length) {
      const people = await tx.person.findMany({ where: { tenantId: ctx.tenantId, id: { in: personIds } }, select: { id: true } });
      if (people.length !== personIds.length) throw new Error("PERSON_NOT_FOUND");
    }

    const record = await tx.employeeCase.create({
      data: {
        tenantId: ctx.tenantId,
        subjectPersonId,
        caseNumber: `ER-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        caseType,
        title,
        status: CaseStatus.OPEN,
        classification: DataClassification.HIGHLY_RESTRICTED,
        ownerUserId: ctx.actorId
      }
    });
    if (subjectPersonId) await tx.caseParticipant.create({ data: { tenantId: ctx.tenantId, caseId: record.id, personId: subjectPersonId, role: CaseParticipantRole.SUBJECT, addedById: ctx.actorId } });
    if (reporterPersonId) await tx.caseParticipant.create({ data: { tenantId: ctx.tenantId, caseId: record.id, personId: reporterPersonId, role: CaseParticipantRole.REPORTER, addedById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "employee-case.created", resourceType: "EmployeeCase", resourceId: record.id, classification: DataClassification.HIGHLY_RESTRICTED, purpose: "Governed employee-relations case intake" });
    return record;
  }).catch((error) => error instanceof Error && error.message === "PERSON_NOT_FOUND" ? null : Promise.reject(error));

  if (!data) return Response.json({ error: "Subject or reporter person was not found in this tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
