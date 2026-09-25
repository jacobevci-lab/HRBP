import { OfferStatus, RequisitionStatus } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

type ApprovalQueueItem = {
  type: "REQUISITION" | "OFFER";
  id: string;
  title: string;
  subtitle: string;
  preparedBy: string;
  selfPrepared: boolean;
  submittedAt: string;
};

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:write")) return forbidden("Recruiting operations authority is required for the approval queue.");

  const items = await withDb(async (db) => {
    const [requisitions, offers] = await Promise.all([
      db.requisition.findMany({
        where: { tenantId: ctx.tenantId, status: RequisitionStatus.APPROVAL },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          title: true,
          openings: true,
          createdAt: true,
          position: { select: { positionCode: true, title: true } }
        }
      }),
      db.offer.findMany({
        where: { tenantId: ctx.tenantId, status: OfferStatus.APPROVAL },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          currency: true,
          annualBase: true,
          startDate: true,
          createdAt: true,
          application: {
            select: {
              candidate: { select: { givenName: true, familyName: true } },
              requisition: { select: { title: true } }
            }
          }
        }
      })
    ]);

    const requisitionIds = requisitions.map((item) => item.id);
    const offerIds = offers.map((item) => item.id);
    if (!requisitionIds.length && !offerIds.length) return [] satisfies ApprovalQueueItem[];

    const audits = await db.auditEvent.findMany({
      where: {
        tenantId: ctx.tenantId,
        action: {
          in: [
            "REQUISITION_CREATED",
            "REQUISITION_STATUS_DRAFT_TO_APPROVAL",
            "OFFER_CREATED",
            "OFFER_STATUS_DRAFT_TO_APPROVAL"
          ]
        },
        OR: [
          { resourceType: "Requisition", resourceId: { in: requisitionIds } },
          { resourceType: "Offer", resourceId: { in: offerIds } }
        ]
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { resourceType: true, resourceId: true, action: true, actorId: true, occurredAt: true }
    });

    const creators = new Map<string, { actorId: string; occurredAt: Date }>();
    const submissions = new Map<string, Date>();
    for (const audit of audits) {
      const key = `${audit.resourceType}:${audit.resourceId}`;
      if ((audit.action === "REQUISITION_CREATED" || audit.action === "OFFER_CREATED") && !creators.has(key)) {
        creators.set(key, { actorId: audit.actorId, occurredAt: audit.occurredAt });
      }
      if (audit.action === "REQUISITION_STATUS_DRAFT_TO_APPROVAL" || audit.action === "OFFER_STATUS_DRAFT_TO_APPROVAL") {
        submissions.set(key, audit.occurredAt);
      }
    }

    const actorIds = [...new Set([...creators.values()].map((item) => item.actorId))];
    const users = actorIds.length ? await db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, id: { in: actorIds }, active: true },
      select: { id: true, displayName: true }
    }) : [];
    const userNames = new Map(users.map((user) => [user.id, user.displayName]));

    const queue: ApprovalQueueItem[] = [];
    for (const requisition of requisitions) {
      const key = `Requisition:${requisition.id}`;
      const creator = creators.get(key);
      const position = requisition.position ? `${requisition.position.positionCode} · ${requisition.position.title}` : "Unassigned position";
      queue.push({
        type: "REQUISITION",
        id: requisition.id,
        title: requisition.title,
        subtitle: `${position} · ${requisition.openings} opening${requisition.openings === 1 ? "" : "s"}`,
        preparedBy: creator ? (userNames.get(creator.actorId) ?? creator.actorId) : "Unknown preparer",
        selfPrepared: creator?.actorId === ctx.actorId,
        submittedAt: (submissions.get(key) ?? creator?.occurredAt ?? requisition.createdAt).toISOString()
      });
    }

    for (const offer of offers) {
      const key = `Offer:${offer.id}`;
      const creator = creators.get(key);
      const candidateName = `${offer.application.candidate.givenName} ${offer.application.candidate.familyName}`;
      queue.push({
        type: "OFFER",
        id: offer.id,
        title: offer.application.requisition.title,
        subtitle: `${candidateName} · ${offer.currency} ${offer.annualBase.toString()} · start ${offer.startDate.toISOString().slice(0, 10)}`,
        preparedBy: creator ? (userNames.get(creator.actorId) ?? creator.actorId) : "Unknown preparer",
        selfPrepared: creator?.actorId === ctx.actorId,
        submittedAt: (submissions.get(key) ?? creator?.occurredAt ?? offer.createdAt).toISOString()
      });
    }

    return queue.sort((left, right) => Date.parse(left.submittedAt) - Date.parse(right.submittedAt));
  });

  return Response.json({ data: { items } });
}
