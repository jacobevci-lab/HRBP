import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadWithEnv(env) {
  const path = "lib/auth-assurance.ts";
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name === "@/lib/runtime-env") {
      return { runtimeString: (key) => Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined };
    }
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

test("default MFA assurance accepts amr=mfa and does not invent device trust", () => {
  const assurance = loadWithEnv({});
  assert.deepEqual(assurance.authenticationAssuranceConfiguration(), {
    mfaClaim: "amr",
    mfaValues: ["mfa"],
    deviceTrustClaim: null,
    deviceTrustValues: [],
    mfaConfigured: true,
    deviceTrustConfigured: false
  });
  assert.deepEqual(
    assurance.evaluateOidcAssurance({ amr: ["pwd", "mfa"] }),
    { mfaSatisfied: true, deviceTrustSatisfied: false }
  );
  assert.deepEqual(
    assurance.evaluateOidcAssurance({ amr: ["pwd"] }),
    { mfaSatisfied: false, deviceTrustSatisfied: false }
  );
});

test("custom assurance mappings support string, array, boolean and numeric claims", () => {
  const assurance = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "acr",
    HRBP_OIDC_MFA_VALUES: "urn:example:loa:2,urn:example:loa:3",
    HRBP_OIDC_DEVICE_TRUST_CLAIM: "device_trusted",
    HRBP_OIDC_DEVICE_TRUST_VALUES: "true,1"
  });

  assert.deepEqual(
    assurance.evaluateOidcAssurance({ acr: "urn:example:loa:3", device_trusted: true }),
    { mfaSatisfied: true, deviceTrustSatisfied: true }
  );
  assert.deepEqual(
    assurance.evaluateOidcAssurance({ acr: "urn:example:loa:1", device_trusted: 0 }),
    { mfaSatisfied: false, deviceTrustSatisfied: false }
  );
});

test("invalid or incomplete mappings fail closed", () => {
  const invalidClaim = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "bad claim",
    HRBP_OIDC_MFA_VALUES: "mfa"
  });
  assert.equal(invalidClaim.authenticationAssuranceConfiguration().mfaConfigured, false);
  assert.deepEqual(invalidClaim.assurancePolicyIssues({ mfaRequired: true, deviceTrustRequired: false }), [
    "OIDC MFA claim/value mapping"
  ]);

  const incompleteDevice = loadWithEnv({
    HRBP_OIDC_DEVICE_TRUST_CLAIM: "device_trusted",
    HRBP_OIDC_DEVICE_TRUST_VALUES: ""
  });
  assert.equal(incompleteDevice.authenticationAssuranceConfiguration().deviceTrustConfigured, false);
  assert.deepEqual(incompleteDevice.assurancePolicyIssues({ mfaRequired: false, deviceTrustRequired: true }), [
    "OIDC device-trust claim/value mapping"
  ]);
});

test("configured values are exact and bounded rather than substring matches", () => {
  const assurance = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "amr",
    HRBP_OIDC_MFA_VALUES: "mfa,otp"
  });
  assert.equal(assurance.evaluateOidcAssurance({ amr: ["not-mfa"] }).mfaSatisfied, false);
  assert.equal(assurance.evaluateOidcAssurance({ amr: ["otp"] }).mfaSatisfied, true);
});


test("assurance mapping version is deterministic and changes with enforcement semantics", () => {
  const first = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "acr",
    HRBP_OIDC_MFA_VALUES: "loa3,loa2",
    HRBP_OIDC_DEVICE_TRUST_CLAIM: "device_trusted",
    HRBP_OIDC_DEVICE_TRUST_VALUES: "compliant,true"
  });
  const reordered = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "acr",
    HRBP_OIDC_MFA_VALUES: "loa2,loa3",
    HRBP_OIDC_DEVICE_TRUST_CLAIM: "device_trusted",
    HRBP_OIDC_DEVICE_TRUST_VALUES: "true,compliant"
  });
  const changed = loadWithEnv({
    HRBP_OIDC_MFA_CLAIM: "acr",
    HRBP_OIDC_MFA_VALUES: "loa4",
    HRBP_OIDC_DEVICE_TRUST_CLAIM: "device_trusted",
    HRBP_OIDC_DEVICE_TRUST_VALUES: "true,compliant"
  });

  const firstVersion = first.authenticationAssuranceVersion();
  assert.match(firstVersion, /^[a-f0-9]{64}$/);
  assert.equal(firstVersion, reordered.authenticationAssuranceVersion());
  assert.notEqual(firstVersion, changed.authenticationAssuranceVersion());
});
