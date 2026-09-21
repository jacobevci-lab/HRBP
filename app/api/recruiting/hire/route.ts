import { ApplicationStage, DataClassification, EmploymentStatus, LifecycleEventType, OfferStatus, OnboardingStatus, OnboardingTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:write") || !can(ctx, "onboarding:write")) return forbidden("Hire transition requires recruiting and onboarding privileges.");

  const body = await request.json() as Record<string, unknown>;
  const applicationId = String(body.applicationId ?? "").trim();
  const employeeNumber = String(body.employeeNumber ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim() || null;
  if (!applicationId || !employeeNumber) return Response.json({ error: "applicationId and employeeNumber are required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const application = await tx.application.findFirst({
      where: { id: applicationId, tenantId: ctx.tenantId },
      include: { candidate: true, requisition: true, offer: true }
    });
    if (!application) throw new Error("APPLICATION_NOT_FOUND");
    if (application.candidate.hiredPersonId) throw new Error("ALREADY_HIRED");
    if (!application.offer || application.offer.status !== OfferStatus.ACCEPTED) throw new Error("ACCEPTED_OFFER_REQUIRED");

    const person = await tx.person.create({ data: {
      tenantId: ctx.tenantId,
      employeeNumber,
      givenName: application.candidate.givenName,
      familyName: application.candidate.familyName,
      workEmail,
      personalEmail: application.candidate.email,
      classification: DataClassification.CONFIDENTIAL
    }});
    const employment = await tx.employment.create({ data: {
      tenantId: ctx.tenantId,
      personId: person.id,
      positionId: application.requisition.positionId,
      status: EmploymentStatus.PREBOARDING,
      startDate: application.offer.startDate
    }});
    await tx.candidate.update({ where: { id: application.candidate.id }, data: { hiredPersonId: person.id } });
    await tx.application.update({ where: { id: application.id }, data: { stage: ApplicationStage.HIRED } });
    const plan = await tx.onboardingPlan.create({ data: {
      tenantId: ctx.tenantId,
      personId: person.id,
      employmentId: employment.id,
      status: OnboardingStatus.NOT_STARTED,
      targetStartDate: application.offer.startDate,
      ownerId: ctx.actorId,
      tasks: { create: [
        { tenantId: ctx.tenantId, title: "Verify employment documents", ownerType: "HR", status: OnboardingTaskStatus.NOT_STARTED, sensitive: true },
        { tenantId: ctx.tenantId, title: "Provision identity and baseline access", ownerType: "IT", status: OnboardingTaskStatus.NOT_STARTED },
        { tenantId: ctx.tenantId, title: "Prepare equipment and workplace", ownerType: "IT", status: OnboardingTaskStatus.NOT_STARTED },
        { tenantId: ctx.tenantId, title: "Assign mandatory policies and learning", ownerType: "HR", status: OnboardingTaskStatus.NOT_STARTED },
        { tenantId: ctx.tenantId, title: "Complete manager first-week plan", ownerType: "MANAGER", status: OnboardingTaskStatus.NOT_STARTED }
      ] }
    }});
    await tx.employeeLifecycleEvent.create({ data: {
      tenantId: ctx.tenantId, personId: person.id, employmentId: employment.id,
      type: LifecycleEventType.HIRED, effectiveAt: application.offer.startDate,
      summary: `Hired from requisition ${application.requisition.title}`, actorId: ctx.actorId
    }});
    return { person, employment, onboardingPlan: plan };
  }).catch((error: unknown) => {
    if (error instanceof Error && ["APPLICATION_NOT_FOUND", "ALREADY_HIRED", "ACCEPTED_OFFER_REQUIRED"].includes(error.message)) return { error: error.message } as const;
    throw error;
  });

  if ("error" in result) return Response.json({ error: result.error }, { status: result.error === "APPLICATION_NOT_FOUND" ? 404 : 409 });
  await recordAudit({ ctx, action: "CANDIDATE_HIRED", resourceType: "Person", resourceId: result.person.id, classification: DataClassification.CONFIDENTIAL });
  return Response.json({ data: result }, { status: 201 });
}
