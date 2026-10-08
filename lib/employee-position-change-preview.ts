import { createHash } from "node:crypto";
import { decodeSignedPayload, encodeSignedPayload, sessionSecret } from "@/lib/auth-session";

export type PositionChangeEventType = "TRANSFERRED" | "PROMOTED";

type PositionChangePreviewClaims = {
  v: 1;
  kind: "employee-position-change";
  tenantId: string;
  actorId: string;
  personId: string;
  employmentId: string;
  sourcePositionId: string | null;
  targetPositionId: string;
  eventType: PositionChangeEventType;
  effectiveAt: string;
  reasonDigest: string;
  issuedAt: number;
  exp: number;
};

function digestReason(reason: string) {
  return createHash("sha256").update(reason, "utf8").digest("hex");
}

function boundedId(value: unknown) {
  return typeof value === "string" && value.length >= 1 && value.length <= 191 ? value : null;
}

export function createPositionChangePreviewReceipt(input: {
  tenantId: string;
  actorId: string;
  personId: string;
  employmentId: string;
  sourcePositionId: string | null;
  targetPositionId: string;
  eventType: PositionChangeEventType;
  effectiveAt: Date;
  reason: string;
}) {
  const secret = sessionSecret();
  if (!secret) throw new Error("HRBP_SESSION_SECRET is not configured.");
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + 10 * 60;
  const claims: PositionChangePreviewClaims = {
    v: 1,
    kind: "employee-position-change",
    tenantId: input.tenantId,
    actorId: input.actorId,
    personId: input.personId,
    employmentId: input.employmentId,
    sourcePositionId: input.sourcePositionId,
    targetPositionId: input.targetPositionId,
    eventType: input.eventType,
    effectiveAt: input.effectiveAt.toISOString(),
    reasonDigest: digestReason(input.reason),
    issuedAt,
    exp
  };
  return {
    token: encodeSignedPayload(claims, secret),
    expiresAt: new Date(exp * 1000)
  };
}

export function verifyPositionChangePreviewReceipt(token: string, expected: {
  tenantId: string;
  actorId: string;
  personId: string;
  targetPositionId: string;
  eventType: PositionChangeEventType;
  effectiveAt: Date;
  reason: string;
}) {
  if (!token || token.length > 8192) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const claims = decodeSignedPayload<PositionChangePreviewClaims>(token, secret);
  if (!claims || claims.v !== 1 || claims.kind !== "employee-position-change") return null;
  if (!boundedId(claims.tenantId) || !boundedId(claims.actorId) || !boundedId(claims.personId) ||
      !boundedId(claims.employmentId) || !boundedId(claims.targetPositionId)) return null;
  if (claims.sourcePositionId !== null && !boundedId(claims.sourcePositionId)) return null;
  if (claims.eventType !== "TRANSFERRED" && claims.eventType !== "PROMOTED") return null;
  if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.exp) ||
      claims.exp <= claims.issuedAt || claims.exp - claims.issuedAt > 10 * 60) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.issuedAt > now + 60) return null;
  if (claims.tenantId !== expected.tenantId ||
      claims.actorId !== expected.actorId ||
      claims.personId !== expected.personId ||
      claims.targetPositionId !== expected.targetPositionId ||
      claims.eventType !== expected.eventType ||
      claims.effectiveAt !== expected.effectiveAt.toISOString() ||
      claims.reasonDigest !== digestReason(expected.reason)) return null;
  return claims;
}
