import { DataClassification, PayrollPeriodStatus, PayrollRunStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden, type Capability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { computePayrollInputFingerprint, getLockedPayrollInputFingerprint, getPayrollRunReadiness } from "@/lib/payroll-governance";
import { enqueuePayrollApprovalNotification, enqueuePayrollApprovedNotification, enqueuePayrollPaidNotification } from "@/lib/payroll-notifications";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { canTransitionPayroll } from "@/lib/work-pay-state";

class PayrollReadinessError extends Error {
  constructor(readonly blockers: Record<string, number>) {
    super("PAYROLL_INPUTS_NOT_READY");
  }
}

function capabilityFor(next: PayrollRunStatus): Capability {
  if (next === PayrollRunStatus.APPROVED) return "payroll:approve";
  if (next === PayrollRunStatus.PAID) return "payroll:pay";
  return "payroll:prepare";
}

async function assertInputFingerprint(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
  const [locked, current] = await Promise.all([
    getLockedPayrollInputFingerprint(tx, tenantId, runId),
    computePayrollInputFingerprint(tx, tenantId, runId)
  ]);
  if (!locked || !current || locked !== current) throw new Error("INPUT_DRIFT");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid payroll run id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(PayrollRunStatus));
  if (!next) return Response.json({ error: "A valid payroll run status is required." }, { status: 400 });
  if (!can(ctx, capabilityFor(next))) return forbidden("This payroll transition requires a separated prepare, approval or payment capability.");

  try {
    const result = await db.$transaction(async (tx) => {
      const current = await tx.payrollRun.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          runNumber: true,
          status: true,
          approvedById: true,
          payrollPeriod: {
            select: {
              id: true,
              code: true,
              status: true,
              payDate: true,
              countryPack: { select: { countryCode: true } }
            }
          }
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (!canTransitionPayroll(current.status, next)) throw new Error("INVALID_TRANSITION");

      const creatorAudit = await tx.auditEvent.findFirst({
        where: { tenantId: ctx.tenantId, resourceType: "PayrollRun", resourceId: id, action: "payroll-run.created" },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorId: true }
      });

      if (next === PayrollRunStatus.APPROVED && creatorAudit?.actorId === ctx.actorId) throw new Error("FOUR_EYES_REQUIRED");
      if (next === PayrollRunStatus.PAID && current.approvedById === ctx.actorId) throw new Error("PAYMENT_SEPARATION_REQUIRED");

      const lockingInputs = next === PayrollRunStatus.VALIDATING && (current.status === PayrollRunStatus.DRAFT || current.status === PayrollRunStatus.EXCEPTION);
      if (lockingInputs) {
        const readiness = await getPayrollRunReadiness(tx, ctx.tenantId, id);
        if (!readiness) throw new Error("NOT_FOUND");
        if (readiness.blockerCount) throw new PayrollReadinessError(readiness.blockers);
        const fingerprint = await computePayrollInputFingerprint(tx, ctx.tenantId, id);
        if (!fingerprint) throw new Error("INPUT_FINGERPRINT_FAILED");

        const periodWrite = await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: { in: [PayrollPeriodStatus.OPEN, PayrollPeriodStatus.INPUT_LOCKED] } },
          data: { status: PayrollPeriodStatus.INPUT_LOCKED }
        });
        if (periodWrite.count !== 1) throw new Error("PERIOD_STATE_CONFLICT");
        await appendAudit(tx, ctx, {
          action: "payroll-run.inputs-locked",
          resourceType: "PayrollRun",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `Payroll input lock sha256:${fingerprint}`
        });
      }

      if (next === PayrollRunStatus.CALCULATED) {
        const readiness = await getPayrollRunReadiness(tx, ctx.tenantId, id);
        if (!readiness) throw new Error("NOT_FOUND");
        if (readiness.blockerCount) throw new PayrollReadinessError(readiness.blockers);
        await assertInputFingerprint(tx, ctx.tenantId, id);
        const periodWrite = await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: PayrollPeriodStatus.INPUT_LOCKED },
          data: { status: PayrollPeriodStatus.CALCULATING }
        });
        if (periodWrite.count !== 1) throw new Error("PERIOD_STATE_CONFLICT");
      }

      if (next === PayrollRunStatus.APPROVAL) {
        await assertInputFingerprint(tx, ctx.tenantId, id);
        const periodWrite = await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: PayrollPeriodStatus.CALCULATING },
          data: { status: PayrollPeriodStatus.REVIEW }
        });
        if (periodWrite.count !== 1) throw new Error("PERIOD_STATE_CONFLICT");
      }

      if (next === PayrollRunStatus.APPROVED) {
        await assertInputFingerprint(tx, ctx.tenantId, id);
        const periodWrite = await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: PayrollPeriodStatus.REVIEW },
          data: { status: PayrollPeriodStatus.APPROVED }
        });
        if (periodWrite.count !== 1) throw new Error("PERIOD_STATE_CONFLICT");
      }

      if (next === PayrollRunStatus.PAID) {
        await assertInputFingerprint(tx, ctx.tenantId, id);
        const periodWrite = await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: PayrollPeriodStatus.APPROVED },
          data: { status: PayrollPeriodStatus.PAID }
        });
        if (periodWrite.count !== 1) throw new Error("PERIOD_STATE_CONFLICT");
      }

      if (next === PayrollRunStatus.EXCEPTION) {
        await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: { in: [PayrollPeriodStatus.INPUT_LOCKED, PayrollPeriodStatus.CALCULATING, PayrollPeriodStatus.REVIEW] } },
          data: { status: PayrollPeriodStatus.INPUT_LOCKED }
        });
      }

      if (next === PayrollRunStatus.CANCELLED) {
        await tx.payrollPeriod.updateMany({
          where: { id: current.payrollPeriod.id, tenantId: ctx.tenantId, status: { in: [PayrollPeriodStatus.OPEN, PayrollPeriodStatus.INPUT_LOCKED, PayrollPeriodStatus.CALCULATING, PayrollPeriodStatus.REVIEW] } },
          data: { status: PayrollPeriodStatus.OPEN }
        });
      }

      const now = new Date();
      const write = await tx.payrollRun.updateMany({
        where: { id, tenantId: ctx.tenantId, status: current.status },
        data: {
          status: next,
          ...(next === PayrollRunStatus.VALIDATING ? { calculatedAt: null } : {}),
          ...(next === PayrollRunStatus.CALCULATED ? { calculatedAt: now } : {}),
          ...(next === PayrollRunStatus.APPROVED ? { approvedAt: now, approvedById: ctx.actorId } : {}),
          ...(next === PayrollRunStatus.PAID ? { paidAt: now } : {})
        }
      });
      if (write.count !== 1) throw new Error("STALE_STATE");

      await appendAudit(tx, ctx, {
        action: `payroll-run.${next.toLowerCase()}`,
        resourceType: "PayrollRun",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Governed payroll lifecycle transition"
      });

      if (next === PayrollRunStatus.APPROVAL) {
        await enqueuePayrollApprovalNotification(tx, {
          tenantId: ctx.tenantId,
          runId: id,
          periodCode: current.payrollPeriod.code,
          countryCode: current.payrollPeriod.countryPack.countryCode,
          runNumber: current.runNumber,
          payDate: current.payrollPeriod.payDate
        });
      }
      if (next === PayrollRunStatus.APPROVED) {
        await enqueuePayrollApprovedNotification(tx, {
          tenantId: ctx.tenantId,
          recipientUserId: creatorAudit?.actorId,
          runId: id,
          periodCode: current.payrollPeriod.code,
          countryCode: current.payrollPeriod.countryPack.countryCode,
          runNumber: current.runNumber,
          payDate: current.payrollPeriod.payDate
        });
      }
      if (next === PayrollRunStatus.PAID) {
        await enqueuePayrollPaidNotification(tx, {
          tenantId: ctx.tenantId,
          runId: id,
          periodCode: current.payrollPeriod.code,
          countryCode: current.payrollPeriod.countryPack.countryCode,
          runNumber: current.runNumber,
          payDate: current.payrollPeriod.payDate
        });
      }

      const updated = await tx.payrollRun.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof PayrollReadinessError) {
      return Response.json({ error: "Payroll inputs are not ready to lock or calculate.", blockers: error.blockers }, { status: 409 });
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Payroll run not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Payroll run cannot transition to that state." }, { status: 409 });
    if (code === "FOUR_EYES_REQUIRED") return forbidden("Four-eyes control: the actor who created this payroll run cannot approve it.");
    if (code === "PAYMENT_SEPARATION_REQUIRED") return forbidden("Payment separation: the actor who approved this payroll run cannot mark it paid.");
    if (code === "INPUT_DRIFT") return Response.json({ error: "Payroll inputs changed after the last input lock. Move the run to EXCEPTION, correct inputs, and validate again." }, { status: 409 });
    if (code === "INPUT_FINGERPRINT_FAILED") return Response.json({ error: "Payroll input fingerprint could not be created." }, { status: 409 });
    if (code === "PERIOD_STATE_CONFLICT" || code === "STALE_STATE") return Response.json({ error: "Payroll run or period state changed concurrently. Refresh and retry." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Payroll state changed concurrently. Retry the transition." }, { status: 409 });
    throw error;
  }
}
