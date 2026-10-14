import { normalizedRevision } from "../lib/runtime-health.mjs";
import { verifyDeployment } from "./verify-deployment.mjs";

/**
 * Normal installation checks remain compatible, but a customer pilot is
 * never allowed to omit an explicit approved 40-character source revision.
 */
export function postflightReleaseRequirement({ mode, pilot = false, expectedRevision = null }) {
  if (!["pre-upgrade", "post-deploy"].includes(mode)) {
    throw new Error("An explicit supported postflight mode is required.");
  }
  if (pilot && mode !== "post-deploy") {
    throw new Error("Customer pilot verification requires post-deploy mode.");
  }
  if (expectedRevision === null || expectedRevision === undefined) {
    if (pilot) throw new Error("Customer pilot verification requires a full approved release SHA.");
    return { expectedRevision: null, pilot: false };
  }
  const normalized = normalizedRevision(expectedRevision);
  if (!normalized) throw new Error("An expected revision must be a full 40-character commit SHA.");
  return { expectedRevision: normalized, pilot: Boolean(pilot) };
}

/**
 * Reuse the one-request anonymous deployment verifier: fresh per-request
 * challenge, no-store, exact release protocol, exact source SHA.
 *
 * A postflight result is never a user-workflow/UAT approval. This only proves
 * the local runtime identity for the approved revision.
 */
export async function verifyPostflightRelease({
  origin, expectedRevision, fetchImpl, nonce, timeoutMs = 10_000
}) {
  const revision = normalizedRevision(expectedRevision);
  if (!revision) throw new Error("A full approved release SHA is required.");

  // On-prem postflight targets the host's local application port, not a
  // user-supplied external or internal network destination.
  let url;
  try { url = new URL(origin); } catch { throw new Error("Invalid local postflight origin."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("On-prem postflight release checks require a clean loopback origin.");
  }

  const result = await verifyDeployment({
    origin: url.origin,
    expectedRevision: revision,
    localSmoke: true,
    timeoutMs,
    fetchImpl,
    nonce
  });
  // Return only bounded non-secret identifiers from the verifier.
  return { verified: result.success, code: result.code, revision: result.observedRevision };
}
