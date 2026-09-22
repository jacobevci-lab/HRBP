import { ApplicationStage, DataClassification, EmploymentStatus, LifecycleEventType, OfferStatus, OnboardingStatus, OnboardingTaskStatus, PositionStatus, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OCCUPYING_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  EmploymentStatus.PREBOARDING,
  EmploymentStatus.ACTIVE,
  EmploymentStatus.LEAVE,
  EmploymentStatus.SUSPENDED
];

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write") || !can(ctx, "onboarding:write")) return forbidden("Hire transition requires recruiting and onboarding privileges.");

  const body = await request.json() as Record<string, unknown>;
  const applicationId = String(body.applicationId ?? "").trim();
  const employeeNumber = String(body.employeeNumber ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim().toLowerCase() || null;
  if (!applicationId || !employeeNumber) return Response.json({ error: "applicationId and employeeNumber are required." }, { status: 400 });
  if (workEmail && !workEmail.includes("@")) return Response.json({ error: "workEmail must be a valid email address." }, { status: 400 });

  try {
    const result = await withDb((db) => db.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id: applicationId, tenantId: ctx.tenantId },
        include: { candidate: true, requisition: true, offer: true }
      });
      if (!application) throw new Error("APPLICATION_NOT_FOUND");
      if (application.candidate.hiredPersonId) throw new Error("ALREADY_HIRED");
      if (!application.offer || application.offer.status !== OfferStatus.ACCEPTED) throw new Error("ACCEPTED_OFFER_REQUIRED");
      if (!application.requisition.positionId) throw new Error("POSITION_REQUIRED");

      const duplicateEmployee = await tx.person.findFirst({
        where: { tenantId: ctx.tenantId, employeeNumber },
        select: { id: true }
      });
      if (duplicateEmployee) throw new Error("EMPLOYEE_NUMBER_EXISTS");

      const position = await tx.position.findFirst({
        where: { id: application.requisition.positionId, tenantId: ctx.tenantId },
        select: { id: true, status: true }
      });
      if (!position) throw new Error("POSITION_NOT_FOUND");
      if (position.status !== PositionStatus.OPEN) throw new Error("POSITION_NOT_OPEN");

      const incumbent = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, positionId: position.id, status: { in: OCCUPYING_EMPLOYMENT_STATUSES } },
        select: { id: true }
      });
      if (incumbent) throw new Error("POSITION_ALREADY_FILLED");

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
        positionId: position.id,
        status: EmploymentStatus.PREBOARDING,
        startDate: application.offer.startDate
      }});

      await tx.position.update({ where: { id: position.id }, data: { status: PositionStatus.FILLED } });
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
        tenantId: ctx.tenantId,
        personId: person.id,
        employmentId: employment.id,
        type: LifecycleEventType.HIRED,
        effectiveAt: application.offer.startDate,
        summary: `Hired from requisition ${application.requisition.title}`,
        actorId: ctx.actorId
      }});

      const hiredCount = await tx.application.count({
        where: { tenantId: ctx.tenantId, requisitionId: application.requisitionId, stage: ApplicationStage.HIRED }
      });
      if (hiredCount >= application.requisition.openings) {
        await tx.requisition.update({ where: { id: application.requisitionId }, data: { status: RequisitionStatus.CLOSED } });
      }

      await appendAudit(tx, ctx, {
        action: "CANDIDATE_HIRED",
        resourceType: "Person",
        resourceId: person.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Accepted-offer hire conversion"
      });

      return { person, employment, onboardingPlan: plan };
    }));

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "APPLICATION_NOT_FOUND" || code === "POSITION_NOT_FOUND" ? 404 : 409;
    const messages: Record<string, string> = {
      APPLICATION_NOT_FOUND: "Application was not found in this tenant.",
      ALREADY_HIRED: "The candidate has already been converted to an employee.",
      ACCEPTED_OFFER_REQUIRED: "An accepted offer is required before hire conversion.",
      POSITION_REQUIRED: "The requisition must be linked to a position before hiring.",
      EMPLOYEE_NUMBER_EXISTS: "The employee number already exists in this tenant.",
      POSITION_NOT_FOUND: "The requisition position was not found in this tenant.",
      POSITION_NOT_OPEN: "The requisition position is not open for placement.",
      POSITION_ALREADY_FILLED: "The requisition position already has an active incumbent."
    };
    if (messages[code]) return Response.json({ error: messages[code] }, { status });
    console.error("Candidate hire conversion failed", error);
    return Response.json({ error: "Candidate could not be converted to an employee." }, { status: 500 });
  }
}
