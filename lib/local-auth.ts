import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const N = 16384;
const R = 8;
const P = 1;
const MAX_PASSWORD_LENGTH = 256;

export function validLocalPassword(value: unknown) {
  return typeof value === "string" && value.length >= 12 && value.length <= MAX_PASSWORD_LENGTH;
}

export function hashLocalPassword(password: string) {
  if (!validLocalPassword(password)) throw new Error("LOCAL_PASSWORD_POLICY");
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/** Narrow compatibility for the historical seed typo, not arbitrary password formats. */
export function isLegacySeedPasswordHash(value: string | null | undefined) {
  return typeof value === "string" && /^scrypt\$16384\$8\$1[A-Za-z0-9_-]{108}$/.test(value);
}

export function verifyLocalPassword(password: string, encoded: string | null | undefined) {
  if (!validLocalPassword(password) || !encoded) return false;
  const legacy = isLegacySeedPasswordHash(encoded);
  const suffix = legacy ? encoded.slice("scrypt$16384$8$1".length) : "";
  const parts = legacy ? ["scrypt", "16384", "8", "1", suffix.slice(0, 22), suffix.slice(22)] : encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (cost !== N || blockSize !== R || parallelization !== P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH || salt.toString("base64url") !== parts[4] || expected.toString("base64url") !== parts[5]) return false;

  const actual = scryptSync(password, salt, KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const LOCAL_AUTH_MAX_FAILURES = 5;
export const LOCAL_AUTH_LOCK_MINUTES = 15;
