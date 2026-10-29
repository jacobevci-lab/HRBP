/** Current acceptance against an independently enrolled OFFLINE trust-register snapshot.
 * This is neither live revocation discovery nor historical signature-time validation.
 */
import { createHash } from "node:crypto";
import { readPilotBytes } from "./audit-pilot-gate-evaluator.mjs";

export const CURRENT_TRUST_PROFILE = "HRBP_PILOT_CURRENT_TRUST_V1";
const OPTION_NAMES = ["requiredTrustStateProfile", "trustStatePath", "expectedTrustStateSha256", "minimumTrustSequence"];
const MAX_WINDOW_MS = 86400_000;
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ref = value => typeof value === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, fields) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value ? Date.parse(value) : null;
export class CurrentTrustError extends Error {
  constructor(code) { super("Current pilot trust verification failed."); this.code = code; }
}
function requireCondition(condition, code) { if (!condition) throw new CurrentTrustError(code); }

/** Any trust-state option activates the whole contract; partial/undefined controls never downgrade. */
export function currentTrustRequested(options) {
  const enabled = OPTION_NAMES.some(name => Object.hasOwn(options, name));
  if (!enabled) return false;
  requireCondition(OPTION_NAMES.every(name => Object.hasOwn(options, name) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(options, name), "value")) &&
    options.requiredTrustStateProfile === CURRENT_TRUST_PROFILE &&
    typeof options.trustStatePath === "string" && options.trustStatePath.length > 0 && !options.trustStatePath.includes("\0") &&
    sha(options.expectedTrustStateSha256) && positive(options.minimumTrustSequence), "CURRENT_TRUST_OPTIONS_INVALID");
  return true;
}
function inventory(entries, id, maximum, issued) {
  requireCondition(Array.isArray(entries) && entries.length >= 1 && entries.length <= maximum,
    "CURRENT_TRUST_INVENTORY_INVALID");
  const result = new Map();
  for (const entry of entries) {
    requireCondition(exact(entry, [id, "status", "updatedAtUtc"]) && sha(entry[id]) &&
      !result.has(entry[id]) && ["ACTIVE", "REVOKED"].includes(entry.status) &&
      date(entry.updatedAtUtc) !== null && date(entry.updatedAtUtc) >= 0 && date(entry.updatedAtUtc) <= issued,
      "CURRENT_TRUST_INVENTORY_INVALID");
    result.set(entry[id], entry.status);
  }
  return result;
}

/** Called after both policy-bound signatures, before artifact reads. No writes or network access.
 * Digest and sequence floor MUST come from the independent CURRENT operator trust register,
 * not the candidate bundle. A stale/attacker-controlled enrollment defeats this boundary.
 */
export function verifyPilotCurrentTrust(options, context) {
  try {
    requireCondition(currentTrustRequested(options), "CURRENT_TRUST_OPTIONS_INVALID");
    requireCondition(exact(context, ["policySha256", "customerReference", "keyIds", "decisionAtUtc", "now"]) &&
      sha(context.policySha256) && ref(context.customerReference) &&
      Array.isArray(context.keyIds) && context.keyIds.length === 2 && context.keyIds.every(sha) &&
      new Set(context.keyIds).size === 2 && Number.isSafeInteger(context.now) && context.now >= 0 &&
      context.now <= 8_640_000_000_000_000 && date(context.decisionAtUtc) !== null &&
      date(context.decisionAtUtc) >= 0 && date(context.decisionAtUtc) <= context.now,
      "CURRENT_TRUST_CONTEXT_INVALID");
    const bytes = readPilotBytes(options.trustStatePath, 64 * 1024);
    requireCondition(createHash("sha256").update(bytes).digest("hex") === options.expectedTrustStateSha256,
      "CURRENT_TRUST_DIGEST_MISMATCH");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const state = JSON.parse(text);
    // Exact compact bytes reject duplicate keys, BOM and non-roundtrippable numbers.
    requireCondition(text === JSON.stringify(state) + "\n", "CURRENT_TRUST_SCHEMA_INVALID");
    requireCondition(exact(state, ["schemaVersion", "scope", "customerReference", "sequence", "issuedAtUtc", "expiresAtUtc", "policies", "keys"]) &&
      state.schemaVersion === 1 && state.scope === "HRBP_AUDIT_PILOT_CURRENT_TRUST:1" &&
      ref(state.customerReference) && positive(state.sequence), "CURRENT_TRUST_SCHEMA_INVALID");
    requireCondition(state.customerReference === context.customerReference, "CURRENT_TRUST_CONTEXT_MISMATCH");
    requireCondition(state.sequence >= options.minimumTrustSequence, "CURRENT_TRUST_ROLLBACK");
    const issued = date(state.issuedAtUtc), expires = date(state.expiresAtUtc);
    requireCondition(issued !== null && expires !== null && issued >= date(context.decisionAtUtc) &&
      issued <= context.now && expires > context.now && expires > issued && expires - issued <= MAX_WINDOW_MS,
      "CURRENT_TRUST_WINDOW_INVALID");
    const policies = inventory(state.policies, "sha256", 128, issued);
    const keys = inventory(state.keys, "keyId", 256, issued);
    requireCondition(policies.has(context.policySha256), "CURRENT_TRUST_POLICY_UNREGISTERED");
    requireCondition(policies.get(context.policySha256) === "ACTIVE", "CURRENT_TRUST_POLICY_REVOKED");
    for (const keyId of context.keyIds) {
      requireCondition(keys.has(keyId), "CURRENT_TRUST_KEY_UNREGISTERED");
      // Revocation denies CURRENT acceptance, regardless of the declared historic signing time.
      requireCondition(keys.get(keyId) === "ACTIVE", "CURRENT_TRUST_KEY_REVOKED");
    }
    return { profile: CURRENT_TRUST_PROFILE, sequence: state.sequence,
      checkedPolicies: 1, checkedKeys: 2, liveRegistryVerified: false };
  } catch (error) {
    if (error instanceof CurrentTrustError) throw error;
    // No raw filesystem paths, identifiers, JSON snippets or underlying error strings.
    throw new CurrentTrustError("CURRENT_TRUST_INPUT_INVALID");
  }
}
