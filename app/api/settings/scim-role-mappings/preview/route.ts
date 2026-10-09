import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { isScimDirectoryAssignableRole, previewScimRoleMapping } from "@/lib/scim-role-mapping";

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const groupId = asIdentifier(body.groupId);
  const role = isScimDirectoryAssignableRole(body.role) ? body.role : null;
  if (!groupId || !role) {
    return Response.json({ error: "groupId and an allowed workforce role are required." }, { status: 400 });
  }

  const data = await previewScimRoleMapping(db, ctx.tenantId, groupId, role);
  if (!data) return Response.json({ error: "SCIM group was not found in this tenant." }, { status: 404 });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
