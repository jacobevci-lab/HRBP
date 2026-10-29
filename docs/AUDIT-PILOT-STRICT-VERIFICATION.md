# Strict offline pilot verification

## Operator entrypoint

Use `npm run --silent audit-pilot:verify -- ...` (or `node scripts/audit-pilot-verify.mjs ...`) for the S3 pilot path requiring every implemented offline control. This command is intentionally narrower than the low-level `audit-pilot-evidence.mjs` API. It always requires policy v3, S3 retention semantics, collection provenance and independently pinned current trust status. There are no profile-selection, skip, clock-override, enrollment or signing flags.

```sh
npm run --silent audit-pilot:verify -- \
  --packet /controlled/pilot/packet.json \
  --trust-policy /controlled/pilot/policy.json \
  --expected-policy-sha256 "${APPROVED_POLICY_SHA256:?required from independent register}" \
  --signatures /controlled/pilot/signatures.json \
  --evidence-dir /controlled/pilot/artifacts \
  --trust-state /controlled/register/current-trust.json \
  --expected-trust-state-sha256 "${CURRENT_TRUST_SHA256:?required from independent register}" \
  --minimum-trust-sequence "${MIN_TRUST_SEQUENCE:?required from independent register}"
```

All eight flag/value pairs are mandatory, may be reordered and must occur exactly once. The sequence must be a positive decimal safe integer: no leading zeroes, exponents, fractions, signs or whitespace. Unknown options, missing/empty values and attempts to pass low-level profile/clock flags fail closed. Programmatic callers use `verifyStrictPilotEvidence(options)` with the same eight named data fields. Accessors, inherited options, extra/symbol keys and invalid value types are rejected before file access. Null-prototype objects and non-enumerable own data properties are supported.

The three shell variables above are merely explicit argument sources, not values the program discovers. Obtain the approved policy digest, CURRENT trust snapshot digest and minimum sequence from the independently managed operator register. Do not derive them from the untrusted candidate or enroll a file merely by hashing it. Check that the enrolled policy identifies the intended customer, source commit and Worker version. This command does not choose the correct deployment for an operator.

## Checks and result contract

The wrapper invokes the existing verifier once, with all three required profiles fixed by code. No new signature, policy, snapshot or artifact format is introduced. It preserves the underlying order: authenticate policy and packet, verify both role-bound Ed25519 signatures, validate current policy/key status, then read and verify artifact files, S3 semantics and collection provenance. The verifier continues to use the exact authenticated G04/G05 buffers.

Successful output must include the existing full-provenance assurance label, two signatures, nineteen artifacts, five S3 observations, seven additional provenance files, five raw responses and current ACTIVE policy/two-key checks. A weaker or incomplete successful result is converted to `NO_GO` with `STRICT_PILOT_RESULT_INCOMPLETE`; success is never inferred from exit code or file existence alone.

Every output includes `verificationProfile: "HRBP_PILOT_STRICT_S3_V1"` and `releaseAuthorized: false`. Exit 0 means only `READY_FOR_INDEPENDENT_AUTHORIZATION`; exit 1 means `NO_GO`. Input errors use `STRICT_PILOT_INPUT_INVALID`; underlying verification failures retain their sanitized reason codes. stdout is one JSON line when running the Node entrypoint or the silent npm command. No paths, customer identifiers, keys, raw responses or stack traces are printed.

The command reads existing files only. It does not collect evidence, call AWS, query a live registry, create signatures, modify a policy, advance a sequence floor, write a report, deploy, or perform human authorization. A saved output is an unsigned point-in-time diagnostic, not a reusable approval token. Reverify with independently current pins and status at the actual authorization step.

## Compatibility and rollout

The lower-level verifier remains available for v1/v2 compatibility and controlled component testing. Its existing optional-profile behavior is unchanged. The new strict command does NOT make all existing callers strict automatically and does not change production configuration, branch protection or release workflow rules. Operators must deliberately route the S3 pilot workflow through this command and retain the independent release/customer gates. Do not retry a strict rejection using the legacy command as a fallback.

Tests for this entrypoint are part of `audit-pilot:validate`, its all-PR-base workflow and the existing `audit-integrity:validate` -> `prebuild` test chain. CI uses synthetic local bundles and ephemeral keys, not customer acceptance inputs; it never invokes a live provider or deployment.

## Assurance limits

Current trust is only as current and trustworthy as the externally supplied digest, sequence floor, local clock and registry custody. This code neither persists the floor nor discovers later revocations. File-parent ownership and concurrent-filesystem limitations of the underlying verifier remain. Revocation status is checked for current acceptance, not historical signing-time validity.

Live-assurance indicators remain false: `retention.liveProviderVerified`, `collection.providerAttestationVerified` / `collection.lockEnforcementTested`, and `currentTrust.liveRegistryVerified`. Authenticating consistent retained bytes does not prove AWS originated them, that collection was truthful, or that Object Lock is enforced. It also does not prove actual deployment, approved TSA operation, legal compliance, whole-platform readiness or customer sign-off. Independent provider acceptance and human authorization remain required; #209 and #220 remain separate blockers.
