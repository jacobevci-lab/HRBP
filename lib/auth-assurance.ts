import { runtimeString } from "@/lib/runtime-env";

type AssuranceConfig = {
  mfaClaim: string;
  mfaValues: string[];
  deviceTrustClaim: string | null;
  deviceTrustValues: string[];
  mfaConfigured: boolean;
  deviceTrustConfigured: boolean;
};

type AssuranceResult = {
  mfaSatisfied: boolean;
  deviceTrustSatisfied: boolean;
};

const CLAIM_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function parseClaim(value: string | undefined, fallback?: string) {
  const claim = (value ?? fallback ?? "").trim();
  return CLAIM_RE.test(claim) ? claim : null;
}

function parseValues(value: string | undefined, fallback: string[] = []) {
  const raw = value === undefined ? fallback : value.split(",");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = entry.trim();
    if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length > 50) return null;
  }
  return result;
}

function claimValues(payload: Record<string, unknown>, claim: string | null) {
  if (!claim) return [];
  const value = payload[claim];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => {
    if (typeof entry === "string") {
      const normalized = entry.trim();
      return normalized && normalized.length <= 256 ? [normalized] : [];
    }
    if (typeof entry === "boolean" || typeof entry === "number") return [String(entry)];
    return [];
  }).slice(0, 50);
}

function satisfied(actual: string[], allowed: string[]) {
  if (!actual.length || !allowed.length) return false;
  const accepted = new Set(allowed);
  return actual.some((value) => accepted.has(value));
}

export function authenticationAssuranceConfiguration(): AssuranceConfig {
  const mfaClaim = parseClaim(runtimeString("HRBP_OIDC_MFA_CLAIM"), "amr");
  const mfaValues = parseValues(runtimeString("HRBP_OIDC_MFA_VALUES"), ["mfa"]);
  const deviceTrustClaim = parseClaim(runtimeString("HRBP_OIDC_DEVICE_TRUST_CLAIM"));
  const deviceTrustValues = parseValues(runtimeString("HRBP_OIDC_DEVICE_TRUST_VALUES"), []);

  return {
    mfaClaim: mfaClaim ?? "",
    mfaValues: mfaValues ?? [],
    deviceTrustClaim,
    deviceTrustValues: deviceTrustValues ?? [],
    mfaConfigured: Boolean(mfaClaim && mfaValues?.length),
    deviceTrustConfigured: Boolean(deviceTrustClaim && deviceTrustValues?.length)
  };
}

export function evaluateOidcAssurance(payload: Record<string, unknown>): AssuranceResult {
  const config = authenticationAssuranceConfiguration();
  return {
    mfaSatisfied: config.mfaConfigured
      ? satisfied(claimValues(payload, config.mfaClaim), config.mfaValues)
      : false,
    deviceTrustSatisfied: config.deviceTrustConfigured
      ? satisfied(claimValues(payload, config.deviceTrustClaim), config.deviceTrustValues)
      : false
  };
}

export function assurancePolicyIssues(input: { mfaRequired: boolean; deviceTrustRequired: boolean }) {
  const config = authenticationAssuranceConfiguration();
  const issues: string[] = [];
  if (input.mfaRequired && !config.mfaConfigured) issues.push("OIDC MFA claim/value mapping");
  if (input.deviceTrustRequired && !config.deviceTrustConfigured) issues.push("OIDC device-trust claim/value mapping");
  return issues;
}
