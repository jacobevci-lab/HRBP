import { ApplicationStage, DataClassification, EmploymentStatus, LifecycleEventType, OfferStatus, OnboardingStatus, OnboardingTaskStatus, PositionStatus, Prisma, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OCCUPYING_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  EmploymentStatus.PREBOARDING,
  EmploymentStatus.ACTIVE,
  EmploymentStatus.LEAVE,
  EmploymentStatus.SUSPENDED
];

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function actionableDueDate(target: Date, now: Date) {
  return target < now ? now : target;
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write") || !can(ctx, "onboarding:write")) return forbidden("Hire transition requires recruiting and onboarding privileges.");

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const applicationId = asIdentifier(body.applicationId);
  const employeeNumber = String(body.employeeNumber ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim().toLowerCase() || null;
  if (!applicationId || !employeeNumber) return Response.json({ error: "A valid applicationId and employeeNumber are required." }, { status: 400 });
  if (employeeNumber.length > 64) return Response.json({ error: "employeeNumber must be 64 characters or fewer." }, { status: 400 });
  if (workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) return Response.json({ error: "workEmail must be a valid email address." }, { status: 400 });

  try {
    const result = await withDb((db) => db.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id: applicationId, tenantId: ctx.tenantId },
        include: { candidate: true, requisition: true, offer: true }
      });
      if (!application) throw new Error("APPLICATION_NOT_FOUND");
      if (application.stage !== ApplicationStage.OFFER) throw new Error("APPLICATION_STAGE_INVALID");
      if (application.candidate.hiredPersonId) throw new Error("ALREADY_HIRED");
      if (!application.offer || application.offer.status !== OfferStatus.ACCEPTED) throw new Error("ACCEPTED_OFFER_REQUIRED");
      if (application.requisition.status !== RequisitionStatus.OPEN) throw new Error("REQUISITION_NOT_OPEN");
      if (!application.requisition.positionId) throw new Error("POSITION_REQUIRED");
      if (application.requisition.openings !== 1) throw new Error("POSITION_CAPACITY_MISMATCH");

      const existingHireCount = await tx.application.count({
        where: { tenantId: ctx.tenantId, requisitionId: application.requisitionId, stage: ApplicationStage.HIRED }
      });
      if (existingHireCount >= application.requisition.openings) throw new Error("REQUISITION_FILLED");

      const duplicateEmployee = await tx.person.findFirst({
        where: { tenantId: ctx.tenantId, employeeNumber },
        select: { id: true }
      });
      if (duplicateEmployee) throw new Error("EMPLOYEE_NUMBER_EXISTS");

      if (workEmail) {
        const duplicateWorkEmail = await tx.person.findFirst({
          where: { tenantId: ctx.tenantId, workEmail },
          select: { id: true }
        });
        if (duplicateWorkEmail) throw new Error("WORK_EMAIL_EXISTS");
      }

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

      const positionUpdate = await tx.position.updateMany({
        where: { id: position.id, tenantId: ctx.tenantId, status: PositionStatus.OPEN },
        data: { status: PositionStatus.FILLED }
      });
      if (positionUpdate.count !== 1) throw new Error("STATE_CONFLICT");

      const candidateUpdate = await tx.candidate.updateMany({
        where: { id: application.candidate.id, tenantId: ctx.tenantId, hiredPersonId: null },
        data: { hiredPersonId: person.id }
      });
      if (candidateUpdate.count !== 1) throw new Error("STATE_CONFLICT");

      const applicationUpdate = await tx.application.updateMany({
        where: { id: application.id, tenantId: ctx.tenantId, stage: ApplicationStage.OFFER },
        data: { stage: ApplicationStage.HIRED }
      });
      if (applicationUpdate.count !== 1) throw new Error("STATE_CONFLICT");

      const requisitionUpdate = await tx.requisition.updateMany({
        where: { id: application.requisitionId, tenantId: ctx.tenantId, status: RequisitionStatus.OPEN },
        data: { status: RequisitionStatus.CLOSED }
      });
      if (requisitionUpdate.count !== 1) throw new Error("STATE_CONFLICT");

      const now = new Date();
      const startDate = application.offer.startDate;
      const plan = await tx.onboardingPlan.create({ data: {
        tenantId: ctx.tenantId,
        personId: person.id,
        employmentId: employment.id,
        status: OnboardingStatus.NOT_STARTED,
        targetStartDate: startDate,
        ownerId: ctx.actorId,
        tasks: { create: [
          { tenantId: ctx.tenantId, title: "Verify employment documents", ownerType: "HR", status: OnboardingTaskStatus.NOT_STARTED, sensitive: true, dueDate: actionableDueDate(addDays(startDate, -5), now) },
          { tenantId: ctx.tenantId, title: "Provision identity and baseline access", ownerType: "IT", status: OnboardingTaskStatus.NOT_STARTED, dueDate: actionableDueDate(addDays(startDate, -3), now) },
          { tenantId: ctx.tenantId, title: "Prepare equipment and workplace", ownerType: "IT", status: OnboardingTaskStatus.NOT_STARTED, dueDate: actionableDueDate(addDays(startDate, -2), now) },
          { tenantId: ctx.tenantId, title: "Assign mandatory policies and learning", ownerType: "HR", status: OnboardingTaskStatus.NOT_STARTED, dueDate: actionableDueDate(startDate, now) },
          { tenantId: ctx.tenantId, title: "Complete manager first-week plan", ownerType: "MANAGER", status: OnboardingTaskStatus.NOT_STARTED, dueDate: actionableDueDate(addDays(startDate, 7), now) }
        ] }
      }});

      await tx.employeeLifecycleEvent.create({ data: {
        tenantId: ctx.tenantId,
        personId: person.id,
        employmentId: employment.id,
        type: LifecycleEventType.HIRED,
        effectiveAt: startDate,
        summary: `Hired from requisition ${application.requisition.title}`,
        actorId: ctx.actorId
      }});

      await appendAudit(tx, ctx, {
        action: "CANDIDATE_HIRED",
        resourceType: "Person",
        resourceId: person.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Accepted-offer hire conversion"
      });

      await appendAudit(tx, ctx, {
        action: "APPLICATION_CONVERTED_TO_EMPLOYEE",
        resourceType: "Application",
        resourceId: application.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Recruiting-to-onboarding chain of custody"
      });

      return { person, employment, onboardingPlan: plan };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "APPLICATION_NOT_FOUND" || code === "POSITION_NOT_FOUND" ? 404 : 409;
    const messages: Record<string, string> = {
      APPLICATION_NOT_FOUND: "Application was not found in this tenant.",
      APPLICATION_STAGE_INVALID: "Only an application in the offer stage can be converted to an employee.",
      ALREADY_HIRED: "The candidate has already been converted to an employee.",
      ACCEPTED_OFFER_REQUIRED: "An accepted offer is required before hire conversion.",
      REQUISITION_NOT_OPEN: "The requisition must still be open before hire conversion.",
      POSITION_REQUIRED: "The requisition must be linked to a position before hiring.",
      POSITION_CAPACITY_MISMATCH: "A position-backed requisition must represent exactly one authorized headcount position.",
      REQUISITION_FILLED: "The requisition has already reached its authorized hiring capacity.",
      EMPLOYEE_NUMBER_EXISTS: "The employee number already exists in this tenant.",
      WORK_EMAIL_EXISTS: "The work email already belongs to another employee in this tenant.",
      POSITION_NOT_FOUND: "The requisition position was not found in this tenant.",
      POSITION_NOT_OPEN: "The requisition position is not open for placement.",
      POSITION_ALREADY_FILLED: "The requisition position already has an active incumbent.",
      STATE_CONFLICT: "The hiring state changed concurrently. Refresh and try again."
    };
    if (messages[code]) return Response.json({ error: messages[code] }, { status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
      return Response.json({ error: "The hiring state changed concurrently or a unique employee identity already exists. Refresh and try again." }, { status: 409 });
    }
    console.error("Candidate hire conversion failed", error);
    return Response.json({ error: "Candidate could not be converted to an employee." }, { status: 500 });
  }
}
