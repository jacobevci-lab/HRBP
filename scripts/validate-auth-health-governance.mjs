import { readFile } from "node:fs/promises";

const path = "app/api/health/auth/route.ts";
const source = await readFile(path, "utf8");
const failures = [];

function expect(pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}
function reject(pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

expect(/getOidcConfig/, "authentication health must resolve the concrete OIDC runtime configuration");
expect(/enforceOidcRuntimeBinding/, "authentication health must evaluate governed OIDC runtime binding");
expect(/withDb/, "authentication health must evaluate the same database-backed governance state used by login");
expect(/IDENTITY_PROVIDER_INACTIVE[\s\S]*governed_provider_inactive/, "inactive governed identity must map to a bounded health class");
expect(/IDENTITY_PROVIDER_AMBIGUOUS[\s\S]*governed_provider_ambiguous/, "ambiguous governed identity must map to a bounded health class");
expect(/IDENTITY_PROVIDER_DRIFT[\s\S]*governed_provider_drift/, "runtime metadata drift must map to a bounded health class");
expect(/governance_unavailable/, "unexpected governance failures must collapse to a bounded unavailable class");
expect(/oidcReady = oidc\.configured && oidcRuntime\.ready/, "OIDC readiness must require both environment and governed runtime readiness");
expect(/anyReady = oidcReady \|\| local\.configured/, "overall authentication health must use effective mode readiness");
expect(/oidcGovernanceBlocked[\s\S]*"degraded"/, "a healthy local fallback with blocked governed OIDC must report degraded health");
expect(/authentication[\s\S]*"unavailable"/, "authentication mode must explicitly report when no usable mode remains");
expect(/environmentConfigured:[\s\S]*governance:[\s\S]*runtimeIssue:/, "OIDC mode health must expose secret-free environment and governance posture");
expect(/cache-control[\s\S]*no-store/, "authentication health must remain uncached");
reject(/runtimeIssue:\s*error|runtimeIssue:\s*message/, "raw runtime errors must never be returned by authentication health");
reject(/clientSecret|HRBP_OIDC_CLIENT_SECRET|HRBP_SESSION_SECRET/, "authentication health route must not expose secret fields or secret names directly");

if (failures.length) {
  console.error("Authentication health governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Authentication health governance validation passed.");
