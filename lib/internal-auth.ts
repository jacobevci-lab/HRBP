import { timingSafeEqual } from "node:crypto";
import { runtimeString } from "@/lib/runtime-env";

export function internalBearerAuthorized(request: Request, secretName: string) {
  const expected = runtimeString(secretName);
  if (!expected || expected.length < 24) return false;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const provided = authorization.slice(7).trim();
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}
