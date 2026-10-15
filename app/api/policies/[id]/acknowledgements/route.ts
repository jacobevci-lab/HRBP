import { createHash } from "node:crypto";
import { DataClassification, EmploymentStatus, PolicyAssignmentStatus, PolicyStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };
const hashPattern = /^[a-f0-9]{64}$/;
// The hash is retained inside the existing tamper-evident audit payload, in the
// same transaction as the acknowledgement. Never backfill it for old receipts.
function binding(version: string, contentHash: string) {
  return JSON.stringify({ schema: "policy-ack-content/v1", version, contentHash });
}
function validContent(policy: { contentMarkdown: string; contentHash: string; version: string }) {
  return typeof policy.contentMarkdown === "string" && policy.contentMarkdown.trim().length > 0
    && Buffer.byteLength(policy.contentMarkdown, "utf8") <= 65_536
    && asIdentifier(policy.version) === policy.version && hashPattern.test(policy.contentHash)
    && createHash("sha256").update(policy.contentMarkdown, "utf8").digest("hex") === policy.contentHash;
}

/** Assigned employee preview, never a public policy download or proof of human
 * comprehension. One statement returns the displayed bytes and their snapshot.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:acknowledge") || !ctx.employmentId) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400, headers: privateHeaders });
  try {
    const now = new Date();
    // No GET lock or write. POST rechecks all prerequisites and the exact
    // snapshot under locks; a preview can legitimately become stale afterward.
    const policy = await db.policyRecord.findFirst({
      where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED,
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        assignments: { some: { tenantId: ctx.tenantId, employmentId: ctx.employmentId,
          status: { in: [PolicyAssignmentStatus.PENDING, PolicyAssignmentStatus.OVERDUE, PolicyAssignmentStatus.ACKNOWLEDGED] } } } },
      select: { id: true, title: true, version: true, contentMarkdown: true, contentHash: true }
    });
    const employment = await db.employment.findFirst({ where: { id: ctx.employmentId, tenantId: ctx.tenantId,
      status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } });
    if (!policy || !employment) return Response.json({ error: "Effective published policy assignment not found." }, { status: 404, headers: privateHeaders });
    if (!validContent(policy)) return Response.json({ error: "Policy content is inconsistent. Ask the policy owner to review it." }, { status: 409, headers: privateHeaders });
    return Response.json({ data: policy }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Policy content is unavailable. Retry reading the policy later." }, { status: 503, headers: privateHeaders });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:acknowledge")) return forbidden();
  if (!ctx.employmentId) return forbidden("Trusted employment context is required for acknowledgement.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  const policyVersion = asIdentifier(body?.policyVersion);
  const contentHash = body?.contentHash;
  // Old tabs/clients fail closed. Do not silently substitute today's content
  // for the version that the employee actually had open in their browser.
  if (!policyVersion || typeof contentHash !== "string" || !hashPattern.test(contentHash)) {
    return Response.json({ error: "The displayed policyVersion and SHA-256 contentHash are required. Reopen the policy before acknowledging." }, { status: 400, headers: privateHeaders });
  }

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`/* policy-ack:employment */ SELECT "id" FROM "Employment"
      WHERE "id" = ${ctx.employmentId} AND "tenantId" = ${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`/* policy-ack:policy */ SELECT "id" FROM "PolicyRecord"
      WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`/* policy-ack:assignment */ SELECT "id" FROM "PolicyAssignment"
      WHERE "policyId" = ${id} AND "employmentId" = ${ctx.employmentId}
        AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;

    const now = new Date();
    const [policy, employment, assignment] = await Promise.all([
      tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED,
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        select: { id: true, version: true, contentHash: true, contentMarkdown: true } }),
      tx.employment.findFirst({ where: { id: ctx.employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } }),
      tx.policyAssignment.findFirst({ where: { tenantId: ctx.tenantId, policyId: id, employmentId: ctx.employmentId }, select: { id: true, status: true } })
    ]);
    if (!policy || !employment || !assignment) throw new Error("NOT_FOUND");
    if (assignment.status === PolicyAssignmentStatus.WAIVED) throw new Error("STATE");
    if (policy.version !== policyVersion || policy.contentHash !== contentHash || !validContent(policy)) throw new Error("CONTENT_CHANGED");

    const existing = await tx.policyAcknowledgement.findFirst({
      where: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, policyVersion: policy.version }
    });
    if (existing) {
      if (assignment.status !== PolicyAssignmentStatus.ACKNOWLEDGED) throw new Error("STATE");
      // Validate the ORIGINAL event, not a newly manufactured hash on replay.
      // Missing/legacy/duplicate bindings need controlled review, not backfill.
      const events = await tx.auditEvent.findMany({ where: { tenantId: ctx.tenantId,
        resourceType: "PolicyAcknowledgement", resourceId: existing.id, action: "policy.acknowledged" },
        select: { purpose: true }, take: 2 });
      if (events.length !== 1 || events[0].purpose !== binding(policyVersion, contentHash)) throw new Error("CONTENT_CHANGED");
      return { data: existing, replayed: true };
    }
    if (assignment.status !== PolicyAssignmentStatus.PENDING && assignment.status !== PolicyAssignmentStatus.OVERDUE) throw new Error("STATE");

    await tx.policyAssignment.update({
      where: { id: assignment.id, tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, status: assignment.status },
      data: { status: PolicyAssignmentStatus.ACKNOWLEDGED }
    });
    const acknowledgement = await tx.policyAcknowledgement.create({
      data: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, policyVersion: policy.version,
        acknowledgedBy: ctx.actorId, acknowledgedAt: now, ipAddress: ctx.ipAddress }
    });
    await appendAudit(tx, ctx, { action: "policy.acknowledged", resourceType: "PolicyAcknowledgement", resourceId: acknowledgement.id,
      classification: DataClassification.CONFIDENTIAL, purpose: binding(policy.version, policy.contentHash) });
    return { data: acknowledgement, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "STATE", "CONTENT_CHANGED"].includes(error.message)) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code)) return "STATE";
    console.error("[HRBP] Policy acknowledgement could not be completed.");
    return "UNAVAILABLE";
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Effective published policy assignment not found." }, { status: 404, headers: privateHeaders });
  if (result === "CONTENT_CHANGED") return Response.json({ error: "The displayed policy content changed or its original content binding is unavailable. Reload and review before continuing." }, { status: 409, headers: privateHeaders });
  if (result === "STATE") return Response.json({ error: "Policy assignment state changed or its receipt is inconsistent. Refresh before continuing." }, { status: 409, headers: privateHeaders });
  if (typeof result === "string") return Response.json({ error: "Policy acknowledgement is unavailable. Reload the current record before retrying." }, { status: 503, headers: privateHeaders });
  // policyContentHash is a verified projection of the persisted audit binding,
  // not a new mutable column or a claim about legacy receipt content.
  return Response.json({ data: { ...result.data, policyContentHash: contentHash }, meta: { replayed: result.replayed } }, { status: 201, headers: privateHeaders });
}
