import { Prisma, ServiceVisibility } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { hrServiceRequestWhere, isHRServiceStaffRole } from "@/lib/hr-service-access";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext } from "@/lib/request-context";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const pageSize = 50;

/** Read-only, bounded conversation pages. Every cursor is resolved again inside
 * the current request/tenant/visibility scope; it is never an authorization grant.
 * The old comments endpoint is unchanged for existing callers.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext(request);
    if (!ctx) return json({ error: "Authentication required." }, 401);
    if (!can(ctx, "hr-service:read")) return json({ error: "Access denied." }, 403);
    const id = asIdentifier((await params).id);
    const query = new URL(request.url).searchParams;
    const before = query.has("before") ? asIdentifier(query.get("before")) : null;
    if (!id || query.getAll("before").length > 1 || (query.has("before") && !before)) {
      return json({ error: "Invalid conversation page." }, 400);
    }
    const privateNotes = isHRServiceStaffRole(ctx.role);
    const data = await db.$transaction(async tx => {
      const scope = await hrServiceRequestWhere(tx, ctx);
      const ticket = await tx.hRServiceRequest.findFirst({
        where: { AND: [scope, { id }] },
        select: { id: true, tenantId: true, requestNumber: true, title: true, description: true, status: true, updatedAt: true }
      });
      if (!ticket) throw new Error("NOT_FOUND");
      const visible = {
        tenantId: ctx.tenantId, requestId: id,
        visibility: privateNotes ? { in: [ServiceVisibility.REQUESTOR, ServiceVisibility.PRIVATE_NOTE] } : ServiceVisibility.REQUESTOR
      };
      const anchor = before ? await tx.hRServiceComment.findFirst({
        where: { ...visible, id: before }, select: { id: true, createdAt: true }
      }) : null;
      if (before && !anchor) throw new Error("NOT_FOUND");
      const rows = await tx.hRServiceComment.findMany({
        where: { ...visible, ...(anchor ? { OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } }
        ] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize + 1,
        select: { id: true, authorId: true, body: true, visibility: true, createdAt: true }
      });
      const page = rows.slice(0, pageSize);
      const authors = page.length ? await tx.userAccount.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...new Set(page.map(row => row.authorId))] } },
        select: { id: true, displayName: true }, take: pageSize
      }) : [];
      const names = new Map(authors.map(author => [author.id, author.displayName.trim().slice(0, 200) || null]));
      return {
        request: ticket,
        viewer: { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role, privateNotes },
        before,
        nextCursor: rows.length > pageSize ? page.at(-1)!.id : null,
        comments: page.reverse().map(row => ({
          id: row.id, body: row.body, visibility: row.visibility, createdAt: row.createdAt,
          authorName: names.get(row.authorId) ?? null, own: row.authorId === ctx.actorId
        }))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return json({ error: "Conversation page unavailable." }, 404);
    // Do not disclose database diagnostics, cursor identities or employee text.
    console.error("[HRBP] Conversation read could not be completed.");
    return json({ error: "Conversation could not be loaded." }, 503);
  }
}
