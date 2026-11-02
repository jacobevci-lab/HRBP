import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { normalizeArchitectureCode } from "@/lib/job-architecture-input.mjs";
import { asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function prismaCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "job-architecture:read")) return forbidden();
  const data = await db.jobFamily.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true, code: true, name: true, description: true, active: true,
      createdAt: true, updatedAt: true,
      _count: { select: { profiles: true } }
    }
  });
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "job-architecture:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const code = normalizeArchitectureCode(body.code);
  const name = asText(body.name, 180);
  const description = asOptionalText(body.description, 2000);
  if (!code || !name) return Response.json({ error: "code and name are required." }, { status: 400 });
  if (description === null) return Response.json({ error: "description must not exceed 2000 characters." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const family = await tx.jobFamily.create({
        data: { tenantId: ctx.tenantId, code, name, description: description ?? null }
      });
      await appendAudit(tx, ctx, {
        action: "job-family.created",
        resourceType: "JobFamily",
        resourceId: family.id,
        classification: DataClassification.INTERNAL,
        purpose: "Governed job architecture"
      });
      return family;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      return Response.json({ error: "A job family with this code already exists in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
