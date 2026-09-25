import { ApplicationStage, DataClassification, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { hasTenantRecruitingVisibility, recruitingApplicationRelationFilter, recruitingCandidateReadFilter } from "@/lib/recruiting-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:read")) return forbidden();

  const privileged = hasTenantRecruitingVisibility(ctx);
  const data = await withDb((db) => db.candidate.findMany({
    where: recruitingCandidateReadFilter(ctx),
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      givenName: true,
      familyName: true,
      source: true,
      classification: true,
      ...(privileged ? { email: true, retentionUntil: true } : {}),
      applications: {
        where: recruitingApplicationRelationFilter(ctx),
        select: { id: true, stage: true, requisition: { select: { id: true, title: true } }, offer: { select: { id: true, status: true, startDate: true } } }
      }
    }
  }));
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const givenName = String(body.givenName ?? "").trim();
  const familyName = String(body.familyName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const requisitionId = String(body.requisitionId ?? "").trim();
  const retentionUntil = body.retentionUntil ? new Date(String(body.retentionUntil)) : null;
  if (!givenName || !familyName || !email || !requisitionId) return Response.json({ error: "givenName, familyName, email and requisitionId are required." }, { status: 400 });
  if (!email.includes("@")) return Response.json({ error: "A valid candidate email is required." }, { status: 400 });
  if (retentionUntil && Number.isNaN(retentionUntil.getTime())) return Response.json({ error: "retentionUntil must be a valid date." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const requisition = await tx.requisition.findFirst({
        where: { id: requisitionId, tenantId: ctx.tenantId },
        select: { id: true, status: true }
      });
      if (!requisition) throw new Error("REQUISITION_NOT_FOUND");
      if (requisition.status !== RequisitionStatus.OPEN) throw new Error("REQUISITION_NOT_OPEN");

      let candidate = await tx.candidate.findUnique({
        where: { tenantId_email: { tenantId: ctx.tenantId, email } },
        select: { id: true, hiredPersonId: true }
      });

      if (candidate?.hiredPersonId) throw new Error("CANDIDATE_ALREADY_HIRED");
      if (candidate) {
        const duplicate = await tx.application.findUnique({
          where: { candidateId_requisitionId: { candidateId: candidate.id, requisitionId } },
          select: { id: true }
        });
        if (duplicate) throw new Error("APPLICATION_EXISTS");
        await tx.candidate.update({
          where: { id: candidate.id },
          data: {
            givenName,
            familyName,
            phone: String(body.phone ?? "").trim() || undefined,
            source: String(body.source ?? "").trim() || undefined,
            privacyNoticeVersion: String(body.privacyNoticeVersion ?? "").trim() || undefined,
            retentionUntil: retentionUntil ?? undefined
          }
        });
      } else {
        candidate = await tx.candidate.create({
          data: {
            tenantId: ctx.tenantId,
            givenName,
            familyName,
            email,
            phone: String(body.phone ?? "").trim() || null,
            source: String(body.source ?? "").trim() || null,
            privacyNoticeVersion: String(body.privacyNoticeVersion ?? "").trim() || null,
            retentionUntil,
            classification: DataClassification.RESTRICTED
          },
          select: { id: true, hiredPersonId: true }
        });
      }

      const application = await tx.application.create({
        data: {
          tenantId: ctx.tenantId,
          candidateId: candidate.id,
          requisitionId,
          stage: ApplicationStage.APPLIED,
          source: String(body.source ?? "").trim() || null
        },
        select: { id: true, stage: true }
      });

      await appendAudit(tx, ctx, {
        action: "CANDIDATE_APPLICATION_CREATED",
        resourceType: "Application",
        resourceId: application.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Candidate application processing"
      });

      return { candidateId: candidate.id, applicationId: application.id, stage: application.stage };
    }));
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "REQUISITION_NOT_FOUND") return Response.json({ error: "Requisition was not found in this tenant." }, { status: 404 });
    if (code === "REQUISITION_NOT_OPEN") return Response.json({ error: "Candidates can only be added to an open requisition." }, { status: 409 });
    if (code === "CANDIDATE_ALREADY_HIRED") return Response.json({ error: "This candidate has already been converted to an employee." }, { status: 409 });
    if (code === "APPLICATION_EXISTS") return Response.json({ error: "This candidate already has an application for the requisition." }, { status: 409 });
    console.error("Candidate application creation failed", error);
    return Response.json({ error: "Candidate application could not be created." }, { status: 500 });
  }
}
