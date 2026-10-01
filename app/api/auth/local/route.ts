import { DataClassification } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { createSessionCookie } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  hashLocalPassword,
  LOCAL_AUTH_LOCK_MINUTES,
  LOCAL_AUTH_MAX_FAILURES,
  validLocalPassword,
  verifyLocalPassword
} from "@/lib/local-auth";
import { mutationOriginAllowed } from "@/lib/request-context";
import { runtimeBoolean, runtimeString } from "@/lib/runtime-env";

const DUMMY_HASH = hashLocalPassword("dummy-local-password-for-timing-only");

export async function POST(request: Request) {
  if (!runtimeBoolean("HRBP_LOCAL_AUTH_ENABLED", false)) {
    return Response.json({ error: "Local sign-in is disabled." }, { status: 404 });
  }
  if (!mutationOriginAllowed(request)) {
    return Response.json({ error: "Cross-origin mutation blocked." }, { status: 403 });
  }

  const tenantId = runtimeString("HRBP_AUTH_TENANT_ID");
  if (!tenantId) return Response.json({ error: "Local authentication tenant is not configured." }, { status: 503 });

  const body = await request.json() as { identifier?: unknown; password?: unknown; returnTo?: unknown };
  const identifier = typeof body.identifier === "string" ? body.identifier.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//")
    ? body.returnTo
    : "/";

  if (!identifier || identifier.length > 254 || !validLocalPassword(password)) {
    verifyLocalPassword(password, DUMMY_HASH);
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const now = new Date();
  const user = await db.userAccount.findFirst({
    where: {
      tenantId,
      active: true,
      localAuthEnabled: true,
      OR: [
        { subject: identifier },
        { email: { equals: identifier, mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      tenantId: true,
      subject: true,
      displayName: true,
      email: true,
      role: true,
      localPasswordHash: true,
      localFailedAttempts: true,
      localLockedUntil: true
    }
  });

  if (!user) {
    verifyLocalPassword(password, DUMMY_HASH);
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  if (user.localLockedUntil && user.localLockedUntil > now) {
    return Response.json({ error: "Local account is temporarily locked." }, { status: 423 });
  }

  const valid = verifyLocalPassword(password, user.localPasswordHash);
  if (!valid) {
    const failures = user.localFailedAttempts + 1;
    const lock = failures >= LOCAL_AUTH_MAX_FAILURES
      ? new Date(now.getTime() + LOCAL_AUTH_LOCK_MINUTES * 60_000)
      : null;
    await db.$transaction(async (tx) => {
      await tx.userAccount.update({
        where: { id: user.id },
        data: {
          localFailedAttempts: lock ? 0 : failures,
          localLockedUntil: lock
        }
      });
      await appendSystemAudit(tx, user.tenantId, user.id, {
        action: lock ? "auth.local-locked" : "auth.local-failed",
        resourceType: "UserAccount",
        resourceId: user.id,
        classification: DataClassification.RESTRICTED,
        purpose: lock ? "Local sign-in lockout threshold reached" : "Local sign-in credential failure"
      });
    });
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const identity = await db.$transaction(async (tx) => {
    const updated = await tx.userAccount.update({
      where: { id: user.id },
      data: {
        localFailedAttempts: 0,
        localLockedUntil: null,
        lastLocalLoginAt: now
      }
    });

    const person = updated.email
      ? await tx.person.findFirst({
          where: { tenantId: updated.tenantId, workEmail: { equals: updated.email, mode: "insensitive" } },
          select: {
            employments: {
              where: { status: { not: "TERMINATED" } },
              orderBy: { startDate: "desc" },
              take: 1,
              select: { id: true }
            }
          }
        })
      : null;

    await appendSystemAudit(tx, updated.tenantId, updated.id, {
      action: "auth.local-succeeded",
      resourceType: "UserAccount",
      resourceId: updated.id,
      classification: DataClassification.INTERNAL,
      purpose: "Local application sign-in"
    });

    return { user: updated, employmentId: person?.employments[0]?.id };
  });

  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", createSessionCookie({
    tenantId: identity.user.tenantId,
    actorId: identity.user.id,
    role: identity.user.role,
    employmentId: identity.employmentId,
    displayName: identity.user.displayName,
    email: identity.user.email ?? undefined,
    subject: identity.user.subject
  }));

  return new Response(JSON.stringify({ data: { authenticated: true, returnTo } }), { status: 200, headers });
}
