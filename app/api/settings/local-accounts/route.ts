import { DataClassification, PlatformRole, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { hashLocalPassword, validLocalPassword } from "@/lib/local-auth";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function normalizedSubject(value: unknown) {
  const text = asText(value, 191);
  if (!text) return null;
  const normalized = text.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._@-]{2,190}$/.test(normalized) ? normalized : null;
}

function roleValue(value: unknown) {
  return typeof value === "string" && Object.values(PlatformRole).includes(value as PlatformRole)
    ? value as PlatformRole
    : null;
}

const projection = {
  id: true,
  subject: true,
  displayName: true,
  email: true,
  role: true,
  active: true,
  localAuthEnabled: true,
  localPasswordUpdatedAt: true,
  localFailedAttempts: true,
  localLockedUntil: true,
  lastLocalLoginAt: true
} as const;

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();

  const data = await db.userAccount.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { localAuthEnabled: true },
        { localPasswordHash: { not: null } }
      ]
    },
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
    select: projection
  });

  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const subject = normalizedSubject(body.subject);
  const displayName = asText(body.displayName, 160);
  const email = asOptionalText(body.email, 254);
  const role = roleValue(body.role);
  const password = typeof body.password === "string" ? body.password : "";

  if (!subject || !displayName || email === null || !role) {
    return Response.json({ error: "subject, displayName and a valid role are required." }, { status: 400 });
  }
  if (!validLocalPassword(password)) {
    return Response.json({ error: "Local password must be 12-256 characters." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const created = await tx.userAccount.create({
        data: {
          tenantId: ctx.tenantId,
          subject,
          displayName,
          email: email || null,
          role,
          active: true,
          localAuthEnabled: true,
          localPasswordHash: hashLocalPassword(password),
          localPasswordUpdatedAt: new Date(),
          localFailedAttempts: 0,
          localLockedUntil: null
        },
        select: projection
      });

      await appendAudit(tx, ctx, {
        action: "settings.local-account-created",
        resourceType: "UserAccount",
        resourceId: created.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Tenant administrator provisioned a local application account"
      });
      return created;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A local account with this subject already exists in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
