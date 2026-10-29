# Provider deployment verification

This repository distinguishes a successful local/CI Worker build from an actual Cloudflare deployment.

## Why the extra Version ID check exists

Cloudflare creates a unique Worker Version ID for each uploaded version, while a deployment determines which version is serving traffic. The Worker Version Metadata binding exposes the active version ID from inside the running Worker. HRBP exposes only that UUID on the existing public runtime-health response; version tags, timestamps, account identifiers, bindings and secrets are not returned.

The ordinary runtime response stays backward compatible when provider metadata is unavailable. Local Node and local Worker smoke tests therefore do not fabricate a Cloudflare Version ID.

## Strict operator verification

After an authorized operator has evidence of a successful provider build/deployment:

1. Retain the exact 40-character source commit expected to be deployed.
2. Retain the Cloudflare Workers Build ID from the official `Workers Builds: hrbp` GitHub check.
3. Retain the full Cloudflare Worker Version ID reported for the successful deployment.
4. Manually run **Release Verification**, supplying all three values.
5. The live job first queries GitHub Checks read-only for that exact source commit. It accepts only the latest matching check from GitHub App ID `85455`, slug `cloudflare-workers-and-pages`, owner `cloudflare`, with the exact build ID and a completed `success` conclusion.
6. Only after provider-check success does the job perform one anonymous, no-cache GET to the runtime-health endpoint.
7. Runtime success requires the fresh response to contain both the expected source revision and the exact provider Version ID.

The GitHub provider-check request deliberately does not use a `status=completed` filter: an in-progress latest provider check must not be hidden behind an older completed success. Provider output text and dashboard URLs are never copied into verification results or summaries.

A missing, malformed or different provider Version ID fails closed. The operator-supplied expected ID is not inferred from candidate files or CI output.

## Assurance boundary

Together, the two checks prove that the official Cloudflare GitHub App reported a successful provider build for the expected source/build ID and that the responding Worker reports both the expected source revision and active Version ID. They still do not prove the contents of provider build logs, deployment permissions, quota state, database migration compatibility, 100% traffic allocation during gradual deployments, customer acceptance, or business-workflow correctness.

Issue #220 still requires sanitized provider failure/success evidence and any approved operational database/migration checks before closure.
