/** Strict operator entrypoint. All offline S3 and current-trust checks are mandatory.
 * No collection, enrollment, signing, status writes, live APIs or release authorization.
 */
import { pathToFileURL } from "node:url";
import { verifyPilotEvidence } from "./audit-pilot-evidence.mjs";
import { S3_RETENTION_PROFILE } from "./audit-pilot-s3-retention.mjs";
import { S3_COLLECTION_PROFILE } from "./audit-pilot-s3-provenance.mjs";
import { CURRENT_TRUST_PROFILE } from "./audit-pilot-current-trust.mjs";

export const STRICT_PILOT_PROFILE = "HRBP_PILOT_STRICT_S3_V1";
const READY = "READY_FOR_INDEPENDENT_AUTHORIZATION";
const FLAGS = new Map([
  ["--packet", "packetPath"], ["--trust-policy", "policyPath"],
  ["--expected-policy-sha256", "expectedPolicySha256"], ["--signatures", "signaturesPath"],
  ["--evidence-dir", "evidenceDir"], ["--trust-state", "trustStatePath"],
  ["--expected-trust-state-sha256", "expectedTrustStateSha256"], ["--minimum-trust-sequence", "minimumTrustSequence"]
]);
const NAMES = [...FLAGS.values()];
const PATHS = ["packetPath", "policyPath", "signaturesPath", "evidenceDir", "trustStatePath"];
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function invalid(code = "STRICT_PILOT_INPUT_INVALID") {
  return { decision: "NO_GO", assuranceLevel: "NOT_VERIFIED", reasons: [code],
    verifiedSignatures: 0, verifiedArtifacts: 0 };
}
function validate(options) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).length !== NAMES.length ||
      NAMES.some(name => !Object.hasOwn(options, name) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name), "value"))) throw Error("INVALID");
  for (const name of PATHS) {
    const path = options[name];
    if (typeof path !== "string" || path.length === 0 || !path.isWellFormed() ||
        Buffer.byteLength(path) > 4096 || path.includes("\0")) throw Error("INVALID");
  }
  if (!sha(options.expectedPolicySha256) || !sha(options.expectedTrustStateSha256) ||
      !Number.isSafeInteger(options.minimumTrustSequence) || options.minimumTrustSequence < 1) throw Error("INVALID");
  // Copy data properties, including non-enumerable ones, after rejecting accessors.
  return Object.fromEntries(NAMES.map(name => [name, options[name]]));
}
function complete(result, minimumSequence) {
  return result.decision === READY && result.reasons?.length === 0 &&
    result.assuranceLevel === "PINNED_SIGNATURES_DIGESTS_S3_SEMANTICS_AND_COLLECTION_PROVENANCE" &&
    result.verifiedSignatures === 2 && result.verifiedArtifacts === 19 &&
    result.retention?.profile === S3_RETENTION_PROFILE && result.retention.verifiedObservations === 5 &&
    result.retention.liveProviderVerified === false && result.collection?.profile === S3_COLLECTION_PROFILE &&
    result.collection.verifiedFiles === 7 && result.collection.verifiedRawResponses === 5 &&
    result.collection.normalizedObservationMatched === true && result.collection.providerAttestationVerified === false &&
    result.collection.lockEnforcementTested === false && result.currentTrust?.profile === CURRENT_TRUST_PROFILE &&
    Number.isSafeInteger(result.currentTrust.sequence) && result.currentTrust.sequence >= minimumSequence &&
    result.currentTrust.checkedPolicies === 1 && result.currentTrust.checkedKeys === 2 &&
    result.currentTrust.liveRegistryVerified === false;
}

/** No clock/profile overrides. Pins and sequence floor must be independently supplied. */
export function verifyStrictPilotEvidence(options) {
  let result;
  try {
    const input = validate(options);
    result = verifyPilotEvidence({ ...input,
      requiredRetentionProfile: S3_RETENTION_PROFILE,
      requiredCollectionProfile: S3_COLLECTION_PROFILE,
      requiredTrustStateProfile: CURRENT_TRUST_PROFILE });
    if (result.decision !== "NO_GO" && !complete(result, input.minimumTrustSequence)) {
      result = invalid("STRICT_PILOT_RESULT_INCOMPLETE");
    }
  } catch {
    result = invalid();
  }
  return { verificationProfile: STRICT_PILOT_PROFILE, ...result, releaseAuthorized: false };
}
function parseArgs(argv) {
  if (argv.length !== FLAGS.size * 2) throw Error("INVALID");
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = FLAGS.get(argv[i]), value = argv[i + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith("--") || value.includes("\0")) throw Error("INVALID");
    if (name === "minimumTrustSequence") {
      if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error("INVALID");
      options[name] = Number(value);
    } else options[name] = value;
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { result = verifyStrictPilotEvidence(parseArgs(process.argv.slice(2))); }
  catch { result = verifyStrictPilotEvidence(null); }
  console.log(JSON.stringify(result));
  if (result.decision !== READY) process.exitCode = 1;
}
